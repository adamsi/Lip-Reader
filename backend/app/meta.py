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

# A real recorded run of the agent (see /api/execute) used as the example.
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
        "response": {"verdict": "approve", "feedback": ""},
    },
]

AGENT_INFO = {
    "description": (
        "Chaplin AI is a lip-reading communication agent for non-vocal patients. "
        "A webcam clip is transcribed by a VSR (visual speech recognition) model "
        "(module 'vsr'), then a LangGraph reflection workflow corrects the noisy "
        "transcription: the 'generate' node proposes a corrected sentence and the "
        "'reflect' node reviews it, requesting at most one revision before returning."
    ),
    "purpose": (
        "Turn imperfect all-caps lip-read transcriptions into reliable, naturally "
        "punctuated sentences so ventilated / non-vocal patients can communicate."
    ),
    "prompt_template": {
        "template": (
            "Send the raw lip-read transcription as the prompt, ideally in all-caps, "
            "e.g. \"IM SO EXCITED TO ME YOU TODAY\". The agent returns the corrected "
            "sentence. Any noisy English sentence works — POST /api/execute with "
            "{\"prompt\": \"<RAW TRANSCRIPTION>\"}."
        )
    },
    "prompt_examples": [
        {
            "prompt": _EXAMPLE_PROMPT,
            "full_response": _EXAMPLE_RESPONSE,
            "steps": _EXAMPLE_STEPS,
        }
    ],
}
