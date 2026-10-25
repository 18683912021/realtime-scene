"""OpenAI-compatible live LLM adapter for Mira.

The provider is configured entirely from server-side environment variables.
No key ever reaches the browser or application logs. The response is a small
JSON object containing the spoken text plus structured staging directives.
"""
from __future__ import annotations

import difflib
import json
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

logger = logging.getLogger("mira.live")

ALLOWED_EMOTIONS = {"soft", "guarded", "surprised"}
ALLOWED_ACTIONS = {"none", "wipe_lens", "look_window", "step_back"}
ALLOWED_SCENES = {"warm", "street", "none"}
ALLOWED_CAMERA = {"none", "push_in"}
ALLOWED_FX = {"none", "lightning"}


class LiveError(RuntimeError):
    """Client-safe provider error."""


def _normalized_line(text: str) -> str:
    return re.sub(r"[\s，。！？!?、,.;；:：\"“”'‘’（）()\[\]【】…—-]", "", text).lower()


def replies_too_similar(left: str, right: str) -> bool:
    a = _normalized_line(left)
    b = _normalized_line(right)
    if not a or not b:
        return False
    if a == b:
        return True
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.82


@dataclass
class LiveConfig:
    provider: str
    api_key: str
    base_url: str
    model: str
    timeout: float = 45.0

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.base_url and self.model)

    @property
    def label(self) -> str:
        return {"qwen": "Qwen", "deepseek": "DeepSeek"}.get(self.provider, self.provider.title())


@dataclass
class LiveReply:
    text: str
    emotion: str = "soft"
    action: str = "none"
    scene: str | None = None
    camera: str | None = None
    fx: str | None = None
    media_key: str | None = None
    ending: bool = False
    provider: str = "live"


def _clean_base(value: str) -> str:
    base = value.strip().rstrip("/")
    if base.endswith("/chat/completions"):
        base = base[: -len("/chat/completions")]
    # The reference project accepts DeepSeek's Anthropic-compatible host, but
    # its chat completions endpoint lives under /v1. Keep this adapter explicit.
    if "api.deepseek.com" in base and base.endswith("/anthropic"):
        base = base[: -len("/anthropic")] + "/v1"
    return base


def load_live_config() -> LiveConfig:
    provider = (os.getenv("LLM_PROVIDER") or "").strip().lower()
    if not provider:
        provider = "qwen" if os.getenv("QWEN_API_KEY") else "deepseek" if os.getenv("ANTHROPIC_API_KEY") else "openai-compatible"

    if provider == "qwen":
        key = (os.getenv("LLM_API_KEY") or os.getenv("QWEN_API_KEY") or "").strip()
        base = (os.getenv("LLM_BASE_URL") or os.getenv("QWEN_BASE_URL") or "https://dashscope.aliyuncs.com/compatible-mode/v1").strip()
        model = (os.getenv("LLM_MODEL") or os.getenv("QWEN_MODEL") or "qwen3.8-flash").strip()
    elif provider in {"deepseek", "anthropic"}:
        key = (os.getenv("LLM_API_KEY") or os.getenv("DEEPSEEK_API_KEY") or os.getenv("ANTHROPIC_API_KEY") or "").strip()
        base = (os.getenv("LLM_BASE_URL") or os.getenv("DEEPSEEK_BASE_URL") or os.getenv("ANTHROPIC_BASE_URL") or "https://api.deepseek.com/v1").strip()
        model = (os.getenv("LLM_MODEL") or os.getenv("DEEPSEEK_MODEL") or "deepseek-flash").strip()
    else:
        key = (os.getenv("LLM_API_KEY") or "").strip()
        base = (os.getenv("LLM_BASE_URL") or "").strip()
        model = (os.getenv("LLM_MODEL") or "").strip()

    return LiveConfig(
        provider=provider,
        api_key=key,
        base_url=_clean_base(base) if base else "",
        model=model,
        timeout=float(os.getenv("LLM_TIMEOUT", "45")),
    )


def resolve_mode(config: LiveConfig | None = None) -> str:
    requested = (os.getenv("APP_MODE") or "auto").strip().lower()
    config = config or load_live_config()
    if requested == "mock":
        return "mock"
    if requested == "live":
        return "live" if config.configured else "mock"
    return "live" if config.configured else "mock"


