from __future__ import annotations

import os
import unittest
from unittest.mock import AsyncMock, patch

from app.live import LiveConfig, LiveLLM, replies_too_similar


REPLY_JSON = (
    '{"text":"嗨，坐吧。","emotion":"soft","action":"none",'
    '"scene":"none","camera":"none","fx":"none","media":"none","ending":false}'
)


class FakeResponse:
    def __init__(self, status_code: int, content: str = REPLY_JSON) -> None:
        self.status_code = status_code
        self._content = content

    def json(self) -> dict:
        return {"choices": [{"message": {"content": self._content}}]}


class FakeClient:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = responses
        self.bodies: list[dict] = []

    async def post(self, url: str, headers: dict, json: dict) -> FakeResponse:
        # The production path removes the flag in place before retrying; keep
        # a copy so the first request is observable in the assertion.
        self.bodies.append(dict(json))
        return self.responses.pop(0)


def make_llm() -> LiveLLM:
    return LiveLLM(
        LiveConfig(
            provider="qwen",
            api_key="test-key",
            base_url="https://example.invalid/v1",
            model="qwen3.8-flash",
        )
    )


class LiveThinkingTests(unittest.IsolatedAsyncioTestCase):
    async def test_qwen_disables_hidden_reasoning(self) -> None:
        client = FakeClient([FakeResponse(200)])
        llm = make_llm()
        with patch.dict(os.environ, {"LLM_ENABLE_THINKING": "0"}), patch.object(
            llm, "_client_get", new=AsyncMock(return_value=client)
        ):
            reply = await llm.respond("你好", [])

        self.assertEqual(reply.text, "嗨，坐吧。")
        self.assertIs(client.bodies[0]["enable_thinking"], False)

    async def test_provider_that_rejects_thinking_flag_is_retried(self) -> None:
        client = FakeClient([FakeResponse(400), FakeResponse(200)])
        llm = make_llm()
        with patch.dict(os.environ, {"LLM_ENABLE_THINKING": "0"}), patch.object(
            llm, "_client_get", new=AsyncMock(return_value=client)
        ):
            reply = await llm.respond("你好", [])

        self.assertEqual(reply.text, "嗨，坐吧。")
        self.assertEqual(len(client.bodies), 2)
        self.assertIn("enable_thinking", client.bodies[0])
        self.assertNotIn("enable_thinking", client.bodies[1])


class LiveRepetitionTests(unittest.TestCase):
    def test_detects_a_repeated_line(self) -> None:
        self.assertTrue(replies_too_similar("嗯，我在。这种时候硬撑最没意思了。", "嗯，我在！这种时候硬撑最没意思了。"))

    def test_keeps_distinct_lines(self) -> None:
        self.assertFalse(replies_too_similar("嗯，我在。", "雨停了，光落在桌面上。"))


if __name__ == "__main__":
    unittest.main()
