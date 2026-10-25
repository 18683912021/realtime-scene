"""Tencent Cloud realtime ASR bridge for the browser microphone.

The browser sends 16 kHz mono PCM16 over `/ws/asr`; this module keeps the
Tencent credentials server-side and forwards transcripts back. It replaces the
browser Web Speech recognizer, whose capture path can bypass the page's echo
cancellation and can silently die between turns.

Protocol reference: https://cloud.tencent.com/document/product/1093/48982
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import ssl
import time
import uuid
from collections.abc import Awaitable, Callable
from urllib.parse import urlencode

import certifi
import websockets

logger = logging.getLogger("mira.asr")

PACKET_BYTES = 6400  # 200 ms of 16 kHz mono PCM16
TranscriptHandler = Callable[[dict], Awaitable[None]]


class ASRError(RuntimeError):
    pass


def credentials_ready() -> bool:
    return all(
        os.getenv(name, "").strip()
        for name in ("TENCENT_ASR_APP_ID", "TENCENT_ASR_SECRET_ID", "TENCENT_ASR_SECRET_KEY")
    )


def signed_url(app_id: str, secret_id: str, secret_key: str, voice_id: str) -> str:
    if not app_id.isascii() or not app_id.isdigit() or not secret_id or not secret_key:
        raise ASRError("腾讯语音识别凭据不完整")
    now = int(time.time())
    params = {
        "convert_num_mode": 1,
        "engine_model_type": "16k_zh",
        "expired": now + 3600,
        "filter_empty_result": 0,
        "filter_punc": 0,
        "needvad": 1,
        "nonce": secrets.randbelow(1_000_000_000),
        "secretid": secret_id,
        "timestamp": now,
        "vad_silence_time": 700,
        "voice_format": 1,
        "voice_id": voice_id,
    }
    ordered = sorted(params.items())
    path = f"asr.cloud.tencent.com/asr/v2/{app_id}"
    canonical = path + "?" + "&".join(f"{key}={value}" for key, value in ordered)
    signature = base64.b64encode(
        hmac.new(secret_key.encode(), canonical.encode(), hashlib.sha1).digest()
    ).decode()
    return "wss://" + path + "?" + urlencode(ordered + [("signature", signature)])


class TencentASRStream:
    """One continuous microphone stream; Tencent VAD emits sentence finals."""

    def __init__(self, on_transcript: TranscriptHandler) -> None:
        self._on_transcript = on_transcript
        self._ws = None
        self._send_task: asyncio.Task[None] | None = None
        self._recv_task: asyncio.Task[None] | None = None
        self._queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=200)
        self._running = False
        self._closing = False
        self._error_sent = False
        self._final_indexes: set[int] = set()
        self._stream_id = str(uuid.uuid4())
        self._app_id = os.getenv("TENCENT_ASR_APP_ID", "").strip()
        self._secret_id = os.getenv("TENCENT_ASR_SECRET_ID", "").strip()
        self._secret_key = os.getenv("TENCENT_ASR_SECRET_KEY", "").strip()

    async def connect(self) -> None:
        if not credentials_ready():
            raise ASRError("尚未配置腾讯语音识别凭据")
        url = signed_url(self._app_id, self._secret_id, self._secret_key, self._stream_id)
        self._ws = await websockets.connect(
            url,
            open_timeout=8,
            ping_interval=20,
            ping_timeout=10,
            close_timeout=3,
            proxy=None,
            ssl=ssl.create_default_context(cafile=certifi.where()),
            max_size=4 * 1024 * 1024,
        )
        try:
            raw = await asyncio.wait_for(self._ws.recv(), 8)
            data = json.loads(raw)
            code = data.get("code", 0)
            if code:
                raise ASRError(self._friendly_error(code))
        except Exception:
            await self._ws.close()
            raise
        self._running = True
        self._final_indexes.clear()
        self._send_task = asyncio.create_task(self._send_loop())
        self._recv_task = asyncio.create_task(self._recv_loop())

    def feed(self, pcm: bytes) -> None:
        if not self._running or not pcm:
            return
        try:
            self._queue.put_nowait(pcm)
        except asyncio.QueueFull:
            logger.warning("ASR send queue full; dropping a chunk")

    async def _send_loop(self) -> None:
        pending = bytearray()
        try:
            while True:
                chunk = await self._queue.get()
                if chunk is None:
                    if pending:
                        await self._send_paced(bytes(pending))
                    await self._ws.send(json.dumps({"type": "end"}))
                    return
                pending.extend(chunk)
                while len(pending) >= PACKET_BYTES:
                    await self._send_paced(bytes(pending[:PACKET_BYTES]))
                    del pending[:PACKET_BYTES]
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("ASR sender stopped")
            self._running = False
            await self._notify_disconnect()

    async def _send_paced(self, pcm: bytes) -> None:
        if self._ws is None:
            return
        await self._ws.send(pcm)
        # Tencent rejects bursts that arrive faster than the audio duration.
        await asyncio.sleep(len(pcm) / 32000)

    async def _recv_loop(self) -> None:
        try:
            async for raw in self._ws:
                data = json.loads(raw)
                code = data.get("code", 0)
                if code:
                    raise ASRError(self._friendly_error(code))
                result = data.get("result")
                if not isinstance(result, dict):
                    continue
                text = result.get("voice_text_str", "")
                if not isinstance(text, str) or not text.strip():
                    continue
                index = result.get("index", 0)
                final = result.get("slice_type") == 2
                if not isinstance(index, int):
                    continue
                if final:
                    if index in self._final_indexes:
                        continue
                    self._final_indexes.add(index)
                elif index in self._final_indexes:
                    continue
                await self._on_transcript(
                    {
                        "type": "asr.final" if final else "asr.partial",
                        "text": text.strip(),
                        "index": index,
                        "final": final,
                    }
                )
        except asyncio.CancelledError:
            raise
        except ASRError as error:
            self._running = False
            if not self._closing and not self._error_sent:
                self._error_sent = True
                await self._on_transcript({"type": "asr.error", "message": str(error), "recoverable": False})
        except Exception as error:
            logger.warning("ASR receiver stopped: %s", type(error).__name__)
            self._running = False
            await self._notify_disconnect()
        else:
            if self._running:
                self._running = False
                await self._notify_disconnect()

    async def _notify_disconnect(self) -> None:
        if self._closing or self._error_sent:
            return
        self._error_sent = True
        await self._on_transcript({
            "type": "asr.error",
            "message": "语音识别连接中断，请点麦克风重试",
            "recoverable": True,
        })

    async def close(self) -> None:
        self._closing = True
        self._running = False
        if self._queue.empty():
            try:
                self._queue.put_nowait(None)
            except asyncio.QueueFull:
                pass
        else:
            # Drop queued audio on explicit close; do not delay the page.
            while not self._queue.empty() and self._queue.qsize() > 1:
                try:
                    self._queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
        if self._send_task and not self._send_task.done():
            try:
                await asyncio.wait_for(asyncio.shield(self._send_task), 1.5)
            except (TimeoutError, asyncio.TimeoutError):
                self._send_task.cancel()
        for task in (self._send_task, self._recv_task):
            if task and not task.done():
                task.cancel()
        await asyncio.gather(
            *(task for task in (self._send_task, self._recv_task) if task),
            return_exceptions=True,
        )
        if self._ws is not None:
            await self._ws.close()
            self._ws = None

    @staticmethod
    def _friendly_error(code: int) -> str:
        messages = {
            4001: "语音识别参数配置有误",
            4002: "语音识别鉴权失败，请检查服务端密钥",
            4003: "尚未开通腾讯语音识别服务",
            4004: "语音识别可用时长已耗尽",
            4005: "腾讯云账号欠费，语音识别已暂停",
            4006: "语音识别并发已满，请稍后再试",
            4007: "语音识别音频格式有误",
            4008: "语音识别等待音频超时",
            6001: "语音识别区域不匹配",
        }
        return messages.get(code, "语音识别服务暂时不可用")
