from __future__ import annotations

import unittest

from app.memory import ConversationMemory


class MemoryTests(unittest.TestCase):
    def test_extracts_volunteered_facts(self) -> None:
        memory = ConversationMemory()
        memory.observe(
            "我叫小林，我住在成都。我是一名平面设计师，最近在准备搬家。今天有点累，我喜欢摄影。"
        )

        self.assertEqual(memory.name, "小林")
        self.assertEqual(memory.city, "成都")
        self.assertEqual(memory.job, "平面设计师")
        self.assertIn("准备搬家", memory.notes)
        self.assertIn("最近有点累", memory.mood)
        self.assertIn("喜欢摄影", memory.likes)
        self.assertIn("摄影", memory.topics)

    def test_does_not_turn_a_question_into_a_city(self) -> None:
        memory = ConversationMemory()
        memory.observe("你在等谁？")
        self.assertEqual(memory.city, "")
        self.assertEqual(memory.job, "")


if __name__ == "__main__":
    unittest.main()
