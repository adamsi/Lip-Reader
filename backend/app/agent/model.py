"""Chat model definition + structured-output bindings for the agent nodes."""
from typing import Literal

from langchain_anthropic import ChatAnthropic
from pydantic import BaseModel, Field

from .. import config


class Correction(BaseModel):
    """Output of the `generate` node."""

    corrected: str = Field(description="The corrected sentence, normally capitalized and punctuated.")


class Review(BaseModel):
    """Output of the `reflect` node."""

    verdict: Literal["approve", "revise"] = Field(
        description="'approve' if the correction is natural and faithful, else 'revise'."
    )
    feedback: str = Field(
        description="When revising: one short sentence saying what to fix. Empty when approving."
    )


# One shared model; temperature 0 and a small max_tokens keep latency and cost low.
llm = ChatAnthropic(model=config.LLM_MODEL, temperature=0, max_tokens=512, timeout=30)

generate_llm = llm.with_structured_output(Correction)
reflect_llm = llm.with_structured_output(Review)
