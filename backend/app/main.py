from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from .asr import ASRError, TencentASRStream, credentials_ready as asr_ready
from .live import LiveError, LiveLLM, load_live_config, replies_too_similar, resolve_mode
from .memory import ConversationMemory
from .models import Ping, SessionEnd, SessionStart, UserInterrupt, UserText
from .script import ASSETS, RESPONSES, Reply, StoryState, audio_for, choose, media_for
from .tts import TTSError, TTS_DIR, create_tts_provider

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("mira")

ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIST = ROOT / "frontend" / "dist"

LIVE_CONFIG = load_live_config()
MODE = resolve_mode(LIVE_CONFIG)
LIVE = LiveLLM(LIVE_CONFIG) if MODE == "live" else None
TTS = create_tts_provider() if MODE == "live" else None
TTS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Rain Before Dawn", version="0.2.0")
app.mount("/api/tts", StaticFiles(directory=str(TTS_DIR)), name="tts")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


def now_ms() -> int:
    return int(time.time() * 1000)


class SessionRuntime:
    def __init__(self, socket: WebSocket, session_id: str) -> None:
        self.socket = socket
        self.session_id = session_id
        self.story = StoryState()
        self.history: list[dict[str, str]] = []
        self.memory = ConversationMemory()
        self.turn_count = 0
        self.last_action = "none"
        self.task: asyncio.Task[None] | None = None
        self.turn_id: str | None = None
        self.epoch = 0
        self.ended = False
        self.send_lock = asyncio.Lock()

    async def send(self, payload: dict) -> None:
        async with self.send_lock:
            try:
                await self.socket.send_json(payload)
            except Exception:
                logger.debug("socket send failed", exc_info=True)

    async def send_error(
        self,
        code: str,
        stage: str,
        message: str,
        *,
        recoverable: bool = True,
        turn_id: str | None = None,
    ) -> None:
        payload = {
            "type": "sys.error",
            "code": code,
            "stage": stage,
            "message": message,
            "recoverable": recoverable,
        }
        if turn_id:
            payload["turnId"] = turn_id
        await self.send(payload)

    async def ready(self) -> None:
        await self.send(
            {
                "type": "session.ready",
                "sessionId": self.session_id,
                "mode": MODE,
                "provider": LIVE.label if LIVE and MODE == "live" else "mock",
                "serverTime": now_ms(),
                "capabilities": {
                    "audio": True,
                    "tts": TTS.name if TTS and TTS.available else ("mock-assets" if MODE == "mock" else "unavailable"),
                    "media": True,
                    "stt": "tencent" if asr_ready() else "browser",
                    "interrupt": True,
                },
            }
        )

    async def cancel_current(self, *, notify: bool = True) -> None:
        task, turn_id, epoch = self.task, self.turn_id, self.epoch
        self.task = None
        self.turn_id = None
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            if notify and turn_id:
                await self.send(
                    {
                        "type": "reply.end",
                        "sessionId": self.session_id,
                        "turnId": turn_id,
                        "epoch": epoch,
                        "status": "cancelled",
                        "timing": {"totalMs": 0},
                        "timestamp": now_ms(),
                    }
                )

    async def start_turn(
        self,
        turn_id: str,
        epoch: int,
        text: str,
        *,
        input_mode: str = "text",
        opening: bool = False,
    ) -> None:
        if self.ended:
            await self.send_error(
                "E_SESSION_ENDED",
                "session",
                "这场雨夜已经结束了，可以重新开始。",
                recoverable=False,
                turn_id=turn_id,
            )
            return
        await self.cancel_current(notify=True)
        self.turn_id = turn_id
        self.epoch = epoch
        self.task = asyncio.create_task(
            self._run_turn(turn_id, epoch, text, input_mode=input_mode, opening=opening)
        )

    async def _build_reply(self, text: str, turn_id: str, *, synthetic: bool = False) -> Reply:
        if not (MODE == "live" and LIVE and LIVE.available):
            reply = choose(text, self.story)
            self._apply_story(reply)
            return reply

        if not synthetic:
            self.history.append({"role": "user", "text": text})
            self.memory.observe(text)
            self.turn_count += 1
        llm_started = time.monotonic()
        try:
            live_reply = await LIVE.respond(
                text,
                self.history if synthetic else self.history[:-1],
                memory=self.memory.prompt(),
                turn=0 if synthetic else self.turn_count,
            )
        except LiveError as error:
            logger.warning("live LLM failed: %s", type(error).__name__)
            await self.send_error(
                "E_LLM_FALLBACK",
                "llm",
                f"{error} 已切回 Mock 回复。",
                recoverable=True,
                turn_id=turn_id,
            )
            reply = choose(text, self.story)
            self._apply_story(reply)
            self.history.append({"role": "assistant", "text": reply.text})
            self._trim_history()
            return reply

        recent_assistant = [
            item.get("text", "")
            for item in self.history
            if item.get("role") == "assistant" and item.get("text", "").strip()
        ][-3:]
        if recent_assistant and any(replies_too_similar(live_reply.text, line) for line in recent_assistant):
            logger.info("live reply repeated a recent line; regenerating once")
            try:
                live_reply = await LIVE.respond(
                    text,
                    self.history[:-1],
                    memory=self.memory.prompt(),
                    turn=0 if synthetic else self.turn_count,
                    avoid=live_reply.text,
                )
            except LiveError:
                logger.warning("repetition retry failed; keeping the first live reply")

        # Models tend to reach for the same gesture every turn. Keep the
        # staging alive by dropping a plain repeat unless the scripted photo or
        # lightning beat explicitly needs it.
        if (
            live_reply.action != "none"
            and live_reply.action == self.last_action
            and not live_reply.media_key
            and live_reply.fx != "lightning"
        ):
            live_reply.action = "none"
        self.last_action = live_reply.action

        llm_ms = int((time.monotonic() - llm_started) * 1000)
        audio: dict | None = None
        tts_started = time.monotonic()
        if TTS and TTS.available:
            try:
                tts = await TTS.synthesize(live_reply.text, live_reply.emotion)
                audio = {"url": tts.url, "durationMs": tts.duration_ms, "format": tts.format}
            except TTSError:
                logger.warning("TTS failed for live reply")
                await self.send_error(
                    "E_TTS",
                    "tts",
                    "语音合成失败，这一轮切换到字幕。",
                    recoverable=True,
                    turn_id=turn_id,
                )
        else:
            await self.send_error(
                "E_TTS_UNAVAILABLE",
                "tts",
                "当前环境没有可用的语音合成，这一轮切换到字幕。",
                recoverable=True,
                turn_id=turn_id,
            )
        tts_ms = int((time.monotonic() - tts_started) * 1000)
        logger.info(
            "live reply ready session=%s turn=%s llm_ms=%d tts_ms=%d chars=%d",
            self.session_id,
            turn_id,
            llm_ms,
            tts_ms,
            len(live_reply.text),
        )

        reply = Reply(
            key="live",
            text=live_reply.text,
            emotion=live_reply.emotion,
            action=live_reply.action,
            scene=live_reply.scene,
            camera=live_reply.camera,
            fx=live_reply.fx,
            media_key=live_reply.media_key,
            ending=live_reply.ending,
            thinking_ms=250,
            audio=audio,
            source="live",
        )
        self.history.append({"role": "assistant", "text": live_reply.text})
        self._trim_history()
        self._apply_story(reply)
        return reply

    def _apply_story(self, reply: Reply) -> None:
        if reply.scene:
            self.story.scene = reply.scene
        if reply.fx == "lightning":
            self.story.lightning_seen = True
        if reply.media_key:
            self.story.photo_seen = True
        if reply.ending:
            self.story.closing = True

    def _trim_history(self) -> None:
        if len(self.history) > 12:
            self.history = self.history[-12:]

    async def _run_turn(self, turn_id: str, epoch: int, text: str, *, input_mode: str, opening: bool) -> None:
        started = time.monotonic()
        first_text_ms: int | None = None
        first_audio_ms: int | None = None
        try:
            await self.send(
                {
                    "type": "turn.start",
                    "sessionId": self.session_id,
                    "turnId": turn_id,
                    "epoch": epoch,
                    "replyToTurnId": None,
                    "timestamp": now_ms(),
                }
            )

            if opening:
                if MODE == "live" and LIVE and LIVE.available:
                    reply = await self._build_reply(
                        "（用户推门走进咖啡馆，你在窗边抬起头，看见了他）",
                        turn_id,
                        synthetic=True,
                    )
                else:
                    reply = RESPONSES["greeting"]
                    self._apply_story(reply)
                    await asyncio.sleep(reply.thinking_ms / 1000)
            else:
                reply = await self._build_reply(text, turn_id)
                # Keep a short, visible thinking beat even when the provider is
                # fast; for slow providers the real latency dominates.
                elapsed = time.monotonic() - started
                if elapsed < 0.55:
                    await asyncio.sleep(0.55 - elapsed)
                delay = max(0.0, reply.thinking_ms / 1000 - (time.monotonic() - started))
                if reply.source == "mock" and delay > 0:
                    await asyncio.sleep(delay)

            if self.turn_id != turn_id:
                return

            directive = {
                "emotion": reply.emotion,
                "action": reply.action,
            }
            if reply.scene:
                directive["scene"] = reply.scene
            if reply.camera:
                directive["camera"] = reply.camera
            if reply.fx:
                directive["fx"] = reply.fx
            await self.send(
                {
                    "type": "reply.directive",
                    "sessionId": self.session_id,
                    "turnId": turn_id,
                    "epoch": epoch,
                    "chunkIndex": 0,
                    "revision": 0,
                    "directive": directive,
                    "source": reply.source,
                    "timestamp": now_ms(),
                }
            )

            first_text_ms = int((time.monotonic() - started) * 1000)
            await self.send(
                {
                    "type": "reply.text.delta",
                    "sessionId": self.session_id,
                    "turnId": turn_id,
                    "epoch": epoch,
                    "chunkIndex": 0,
                    "text": reply.text,
                    "timestamp": now_ms(),
                }
            )

            audio = reply.audio or audio_for(reply)
            duration_s = 2.6
            if audio:
                first_audio_ms = int((time.monotonic() - started) * 1000)
                duration_s = audio["durationMs"] / 1000
                await self.send(
                    {
                        "type": "reply.audio.chunk",
                        "sessionId": self.session_id,
                        "turnId": turn_id,
                        "epoch": epoch,
                        "chunkIndex": 0,
                        "url": audio["url"],
                        "durationMs": audio["durationMs"],
                        "format": audio.get("format", "audio/wav"),
                        "timestamp": now_ms(),
                    }
                )

            media = media_for(reply)
            if media:
                # Let the line land before revealing the photograph.
                await asyncio.sleep(0.75)
                if self.turn_id != turn_id:
                    return
                await self.send(
                    {
                        "type": "reply.directive",
                        "sessionId": self.session_id,
                        "turnId": turn_id,
                        "epoch": epoch,
                        "chunkIndex": 1,
                        "revision": 1,
                        "directive": {"media": media},
                        "timestamp": now_ms(),
                    }
                )

            await asyncio.sleep(max(0.8, duration_s + 0.3))
            if self.turn_id != turn_id:
                return
            await self.send(
                {
                    "type": "reply.end",
                    "sessionId": self.session_id,
                    "turnId": turn_id,
                    "epoch": epoch,
                    "status": "completed",
                    "timing": {
                        "firstTextMs": first_text_ms,
                        "firstAudioMs": first_audio_ms,
                        "totalMs": int((time.monotonic() - started) * 1000),
                    },
                    "timestamp": now_ms(),
                }
            )
            if reply.ending:
                self.ended = True
                await asyncio.sleep(0.35)
                await self.send(
                    {
                        "type": "session.ended",
                        "sessionId": self.session_id,
                        "reason": "story_complete",
                        "timestamp": now_ms(),
                    }
                )
        except asyncio.CancelledError:
            # Drop an unanswered user turn from the live history so the next
            # provider call does not see a dangling question.
            if self.history and self.history[-1].get("role") == "user":
                self.history.pop()
            logger.info("turn cancelled session=%s turn=%s", self.session_id, turn_id)
            raise
        except Exception:
            logger.exception("turn failed session=%s turn=%s", self.session_id, turn_id)
            await self.send_error(
                "E_TURN",
                "llm",
                "这一轮的回复中断了，可以再试一次。",
                recoverable=True,
                turn_id=turn_id,
            )
            await self.send(
                {
                    "type": "reply.end",
                    "sessionId": self.session_id,
                    "turnId": turn_id,
                    "epoch": epoch,
                    "status": "failed",
                    "error": {"code": "E_TURN", "stage": "llm", "recoverable": True},
                    "timestamp": now_ms(),
                }
            )
        finally:
            if self.task is asyncio.current_task():
                self.task = None
                self.turn_id = None


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "mode": MODE, "provider": LIVE.label if LIVE and MODE == "live" else "mock", "version": app.version}


