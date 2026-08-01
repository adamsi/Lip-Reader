"""Chat model definition + structured-output bindings for the agent nodes."""
from typing import Literal

from langchain_anthropic import ChatAnthropic
from pydantic import BaseModel, Field

from .. import config


class Correction(BaseModel):
    corrected: str = Field(description="The corrected sentence, normally capitalized and punctuated.")


class Review(BaseModel):
    # analysis comes first so the verdict is decided after checking the context
    analysis: str = Field(
        description=(
            "One or two short sentences checking each content word of the "
            "correction against the conversation (when shown): is it plausible "
            "as the speaker's next utterance, or does a visually similar word "
            "fit the context better?"
        )
    )
    verdict: Literal["approve", "revise"] = Field(
        description="'approve' if the correction is natural, faithful and fits the context, else 'revise'."
    )
    feedback: str = Field(
        description="When revising: one short sentence saying what to fix. Empty when approving."
    )


llm = ChatAnthropic(model=config.LLM_MODEL, temperature=0, max_tokens=512, timeout=30)

generate_llm = llm.with_structured_output(Correction)
reflect_llm = llm.with_structured_output(Review)
