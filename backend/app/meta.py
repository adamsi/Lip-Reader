"""Static metadata served by /api/team_info and /api/agent_info."""
from .agent.prompts import GENERATE_SYSTEM_PROMPT, REFLECT_SYSTEM_PROMPT

TEAM_INFO = {
    "group_batch_order_number": "1_1",
    "team_name": "Chaplin AI",
    "students": [
        {"name": "Adam Sion", "email": "adamsion74@gmail.com"},
        {"name": "Jonathan Eshel", "email": "jonathan.eshel1@gmail.com"},
    ],
}

_EXAMPLE_PROMPT = "THANK YOU DARLING YOU ARE JUST TOO KIND TODAY"
_EXAMPLE_RESPONSE = "Thank you, darling, you are just too kind today."
_EXAMPLE_STEPS = [
    {
        "module": "generate",
        "prompt": {
            "system": GENERATE_SYSTEM_PROMPT,
            "input": f"Input: {_EXAMPLE_PROMPT}",
        },
        "response": {"corrected": _EXAMPLE_RESPONSE},
    },
    {
        "module": "reflect",
        "prompt": {
            "system": REFLECT_SYSTEM_PROMPT,
            "input": f"Raw: {_EXAMPLE_PROMPT} | Correction: {_EXAMPLE_RESPONSE}",
        },
        "response": {
            "analysis": (
                "The correction matches the raw transcription word for word, with "
                "natural punctuation added (commas around \"darling\") and proper "
                "capitalization. No conversation context to check against."
            ),
            "verdict": "approve",
            "feedback": "",
        },
    },
]

# Real recorded run: context-free generate keeps 'bill', reflect sees the
# conversation and requests the visually similar 'pill', revision fixes it.
_CTX_PROMPT = "WHERES MY BILL"
_CTX_CONVERSATION = [
    {"role": "other", "content": "The nurse has your evening medication ready."},
    {"role": "self", "content": "Thank you, I was waiting for it."},
]
_CTX_RESPONSE = "Where's my pill?"
_CTX_TRANSCRIPT = (
    "Conversation so far (the speaker is 'You'):\n"
    "Other: The nurse has your evening medication ready.\n"
    "You: Thank you, I was waiting for it."
)
_CTX_ANALYSIS = (
    "The conversation is about evening medication being ready. Asking \"Where's "
    "my bill?\" doesn't fit this context, but \"pill\" is visually very similar "
    "to \"bill\" (p/b are classic lip-reading confusions) and \"Where's my "
    "pill?\" fits perfectly."
)
_CTX_FEEDBACK = (
    "'bill' should be 'pill' - p/b are visually identical on the lips, and the "
    "conversation is about medication."
)
_CTX_STEPS = [
    {
        "module": "generate",
        "prompt": {"system": GENERATE_SYSTEM_PROMPT, "input": f"Input: {_CTX_PROMPT}"},
        "response": {"corrected": "Where's my bill?"},
    },
    {
        "module": "reflect",
        "prompt": {
            "system": REFLECT_SYSTEM_PROMPT,
            "input": f"{_CTX_TRANSCRIPT}\n\nRaw: {_CTX_PROMPT} | Correction: Where's my bill?",
        },
        "response": {"analysis": _CTX_ANALYSIS, "verdict": "revise", "feedback": _CTX_FEEDBACK},
    },
    {
        "module": "generate",
        "prompt": {
            "system": GENERATE_SYSTEM_PROMPT,
            "input": (
                f"Input: {_CTX_PROMPT}\n{_CTX_TRANSCRIPT}\n"
                f"Your previous correction: Where's my bill?\n"
                f"Reviewer feedback to address: {_CTX_FEEDBACK}"
            ),
        },
        "response": {"corrected": _CTX_RESPONSE},
    },
]

AGENT_INFO = {
    "description": (
        "Chaplin AI is a lip-reading communication agent for non-vocal patients. "
        "A webcam clip is transcribed by a VSR (visual speech recognition) model "
        "(module 'vsr'), then a LangGraph reflection workflow corrects the noisy "
        "transcription: the 'generate' node proposes a corrected sentence without "
        "seeing the conversation, and the 'reflect' node reviews it against the "
        "conversation history (short-term memory, last 10 messages), requesting at "
        "most one revision when a visually similar word fits the context better."
    ),
    "purpose": (
        "Turn imperfect all-caps lip-read transcriptions into reliable, naturally "
        "punctuated sentences so ventilated / non-vocal patients can communicate, "
        "using the surrounding conversation to catch corrections that read well in "
        "isolation but are wrong in context."
    ),
    "prompt_template": {
        "template": (
            "Send the raw lip-read transcription as the prompt, ideally in all-caps, "
            "e.g. \"IM SO EXCITED TO ME YOU TODAY\". The agent returns the corrected "
            "sentence. Any noisy English sentence works — POST /api/execute with "
            "{\"prompt\": \"<RAW TRANSCRIPTION>\"}. Optionally add \"conversation\": "
            "[{\"role\": \"self\"|\"other\", \"content\": \"...\"}] — the chat so far; "
            "the reviewer uses it to fix words that don't fit the context."
        )
    },
    "prompt_examples": [
        {
            "prompt": _EXAMPLE_PROMPT,
            "full_response": _EXAMPLE_RESPONSE,
            "steps": _EXAMPLE_STEPS,
        },
        {
            "prompt": _CTX_PROMPT,
            "conversation": _CTX_CONVERSATION,
            "full_response": _CTX_RESPONSE,
            "steps": _CTX_STEPS,
        },
    ],
}
