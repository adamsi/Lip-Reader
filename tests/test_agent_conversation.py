"""Agent-level tests for conversation-aware reflection (autonomy).

The first generate pass is stateless; reflect sees the conversation history and
must revise context-implausible words to visually similar ones - and must NOT
over-revise corrections that already fit.
"""

import os
import sys

import pytest

_REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
sys.path.insert(0, _REPO_ROOT)

from backend.app.agent import run_agent  # noqa: E402
from backend.app import config  # noqa: E402

pytestmark = pytest.mark.skipif(
    not config.ANTHROPIC_API_KEY, reason="ANTHROPIC_API_KEY not configured"
)


class TestNoConversation:
    """Without history the behavior matches the pre-chat agent."""

    def test_normal_sentences_approve_first_pass(self):
        sentences = [
            "I NEED MY BEDICINE NOW",
            "IM SO EXCITED TO ME YOU TODAY",
            "CAN YOU TURN OF THE LIGHT PLEASE",
        ]
        approved = 0
        for raw in sentences:
            result = run_agent(raw)
            modules = [s["module"] for s in result["steps"]]
            assert modules[0] == "generate"
            assert result["response"][-1] in ".?!"
            if modules == ["generate", "reflect"]:
                approved += 1
        # no over-revision: the common path stays 2 LLM calls
        assert approved >= 2, f"only {approved}/3 approved on first pass"

    def test_correction_quality(self):
        result = run_agent("I NEED MY BEDICINE NOW")
        assert "medicine" in result["response"].lower()


class TestConversationRevise:
    """Context-free correction is plausible but wrong; reflect must fix it."""

    @pytest.mark.parametrize(
        "raw,conversation,expected_word",
        [
            (
                "WHERES MY BILL",
                [
                    {"role": "other", "content": "The nurse has your evening medication ready."},
                    {"role": "self", "content": "Thank you, I was waiting for it."},
                ],
                "pill",
            ),
            (
                "CAN YOU TURN UP THE HEAT",
                [{"role": "other", "content": "I love this song, it's my favorite."}],
                "beat",
            ),
        ],
    )
    def test_contextual_revise(self, raw, conversation, expected_word):
        result = run_agent(raw, conversation)
        modules = [s["module"] for s in result["steps"]]
        assert modules == ["generate", "reflect", "generate"], (
            f"expected a revise loop, got {modules}: {result['response']!r}"
        )
        assert expected_word in result["response"].lower()

    def test_context_that_fits_approves(self):
        # the correction already fits the conversation -> reflect must approve
        result = run_agent(
            "WHERES MY BILL",
            [{"role": "other", "content": "The electricity invoice arrived in the mail."}],
        )
        modules = [s["module"] for s in result["steps"]]
        assert modules == ["generate", "reflect"]
        assert "bill" in result["response"].lower()


class TestStatelessFirstGenerate:
    def test_history_never_leaks_into_first_generate(self):
        conversation = [
            {"role": "other", "content": "The nurse has your evening medication ready."}
        ]
        result = run_agent("WHERES MY BILL", conversation)
        steps = result["steps"]
        first_generate = steps[0]
        assert first_generate["module"] == "generate"
        assert "medication" not in first_generate["prompt"]["input"]
        assert "Conversation" not in first_generate["prompt"]["input"]
        # reflect DOES see the transcript
        reflect = steps[1]
        assert reflect["module"] == "reflect"
        assert "medication" in reflect["prompt"]["input"]

    def test_window_and_role_filtering(self):
        # >10 messages are clamped, junk roles dropped, without errors
        conversation = [
            {"role": "other", "content": f"filler message {i}"} for i in range(12)
        ] + [{"role": "narrator", "content": "ignored"}, {"role": "self", "content": "  "}]
        result = run_agent("I NEED MY BEDICINE NOW", conversation)
        reflect_input = result["steps"][1]["prompt"]["input"]
        assert "filler message 1\n" not in reflect_input  # clamped to last 10
        assert "filler message 2" in reflect_input
        assert "filler message 11" in reflect_input
        assert "ignored" not in reflect_input
