# Chaplin AI — PRD

> Draft v0.1 · 2026-06-09 · Owner: Adam

## Problem
Millions of ventilated and intubated patients are conscious but cannot speak.
Existing tools (letter boards, generic AAC devices) are slow and impractical, and
off-the-shelf lip-reading models are unreliable — they hallucinate words and give
no signal about their own confidence. A confidently wrong sentence is worse than none.

## Vision
**Chaplin AI** lets a non-vocal patient communicate by mouthing words to a camera
and getting back **reliable spoken sentences in a voice that represents them**.
The value is not the raw lip-reading model but the **agent layer** on top that makes
the output trustworthy: it reasons over the model's confidence, and when unsure it
**asks for confirmation instead of asserting a wrong sentence**. Reliability over coverage.

## Users
- **Primary — ventilated/intubated patient:** express needs, pain, and answers quickly and correctly.
- **Clinician:** understand the patient without guesswork; trust the output.
- **Family:** connect with the patient and hear their voice.

## Goals
1. Patient produces a correct, **spoken** short phrase by mouthing it to a webcam.
2. When not confident, the system **says so and seeks confirmation** — it never silently hallucinates.
3. Output is spoken in a representative/cloned voice.
4. Runs at the bedside on a single laptop/tablet.

## Non-Goals
- Open-ended free-form conversation at full speed.
- Multi-language (English first).
- Medical-device certification (research prototype).
- Replacing clinical judgment, monitoring, or alarms.

## Functional Requirements
- Capture a short clip of the patient mouthing a phrase.
- Lip-read it into text with per-word confidence.
- An agent evaluates that output; when confident it produces a clean sentence and speaks it.
- When unsure, it presents alternatives / asks for confirmation rather than asserting one answer.
- Show both the raw model output and the agent's final output (clinician transparency).
- Support per-speaker calibration.

## Non-Functional Requirements
- **Reliability:** prefer "ask" over "guess wrong"; minimize confidently-wrong outputs.
- **Latency:** short phrase → speech feels responsive at the bedside (seconds, not tens of seconds).
- **Edge:** runs on one laptop/tablet (GPU/MPS/CPU).
- **Privacy:** video processed locally and discarded after inference; only text leaves the device.
- **Dignity & consent:** voice cloning requires explicit consent.

## Success Metrics
- **Hallucination rate** — confident outputs that are wrong (the thing we exist to reduce).
- **Appropriate-abstention rate** — correctly asked instead of asserting when wrong.
- **Word-overlap F1** vs. ground truth, and **lift over the raw model**.
- **Time-to-phrase** at the bedside.

A change is only good if it raises accuracy or abstention **without** raising confident hallucinations.

## Open Questions
- Final agent architecture and confidence threshold for speak-vs-clarify.
- Clarification interaction for a patient who can only mouth/blink.
- Open vocabulary vs. a curated ICU phrase bank fallback.
- How calibration data is captured and stored per patient, with what privacy guarantees.
