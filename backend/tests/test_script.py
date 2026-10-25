import unittest

from app.script import AUDIO, RESPONSES, StoryState, choose


class MockScriptTests(unittest.TestCase):
    def test_emotions_and_actions_cover_demo_requirements(self):
        emotions = {reply.emotion for reply in RESPONSES.values()}
        actions = {reply.action for reply in RESPONSES.values()}
        self.assertGreaterEqual(len(emotions), 3)
        self.assertGreaterEqual(len(actions - {"none"}), 2)

    def test_lightning_is_a_dialogue_triggered_scene_event(self):
        state = StoryState()
        reply = choose("刚才有闪电吗？", state)
        self.assertEqual(reply.key, "lightning")
        self.assertEqual(reply.emotion, "surprised")
        self.assertEqual(reply.action, "step_back")
        self.assertEqual(reply.scene, "street")
        self.assertEqual(reply.fx, "lightning")
        self.assertTrue(state.lightning_seen)

    def test_photo_event_and_guarded_answer(self):
        state = StoryState()
        photo = choose("给我看看你拍的照片", state)
        self.assertEqual(photo.media_key, "photo_star")
        self.assertTrue(state.photo_seen)
        guarded = choose("你在等谁？", state)
        self.assertEqual(guarded.key, "waiting")
        self.assertEqual(guarded.emotion, "guarded")
        self.assertEqual(guarded.action, "look_window")

    def test_every_response_has_a_voice_asset(self):
        for key in ("greeting", "waiting", "camera", "photo", "lightning", "stars", "ending", "fallback"):
            self.assertIn(key, AUDIO)
            self.assertGreater(AUDIO[key]["durationMs"], 500)
            self.assertTrue(AUDIO[key]["url"].startswith("/assets/audio/"))


if __name__ == "__main__":
    unittest.main()