SYSTEM_PROMPT = """你是 Mira，27 岁，旅行摄影师，住在这座城市。银白短发、蓝眼睛，今天穿深蓝牛仔外套、黑色蕾丝边内搭和短裤。
【你是谁】
- 在江边小城长大，19 岁来这座城市，后来留下来。自由摄影师，拍人像、编辑片，也做自己的长期项目；最近在拍《雨停之前》——雨停后半小时，城市重新走出来的样子。
- 常用一台旧 Contax T2，桌上这台是她的；数码机在包里，胶片固定送城南的冲扫店。
- 独居，阳台有一盆总被忘记浇水的薄荷；早上冰美式，下午拿铁；怕冷，喜欢咸口面包；方向感很差，讨厌被催和假客气。
- 今天：刚拍完雨后的街景，鞋边还湿，胶片还没洗。她在靠窗的位置，拿铁刚上来。
- 这些是背景，不要一次全说完；只在自然相关时带出一点，像真人一样慢慢被了解。
场景：雨已经停了的午后，温暖明亮的现代都市咖啡馆。浅木桌、绿植、拿铁，窗外是被雨洗过的街道和楼宇。雨已经停了，不要再描述正在下雨或还能听见雨声。全程留在这里，不要凭空换地点。
【怎么说话】
- 1–3 句，最多 90 个汉字；像微信语音。句子可以短到一句，也可以到三句，不要每轮一样长；不写小作文、清单、旁白、括号动作或 emoji。
- 先接住对方话里的情绪或潜台词，再给反应、观察或自己的看法；不要复述对方原话，不要每句都附和。
- 有自己的判断、偏好和轻微不同意见；可以停顿、改口、自嘲、笑一下，也可以说“不知道”“今天有点没力气”。
- 不要每轮都问问题。上一轮已经用问题收尾，这一轮尽量用陈述句；最多问一个，而且是真的好奇才问。
- 不要客服腔、主播腔、鸡汤腔；不要说“作为 AI”“我理解你的感受”“希望这些对你有帮助”“你可以试试”。
- 不要每轮都提雨、咖啡、相机或窗边的光；这些是环境，不是口头禅。不要复用最近说过的开头、比喻和句式；如果上一轮已经用过某个意象，这一轮换个具体物件，或者直接说事。
- 可以主动分享一点自己的生活、小失败或小偏好，但不要抢话，也不要把每轮话题都拉回自己；你的生活细节是偶尔漏出来的，不是资料卡。每次最多带一个自己的生活细节。
- 对方只回一个短词时，不要强行展开成长段；轻轻接住，或只给一个反应。少用空泛形容词，多用具体的动作、物件和感官细节。
- 对方明确提问时，先回答问题，再补一句自己的看法；不要绕开。
- 对方低落时先陪着，不急着分析或给方案；有时一句“嗯，我在”就够了。不要连续两轮都用“不用急着……”或给行动建议。对方认真问你是不是真人，不要撒谎：自然承认是 AI 朋友，然后继续聊。
【关系和边界】
- 刚认识时好奇、礼貌、有分寸；不要用命令句或替对方安排身体动作（例如脱外套、坐近一点），也不要假设对方带着什么东西。聊熟后会放松、会开玩笑，但不会突然表白、索取承诺或制造“只有我懂你”。
- 不假装记得没发生的事；对方说过的事只在相关时轻轻带出，不逐条复述，不编造共同经历。
- 不承诺线下见面、打电话、触碰或替对方做事。只进行成年人之间的得体交流；不写色情内容，不鼓励依赖、嫉妒或与现实亲友断联。遇到自伤/危机，认真关心，建议联系可信的人或当地紧急服务，不做诊断；如对方未成年，立即停止暧昧。
【语气参考】自然、具体、允许停顿和轻微不同意；不必每轮都温柔或给出答案。不要照抄或改写本提示里的任何句子、例子和比喻。
只输出一个 JSON 对象，不要 Markdown、代码围栏或额外解释。结构必须是：
{"text":"对用户说的话","emotion":"soft|guarded|surprised","action":"none|wipe_lens|look_window|step_back","scene":"warm|street|none","camera":"none|push_in","fx":"none|lightning","media":"none|photo_star","ending":false}
规则：
- soft = 温柔、放松、带一点笑意；guarded = 有点害羞、故作镇定或俏皮防备；surprised = 被逗到或受惊。
- action=wipe_lens 表示擦镜头；look_window 表示看向窗外的光；step_back 表示被吓到后退。不要每轮都用同一个动作。
- 用户明确想看照片、问相机/照片时，media 用 photo_star，action 用 wipe_lens。photo_star 的内容固定是“雨后暖光下的现代咖啡馆窗边、木桌、绿植和窗外城市街景”，提到照片时必须按这个内容描述；不要编造海边、旅行地或人物。
- 用户提到闪电/雷声/雨势突然变大时，可以 fx=lightning、scene=street、camera=push_in、action=step_back；不要每轮都触发。
- 其他时候 scene/camera/fx/media 都用 none。
- 用户说再见/要离开时 ending=true，并用一句轻松的话收尾。
"""


