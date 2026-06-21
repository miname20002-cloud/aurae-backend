"""
Crisis safety layer for Aurae.

This is a basic keyword/pattern screen, not a clinical risk classifier.
In production this should be backed by a more robust model and reviewed
with input from mental health professionals and legal counsel. The goal
here is structural: crisis handling must run BEFORE persona chat logic,
every time, with no way to disable it from the client side.
"""

import re

CRISIS_PATTERNS = [
    r"\bkill myself\b",
    r"\bsuicid",
    r"\bwant(ing)? to die\b",
    r"\bend (it|my life)\b",
    r"\bnot (be|being) alive\b",
    r"\bhurt(ing)? myself\b",
    r"\bself[\s-]?harm",
    r"\bno reason to (live|keep going)\b",
]

CRISIS_RESPONSE_TEMPLATE = (
    "{name} pauses for a second. \"hey, i need to stop and say this directly because "
    "i care about you: what you just said sounds really heavy, and you don't have to "
    "carry it alone. please reach out to the 988 Suicide & Crisis Lifeline (call or text "
    "988 in the US, available 24/7) or go to your nearest emergency room if you're in "
    "immediate danger. i'm still here too, but a real person trained for this can help "
    "in ways i can't.\""
)


def screen_for_crisis(message: str) -> bool:
    text = message.lower()
    return any(re.search(pattern, text) for pattern in CRISIS_PATTERNS)


def build_crisis_response(persona_name: str) -> str:
    return CRISIS_RESPONSE_TEMPLATE.format(name=persona_name)