@app.get("/api/config")
async def api_config() -> dict:
    return {
        "mode": MODE,
        "provider": LIVE.label if LIVE and MODE == "live" else "mock",
        "wsPath": "/ws/session",
        "title": "雨停之前",
        "character": "Mira",
        "assets": "/assets/manifest.json",
        "capabilities": {
            "audio": True,
            "tts": TTS.name if TTS and TTS.available else ("mock-assets" if MODE == "mock" else "unavailable"),
            "media": True,
            "stt": "tencent" if asr_ready() else "browser",
            "asr": "tencent" if asr_ready() else "browser",
        },
    }


@app.get("/api/assets/manifest")
async def assets_manifest() -> JSONResponse:
    return JSONResponse(ASSETS)


@app.on_event("shutdown")
async def _shutdown() -> None:
    if LIVE is not None:
        await LIVE.close()


@app.websocket("/ws/asr")
async def asr_socket(socket: WebSocket) -> None:
    """Bridge browser microphone PCM to Tencent realtime ASR.

    The browser owns the microphone and echo cancellation; credentials and the
    provider connection stay on the server. A failed connection is reported to
    the page so it can fall back to typing instead of silently showing
    "listening" with a dead recognizer.
    """
    await socket.accept()
    if not asr_ready():
        await socket.send_json({"type": "asr.error", "message": "语音识别服务尚未配置"})
        await socket.close()
        return

    async def emit(event: dict) -> None:
        try:
            await socket.send_json(event)
        except Exception:
            pass

    stream = TencentASRStream(emit)
    try:
        await stream.connect()
        await socket.send_json({"type": "asr.ready"})
        while True:
            message = await socket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            raw = message.get("bytes")
            if raw is not None:
                if len(raw) > 1_000_000 or len(raw) % 2:
                    continue
                stream.feed(raw)
                continue
            text = message.get("text")
            if not text:
                continue
            try:
                control = json.loads(text)
            except json.JSONDecodeError:
                continue
            if control.get("type") in {"stop", "end"}:
                break
            if control.get("type") == "ping":
                await socket.send_json({"type": "pong"})
    except ASRError as error:
        await emit({"type": "asr.error", "message": str(error), "recoverable": False})
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("ASR websocket failed")
        await emit({"type": "asr.error", "message": "语音识别连接中断，请点麦克风重试", "recoverable": True})
    finally:
        await stream.close()