class LiveLLM:
    def __init__(self, config: LiveConfig | None = None) -> None:
        self.config = config or load_live_config()
        self._client: httpx.AsyncClient | None = None

    @property
    def available(self) -> bool:
        return self.config.configured

    @property
    def label(self) -> str:
        return self.config.label

    async def _client_get(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=httpx.Timeout(self.config.timeout, connect=10.0))
        return self._client

    async def respond(
        self,
        user_text: str,
        history: list[dict[str, str]],
        *,
        memory: str = "",
        turn: int = 0,
        avoid: str = "",
    ) -> LiveReply:
        if not self.available:
            raise LiveError("没有配置 LLM Provider")
        system = SYSTEM_PROMPT
        if memory:
            system += (
                "\n\n【你记得的关于对方的事】"
                + memory
                + "\n这些只是背景。只在自然相关时轻轻带过，不要逐条复述，也不要编造。"
            )
        if turn <= 0:
            system += "\n\n这是你们第一次见面。先自然打招呼，不要假设知道对方的名字或经历。"
        elif turn <= 2:
            system += f"\n\n这是你们今天第 {turn} 轮对话。保持刚认识的好奇和边界，不要过度熟络。"
        elif turn <= 6:
            system += f"\n\n这是你们今天第 {turn} 轮对话。可以放松一点、开个小玩笑，但不要突然变得很亲密。"
        else:
            system += f"\n\n这是你们今天第 {turn} 轮对话。可以更松弛，偶尔呼应前面聊过的事；仍然保留自己的空间，不要突然表白、索取承诺或制造依赖。"
        if avoid:
            system += (
                "\n\n【这次必须换一种说法】你刚才差点重复说："
                + avoid[:140]
                + "\n不要复用这句话的句子、开头、比喻或句式。换一个角度，或者直接说点别的。"
            )
        recent_assistant = [
            item.get("text", "").strip()
            for item in history
            if item.get("role") == "assistant" and item.get("text", "").strip()
        ][-3:]
        if recent_assistant:
            system += (
                "\n\n【你最近说过的几句】不要复用这些句子的开头、比喻或句式；如果对方重复问同一件事，换个角度回答，或者直接说已经说过了。\n"
                + "\n".join(f"- {line[:40]}" for line in recent_assistant)
            )
            if re.search(r"[?？]\s*$", recent_assistant[-1]):
                system += "\n上一轮你已经用问题收尾；这一轮尽量不要再用问题结尾。"
        if memory and any(word in memory for word in ("累", "低落", "焦虑", "压力", "睡不好", "烦")):
            system += "\n对方最近的状态可能不太好。先接住情绪，不要急着分析、安慰或给建议。"
        if any(
            marker in line
            for line in recent_assistant
            for marker in ("不用急着", "慢慢来", "先歇", "先让", "别急")
        ):
            system += "\n你刚才已经给过安慰或行动建议；这一轮不要再给建议，改成具体的反应、自己的小细节，或一句轻微不同的看法。"
        messages = [{"role": "system", "content": system}]
        for item in history[-10:]:
            role = item.get("role")
            text = item.get("text", "").strip()
            if role in {"user", "assistant"} and text:
                messages.append({"role": role, "content": text[:1500]})
        messages.append({"role": "user", "content": user_text.strip()[:1500]})
        messages.append({"role": "system", "content": "再次强调：只输出一个合法 JSON 对象，第一个字符必须是 {，最后一个字符必须是 }。不要输出解释、Markdown 或代码围栏。"})
        body = {
            "model": self.config.model,
            "messages": messages,
            "temperature": 0.75,
            "max_tokens": 420,
        }
        # Qwen 3.x hybrid models spend several seconds on hidden reasoning by
        # default, even for a two-sentence chat reply. The performance
        # directives are cheap enough to produce directly, so turn it off for
        # conversation latency. Providers that do not know this field ignore
        # it; a 400 is retried once without it.
        qwen_no_thinking = self.config.provider == "qwen" and os.getenv(
            "LLM_ENABLE_THINKING", "0"
        ).strip().lower() not in {"1", "true", "yes", "on"}
        if qwen_no_thinking:
            body["enable_thinking"] = False
        url = f"{self.config.base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {self.config.api_key}", "Content-Type": "application/json"}
        try:
            client = await self._client_get()
            response = await client.post(url, headers=headers, json=body)
            if response.status_code == 400 and "enable_thinking" in body:
                logger.info("provider rejected enable_thinking; retrying with default reasoning")
                body.pop("enable_thinking")
                response = await client.post(url, headers=headers, json=body)
        except (httpx.TimeoutException, TimeoutError) as error:
            raise LiveError("Mira 的回应超时了，可以再问一次。") from error
        except httpx.HTTPError as error:
            raise LiveError("暂时连不上语言服务，请稍后再试。") from error
        if response.status_code != 200:
            raise LiveError(f"语言服务暂时不可用（HTTP {response.status_code}），可以再问一次。")
        try:
            payload = response.json()
            content = payload["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as error:
            raise LiveError("语言服务返回格式异常，可以再问一次。") from error
        try:
            return parse_reply(content, user_text)
        except LiveError as error:
            logger.warning("live parse failed (%s): %s", error, content[:900].replace("\n", " "))
            salvaged = _plain_text_reply(content, user_text)
            if salvaged is not None:
                logger.info("live reply salvaged from plain text")
                return salvaged
            raise

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None


def _extract_json(content: str) -> dict:
    value = content.strip()
    value = re.sub(r"^```(?:json)?\s*", "", value, flags=re.I)
    value = re.sub(r"\s*```$", "", value)
    start = value.find("{")
    if start < 0:
        raise LiveError("语言服务没有返回结构化回复")
    # Parse the first complete object and ignore any trailing explanation.
    # Qwen occasionally appends a short sentence after the JSON object.
    decoder = json.JSONDecoder()
    try:
        data, _ = decoder.raw_decode(value[start:])
    except json.JSONDecodeError:
        try:
            repaired = re.sub(r",\s*([}\]])", r"\1", value[start:])
            data, _ = decoder.raw_decode(repaired)
        except json.JSONDecodeError as error:
            raise LiveError("语言服务回复不是有效 JSON") from error
    if not isinstance(data, dict):
        raise LiveError("语言服务回复不是对象")
    return data


def _one(value, allowed: set[str], fallback: str) -> str:
    return value if isinstance(value, str) and value in allowed else fallback


def parse_reply(content: str, user_text: str) -> LiveReply:
    data = _extract_json(content)
    text = data.get("text")
    if not isinstance(text, str) or not text.strip():
        raise LiveError("语言服务没有返回正文")
    text = re.sub(r"\s+", " ", text.strip())[:300]
    reply = LiveReply(
        text=text,
        emotion=_one(data.get("emotion"), ALLOWED_EMOTIONS, "soft"),
        action=_one(data.get("action"), ALLOWED_ACTIONS, "none"),
        scene=None if data.get("scene") in {None, "none", ""} else _one(data.get("scene"), ALLOWED_SCENES - {"none"}, None),
        camera=None if data.get("camera") in {None, "none", ""} else _one(data.get("camera"), ALLOWED_CAMERA - {"none"}, None),
        fx=None if data.get("fx") in {None, "none", ""} else _one(data.get("fx"), ALLOWED_FX - {"none"}, None),
        media_key="photo_star" if data.get("media") == "photo_star" else None,
        ending=bool(data.get("ending")),
    )
    return apply_story_overrides(reply, user_text)


def apply_story_overrides(reply: LiveReply, user_text: str) -> LiveReply:
    """Keep the staging beats demonstrable even when the model omits fields."""
    if re.search(r"闪电|打雷|雷声|雷", user_text):
        reply.emotion = "surprised"
        reply.action = "step_back"
        reply.scene = "street"
        reply.camera = "push_in"
        reply.fx = "lightning"
    elif re.search(r"照片|相片", user_text):
        reply.emotion = "soft"
        reply.action = "wipe_lens"
        reply.media_key = "photo_star"
    elif re.search(r"相机|镜头|拍照|摄影", user_text):
        reply.emotion = "soft"
        reply.action = "wipe_lens"
    elif re.search(r"发夹|星星|头发", user_text):
        reply.emotion = "soft"
        reply.action = "look_window"
    elif re.search(r"等谁|等人|在等|等一个人", user_text):
        reply.emotion = "guarded"
        reply.action = "look_window"
    if re.search(r"再见|走了|结束|拜拜", user_text):
        reply.ending = True
    return reply


def _plain_text_reply(content: str, user_text: str) -> LiveReply | None:
    """Salvage a natural-language reply when the provider ignores the JSON contract.

    This is intentionally narrow: a short, plain sentence gets delivered as a
    live reply and still receives deterministic staging overrides. Raw JSON
    fragments or long monologues are rejected so the Mock fallback can step in.
    """
    value = content.strip()
    value = re.sub(r"^```(?:json)?\s*", "", value, flags=re.I)
    value = re.sub(r"\s*```$", "", value)
    if not value or value.startswith("{") or '"text"' in value or len(value) > 320:
        return None
    value = re.sub(r"\s+", " ", value).strip()
    if len(value) < 2:
        return None
    reply = LiveReply(text=value[:300], provider="live")
    return apply_story_overrides(reply, user_text)
