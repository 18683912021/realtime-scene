"""TTS providers for live replies.

Default: Edge TTS (natural Chinese neural voices, no API key).
Fallback: macOS `say` (offline, useful when Edge is unreachable).
Tencent Cloud TTS is intentionally not enabled here: the existing Tencent
speech credentials are valid, but the TTS resource pack is exhausted.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import re
import shutil
import uuid
import wave
from dataclasses import dataclass
from pathlib import Path

import edge_tts
from mutagen.mp3 import MP3

TTS_DIR = Path(__file__).resolve().parents[1] / "generated_tts"
EDGE_VOICE = os.getenv("TTS_VOICE", "zh-CN-XiaoyiNeural")
EDGE_RATE = os.getenv("TTS_RATE", "+4%")
EDGE_PITCH = os.getenv("TTS_PITCH", "+2Hz")
MAC_VOICE = os.getenv("TTS_MAC_VOICE", "Tingting")
MAC_RATE = int(os.getenv("TTS_MAC_RATE", "180"))


def edge_style(emotion: str) -> tuple[str, str]:
    if emotion == "surprised":
        return "+12%", "+10Hz"
    if emotion == "guarded":
        return "0%", "-3Hz"
    return EDGE_RATE, EDGE_PITCH


def mac_style(emotion: str) -> int:
    if emotion == "surprised":
        return MAC_RATE + 22
    if emotion == "guarded":
        return max(120, MAC_RATE - 10)
    return MAC_RATE


@dataclass
class TTSAudio:
    url: str
    duration_ms: int
    path: str
    format: str = "audio/wav"


class TTSError(RuntimeError):
    pass


def clean_for_speech(text: str) -> str:
    value = re.sub(r"```.*?```", " ", text, flags=re.S)
    value = re.sub(r"`([^`]*)`", r"\1", value)
    value = re.sub(r"https?://\S+", " ", value)
    value = re.sub(r"[*_#>\[\]{}|]", "", value)
    value = re.sub(r"\s+", " ", value).strip()
    if len(value) > 600:
        value = value[:600].rsplit("。", 1)[0] + "。"
    return value


class MacSayTTS:
    """Offline macOS fallback."""

    name = "macsay"

    def __init__(self) -> None:
        self.voice = MAC_VOICE
        self.rate = MAC_RATE
        self._semaphore = asyncio.Semaphore(2)
        TTS_DIR.mkdir(parents=True, exist_ok=True)

    @property
    def available(self) -> bool:
        return bool(shutil.which("say") and shutil.which("afconvert"))

    async def synthesize(self, text: str, emotion: str = "soft") -> TTSAudio:
        value = clean_for_speech(text)
        if not value:
            raise TTSError("回复没有可朗读的文本")
        rate = mac_style(emotion)
        digest = hashlib.sha256(f"mac|{self.voice}|{rate}|{value}".encode()).hexdigest()[:24]
        wav_path = TTS_DIR / f"{digest}.wav"
        if wav_path.exists():
            return TTSAudio(f"/api/tts/{digest}.wav", _wav_duration(wav_path), str(wav_path), "audio/wav")
        async with self._semaphore:
            if wav_path.exists():
                return TTSAudio(f"/api/tts/{digest}.wav", _wav_duration(wav_path), str(wav_path), "audio/wav")
            temp_aiff = Path("/tmp") / f"mira_tts_{uuid.uuid4().hex}.aiff"
            try:
                await _run(["say", "-v", self.voice, "-r", str(rate), "-o", str(temp_aiff), value], 30)
                await _run(["afconvert", "-f", "WAVE", "-d", "LEI16@22050", str(temp_aiff), str(wav_path)], 30)
                duration = _wav_duration(wav_path)
            except Exception as error:
                wav_path.unlink(missing_ok=True)
                raise TTSError("本地语音合成失败") from error
            finally:
                temp_aiff.unlink(missing_ok=True)
        return TTSAudio(f"/api/tts/{digest}.wav", duration, str(wav_path), "audio/wav")


class EdgeTTS:
    """Natural Chinese neural TTS with a local macOS fallback."""

    name = "edge"

    def __init__(self) -> None:
        self.voice = EDGE_VOICE
        self.rate = EDGE_RATE
        self.pitch = EDGE_PITCH
        self._fallback = MacSayTTS()
        self._semaphore = asyncio.Semaphore(2)
        TTS_DIR.mkdir(parents=True, exist_ok=True)

    @property
    def available(self) -> bool:
        return True

    async def synthesize(self, text: str, emotion: str = "soft") -> TTSAudio:
        value = clean_for_speech(text)
        if not value:
            raise TTSError("回复没有可朗读的文本")
        rate, pitch = edge_style(emotion)
        digest = hashlib.sha256(f"edge|{self.voice}|{rate}|{pitch}|{value}".encode()).hexdigest()[:24]
        path = TTS_DIR / f"{digest}.mp3"
        if path.exists():
            return TTSAudio(f"/api/tts/{digest}.mp3", _mp3_duration(path), str(path), "audio/mpeg")
        async with self._semaphore:
            if path.exists():
                return TTSAudio(f"/api/tts/{digest}.mp3", _mp3_duration(path), str(path), "audio/mpeg")
            temp = path.with_suffix(f".{uuid.uuid4().hex}.tmp.mp3")
            try:
                await asyncio.wait_for(
                    edge_tts.Communicate(value, self.voice, rate=rate, pitch=pitch).save(str(temp)),
                    35,
                )
                temp.replace(path)
                return TTSAudio(f"/api/tts/{digest}.mp3", _mp3_duration(path), str(path), "audio/mpeg")
            except Exception as error:
                temp.unlink(missing_ok=True)
                # Network/voice failures should not kill the turn; keep a voice.
                if self._fallback.available:
                    return await self._fallback.synthesize(value, emotion)
                raise TTSError("语音合成失败") from error


def create_tts_provider() -> EdgeTTS | MacSayTTS:
    provider = (os.getenv("TTS_PROVIDER") or "edge").strip().lower()
    if provider == "macsay":
        return MacSayTTS()
    return EdgeTTS()


async def _run(args: list[str], timeout: float) -> None:
    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        await asyncio.wait_for(process.wait(), timeout)
    except asyncio.CancelledError:
        process.kill()
        await process.wait()
        raise
    except TimeoutError:
        process.kill()
        await process.wait()
        raise TTSError("语音合成超时")
    if process.returncode:
        raise TTSError(f"TTS command failed: {args[0]}")


def _wav_duration(path: Path) -> int:
    with wave.open(str(path), "rb") as handle:
        return int(handle.getnframes() / handle.getframerate() * 1000)


def _mp3_duration(path: Path) -> int:
    return int(MP3(str(path)).info.length * 1000)
