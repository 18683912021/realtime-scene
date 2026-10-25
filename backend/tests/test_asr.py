from __future__ import annotations

import os
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from app.asr import credentials_ready, signed_url


class ASRTests(unittest.TestCase):
    def test_signed_url_uses_general_streaming_profile_without_leaking_key(self) -> None:
        url = signed_url("123456", "secret-id", "secret-key", "voice-1")
        parsed = urlsplit(url)
        params = {key: value[0] for key, value in parse_qs(parsed.query).items()}

        self.assertEqual(parsed.hostname, "asr.cloud.tencent.com")
        self.assertEqual(parsed.path, "/asr/v2/123456")
        self.assertEqual(params["engine_model_type"], "16k_zh")
        self.assertEqual(params["voice_format"], "1")
        self.assertNotIn("secret-key", url)
        self.assertTrue(params["signature"])

    def test_credentials_are_all_or_nothing(self) -> None:
        with patch.dict(
            os.environ,
            {
                "TENCENT_ASR_APP_ID": "123456",
                "TENCENT_ASR_SECRET_ID": "id",
                "TENCENT_ASR_SECRET_KEY": "key",
            },
            clear=False,
        ):
            self.assertTrue(credentials_ready())
        with patch.dict(os.environ, {"TENCENT_ASR_SECRET_KEY": ""}, clear=False):
            self.assertFalse(credentials_ready())


if __name__ == "__main__":
    unittest.main()