@app.websocket("/ws/session")
async def session_socket(socket: WebSocket) -> None:
    await socket.accept()
    runtime: SessionRuntime | None = None
    try:
        while True:
            raw = await socket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                if runtime:
                    await runtime.send_error("E_PROTOCOL", "protocol", "消息格式不正确。", recoverable=True)
                else:
                    await socket.send_json(
                        {"type": "sys.error", "code": "E_PROTOCOL", "stage": "protocol",
                         "message": "消息格式不正确。", "recoverable": True}
                    )
                continue
            if not isinstance(data, dict):
                continue
            kind = data.get("type")
            if runtime is None:
                if kind != "session.start":
                    await socket.send_json(
                        {"type": "sys.error", "code": "E_SESSION_STATE", "stage": "session",
                         "message": "请先开始会话。", "recoverable": False}
                    )
                    continue
                try:
                    start = SessionStart.model_validate(data)
                except ValidationError as error:
                    await socket.send_json(
                        {"type": "sys.error", "code": "E_PROTOCOL", "stage": "protocol",
                         "message": "会话参数不正确。", "recoverable": False,
                         "details": error.errors(include_url=False)}
                    )
                    continue
                runtime = SessionRuntime(socket, start.sessionId)
                await runtime.ready()
                opening_turn = f"opening-{uuid.uuid4().hex[:8]}"
                await runtime.start_turn(opening_turn, 0, "", opening=True)
                continue

            try:
                if kind == "ping":
                    Ping.model_validate(data)
                    await runtime.send({"type": "pong", "timestamp": now_ms()})
                elif kind == "user.text":
                    msg = UserText.model_validate(data)
                    if msg.sessionId != runtime.session_id:
                        await runtime.send_error("E_SESSION_ID", "session", "会话标识不匹配。", recoverable=False)
                        continue
                    await runtime.start_turn(msg.turnId, msg.epoch, msg.text, input_mode=msg.inputMode)
                elif kind == "user.interrupt":
                    msg = UserInterrupt.model_validate(data)
                    if msg.sessionId != runtime.session_id:
                        await runtime.send_error("E_SESSION_ID", "session", "会话标识不匹配。", recoverable=False)
                        continue
                    await runtime.cancel_current(notify=True)
                elif kind == "session.end":
                    SessionEnd.model_validate(data)
                    await runtime.cancel_current(notify=False)
                    await runtime.send({"type": "session.ended", "sessionId": runtime.session_id, "reason": "client_stop"})
                    break
                else:
                    await runtime.send_error("E_PROTOCOL", "protocol", f"未知消息类型：{kind}", recoverable=True)
            except ValidationError:
                await runtime.send_error("E_PROTOCOL", "protocol", "消息字段不完整或格式不正确。", recoverable=True)
    except WebSocketDisconnect:
        logger.info("socket disconnected")
    except Exception:
        logger.exception("socket loop failed")
    finally:
        if runtime:
            await runtime.cancel_current(notify=False)


if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
