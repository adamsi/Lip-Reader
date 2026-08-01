"""Reflection agent: generate -> reflect -> (revise once | return).

Short-term memory follows the sigma-agent-server pattern: the caller passes a
last-N window of the conversation. The first generate pass never sees it - only
reflect and the revision pass do, so reflect holds the context and can genuinely
overrule a context-free correction.
"""
import operator
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph

from .model import generate_llm, reflect_llm
from .prompts import GENERATE_SYSTEM_PROMPT, REFLECT_SYSTEM_PROMPT

MEMORY_WINDOW = 10
MAX_MESSAGE_CHARS = 500


class State(TypedDict):
    raw_text: str
    conversation: list[dict]
    corrected: str
    verdict: str
    feedback: str
    generations: int
    steps: Annotated[list[dict], operator.add]


def _transcript(conversation: list[dict]) -> str:
    return "\n".join(
        f"{'You' if m['role'] == 'self' else 'Other'}: {m['content']}"
        for m in conversation
    )


def generate(state: State) -> dict:
    user = f"Input: {state['raw_text']}"
    if state.get("feedback"):
        transcript = _transcript(state["conversation"])
        if transcript:
            user += f"\nConversation so far (the speaker is 'You'):\n{transcript}"
        user += (
            f"\nYour previous correction: {state['corrected']}"
            f"\nReviewer feedback to address: {state['feedback']}"
        )
    correction = generate_llm.invoke(
        [("system", GENERATE_SYSTEM_PROMPT), ("user", user)]
    )
    return {
        "corrected": correction.corrected,
        "generations": state.get("generations", 0) + 1,
        "steps": [{
            "module": "generate",
            "prompt": {"system": GENERATE_SYSTEM_PROMPT, "input": user},
            "response": correction.model_dump(),
        }],
    }


def reflect(state: State) -> dict:
    user = f"Raw: {state['raw_text']} | Correction: {state['corrected']}"
    transcript = _transcript(state["conversation"])
    if transcript:
        user = f"Conversation so far (the speaker is 'You'):\n{transcript}\n\n{user}"
    review = reflect_llm.invoke(
        [("system", REFLECT_SYSTEM_PROMPT), ("user", user)]
    )
    return {
        "verdict": review.verdict,
        "feedback": review.feedback,
        "steps": [{
            "module": "reflect",
            "prompt": {"system": REFLECT_SYSTEM_PROMPT, "input": user},
            "response": review.model_dump(),
        }],
    }


def after_generate(state: State) -> str:
    return END if state["generations"] > 1 else "reflect"


def after_reflect(state: State) -> str:
    return "generate" if state["verdict"] == "revise" else END


builder = StateGraph(State)
builder.add_node("generate", generate)
builder.add_node("reflect", reflect)
builder.add_edge(START, "generate")
builder.add_conditional_edges("generate", after_generate)
builder.add_conditional_edges("reflect", after_reflect)
agent = builder.compile()


def run_agent(raw_text: str, conversation: list[dict] | None = None) -> dict:
    history = [
        {"role": m["role"], "content": str(m["content"])[:MAX_MESSAGE_CHARS]}
        for m in (conversation or [])
        if isinstance(m, dict)
        and m.get("role") in ("self", "other")
        and str(m.get("content", "")).strip()
    ][-MEMORY_WINDOW:]
    final = agent.invoke({
        "raw_text": raw_text,
        "conversation": history,
        "feedback": "",
        "generations": 0,
        "steps": [],
    })
    text = final["corrected"].strip()
    if text and text[-1] not in ".?!":
        text += "."
    return {"response": text, "steps": final["steps"]}
