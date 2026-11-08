"""Greetings are answered at once, without a model call. Run:  python -m unittest test_ai_smalltalk   (from ai-server/)"""
import unittest
from unittest import mock
import agent

USER = {"id": "u1", "user_id": "u1", "features": ["use_assistant"], "profile": {"full_name": "Load Admin"}}


class SmallTalk(unittest.TestCase):
    def test_hi_is_answered_without_model(self):
        with mock.patch.object(agent, "llm", side_effect=AssertionError("model must not be called")):
            out = agent.chat("tok", USER, None, "hi")
        self.assertIn("Load", out["reply"])
        self.assertEqual(out["actions"], [])

    def test_real_question_still_goes_to_model(self):
        self.assertIsNone(agent._small_talk(USER, "how many students are in class 5?"))

    def test_ok_is_not_treated_as_small_talk(self):
        # \"ok\" often answers a question the assistant just asked, so it must reach the model
        self.assertIsNone(agent._small_talk(USER, "ok"))


if __name__ == "__main__":
    unittest.main()
