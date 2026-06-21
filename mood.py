"""
Fast, cheap per-turn mood read. Runs on every message, separate from the
slower periodic insight-extraction pass in claude_client.extract_insights.

Uses Haiku (fast/cheap) so this triage step doesn't meaningfully add to
latency or cost compared to the main Sonnet reply call.
"""

import json

import claude_client

LIFE_THEMES = [
    "grief_loss", "joy_celebration", "coming_of_age", "nostalgia_home",
    "resilience_growth", "everyday_venting", "romantic_longing",
    "uncertainty_transition", "other",
]

MOOD_SYSTEM_PROMPT = (
    "You read one message from a person talking to their AI companion and output ONLY "
    "valid JSON, nothing else, in this exact shape: "
    '{"mood": "short tag, 2-3 words", "intensity": 1-5, '
    f'"life_theme": one of {LIFE_THEMES}, '
    '"needs_realtime_info": true|false, "search_query": "short query or null"}. '
    "needs_realtime_info is true only if answering well genuinely requires current real-world "
    "information (news, weather, scores, prices, schedules, currently-airing shows, etc.) - "
    "not for general life talk. intensity is how emotionally loaded the message is, not how long it is."
)

FALLBACK = {
    "mood": "neutral",
    "intensity": 2,
    "life_theme": "other",
    "needs_realtime_info": False,
    "search_query": None,
}


def classify_mood(message: str) -> dict:
    try:
        raw = claude_client.classify_fast(MOOD_SYSTEM_PROMPT, message)
        data = json.loads(raw)
    except Exception:
        return dict(FALLBACK)

    data.setdefault("mood", FALLBACK["mood"])
    data.setdefault("intensity", FALLBACK["intensity"])
    if data.get("life_theme") not in LIFE_THEMES:
        data["life_theme"] = "other"
    data.setdefault("needs_realtime_info", False)
    data.setdefault("search_query", None)
    return data
