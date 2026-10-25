"""Deterministic Mock script for the Mira scene.

The script is intentionally small and readable: each response has text, voice,
emotion, action and optional scene/media directives. It is the backend half of
the no-key demo and follows the same event contract as a future live provider.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ASSET_PATH = Path(__file__).with_name("assets_manifest.json")
ASSETS = json.loads(ASSET_PATH.read_text()) if ASSET_PATH.exists() else {}
AUDIO = {item["key"]: item for item in ASSETS.get("voice", [])}
MEDIA = {item["key"]: item for item in ASSETS.get("media", [])}


@dataclass
class StoryState:
    scene: str = "warm"
    lightning_seen: bool = False
    photo_seen: bool = False
    closing: bool = False


@dataclass
class Reply:
    key: str
    text: str
    emotion: str = "soft"
    action: str = "none"
    scene: str | None = None
    camera: str | None = None
    fx: str | None = None
    media_key: str | None = None
    ending: bool = False
    thinking_ms: int = 520
    audio: dict | None = None
    source: str = "mock"



def _reply(key: str, **kwargs: Any) -> Reply:
    voice = AUDIO.get(key)
    text = voice["text"] if voice else kwargs.pop("text", "")
    return Reply(key=key, text=text, **kwargs)


RESPONSES: dict[str, Reply] = {
    "greeting": _reply("greeting", emotion="soft", action="look_window", thinking_ms=650),
    "waiting": _reply("waiting", emotion="guarded", action="look_window"),
    "camera": _reply("camera", emotion="soft", action="wipe_lens"),
    "photo": _reply("photo", emotion="soft", action="wipe_lens", media_key="photo_star"),
    "lightning": _reply(
        "lightning",
        emotion="surprised",
        action="step_back",
        scene="street",
        camera="push_in",
        fx="lightning",
        thinking_ms=380,
    ),
    "stars": _reply("stars", emotion="soft", action="look_window"),
    "ending": _reply("ending", emotion="soft", action="none", ending=True, thinking_ms=700),
    "fallback": _reply("fallback", emotion="soft", action="none", thinking_ms=460),
}


def choose(text: str, state: StoryState) -> Reply:
    value = text.strip()
    if any(word in value for word in ("再见", "走了", "结束", "拜拜")):
        state.closing = True
        return RESPONSES["ending"]
    if any(word in value for word in ("闪电", "打雷", "雷声", "雷")):
        state.lightning_seen = True
        return RESPONSES["lightning"]
    if any(word in value for word in ("照片", "相片", "拍的照片")):
        state.photo_seen = True
        return RESPONSES["photo"]
    if any(word in value for word in ("相机", "镜头", "拍照", "摄影")):
        return RESPONSES["camera"]
    if any(word in value for word in ("发夹", "星星", "发饰")):
        return RESPONSES["stars"]
    if any(word in value for word in ("等谁", "等人", "在等", "等一个人")):
        return RESPONSES["waiting"]
    if any(word in value for word in ("你好", "在吗", "嗨", "晚上好")):
        return RESPONSES["greeting"]
    return RESPONSES["fallback"]


def audio_for(reply: Reply) -> dict | None:
    return AUDIO.get(reply.key)


def media_for(reply: Reply) -> dict | None:
    if not reply.media_key:
        return None
    source = MEDIA.get(reply.media_key)
    if not source:
        return None
    return {
        "id": source["key"],
        "type": "image",
        "url": source["url"],
        "width": source.get("width"),
        "height": source.get("height"),
        "caption": "窗边，雨刚停。",
        "durationMs": 9000,
    }
