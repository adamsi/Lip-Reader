"""Reflection agent: generate -> reflect -> (revise once | return).

Every LLM call appends a {module, prompt, response} step to the state so the
API can return the full trace; module names match the architecture diagram.
Worst case 3 LLM calls: generate, reflect, one revision.
"""
import operator
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph

from .model import generate_llm, reflect_llm
from .prompts import GENERATE_SYSTEM_PROMPT, REFLECT_SYSTEM_PROMPT


class State(TypedDict):
    raw_text: str
    corrected: str
    verdict: str
    feedback: str
    generations: int
    steps: Annotated[list[dict], operator.add]


def generate(state: State) -> dict:
    user = f"Input: {state['raw_text']}"
    if state.get("feedback"):
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
    # The single revision is final: skip a second review round.
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


def run_agent(raw_text: str) -> dict:
    """Correct one utterance. Returns {"response": str, "steps": [...]}."""
    final = agent.invoke({"raw_text": raw_text, "feedback": "", "generations": 0, "steps": []})
    text = final["corrected"].strip()
    if text and text[-1] not in ".?!":
        text += "."
    return {"response": text, "steps": final["steps"]}
