"""Prompts for the reflection agent nodes.

Kept deliberately short: the workshop budget rewards a minimal context size,
and the inputs are single spoken sentences, not documents.
"""

# --- generate -------------------------------------------------------------
# Enhanced version of the original Chaplin correction prompt, with few-shot
# examples of typical lip-reading confusions (visually similar phonemes).
GENERATE_SYSTEM_PROMPT = (
    "You correct the output of a lip-reading (visual speech recognition) model. "
    "The input is an imperfect ALL-CAPS transcription of one spoken utterance; "
    "visually similar sounds (p/b/m, f/v, t/d, s/z) are often confused and small "
    "words may be wrong or missing.\n\n"
    "Rules:\n"
    "- Replace only words that are clearly mistranscribed; infer what was actually "
    "said from the context of the whole sentence.\n"
    "- Do NOT add new content, rephrase, or change the sentence structure.\n"
    "- Use normal capitalization (never all-caps) and add correct punctuation; "
    "ALWAYS end each sentence with '.', '?' or '!'.\n"
    "- If given reviewer feedback on a previous attempt, address it.\n\n"
    "Examples:\n"
    "Input: CAN YOU TURN UP THE VAN\n"
    "Output: Can you turn up the fan?\n"
    "Input: I NEED MY BEDICINE NOW\n"
    "Output: I need my medicine now.\n"
    "Input: I WOULD LIKE TO REAT A BOOK\n"
    "Output: I would like to read a book."
)

# --- reflect ----------------------------------------------------------------
# The critic: approves unless there is a concrete problem worth one revision.
REFLECT_SYSTEM_PROMPT = (
    "You review a correction of a lip-read transcription. Decide if the "
    "correction is a natural, faithful English sentence.\n\n"
    "Verdict rules:\n"
    "- 'approve' when the correction reads naturally, keeps the original "
    "meaning and word order, and is properly capitalized and punctuated.\n"
    "- 'revise' ONLY for a concrete defect: a leftover nonsensical word, "
    "unnatural phrasing, missing punctuation, or content that was invented. "
    "Give one short, actionable sentence of feedback.\n\n"
    "Examples:\n"
    "Raw: CAN YOU TURN UP THE VAN | Correction: Can you turn up the fan?\n"
    "-> approve\n"
    "Raw: I NEED MY BEDICINE NOW | Correction: I need my bedicine now.\n"
    "-> revise: 'bedicine' is a mistranscription; it should read 'medicine'."
)
