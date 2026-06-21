"""
Real-time search for the persona, backed by Gemini's "Grounding with Google
Search" tool. Reads GEMINI_API_KEY from the environment - get a fresh key
from Google AI Studio (https://aistudio.google.com/apikey).

Why Gemini here instead of a separate search API: grounding handles the
search-execute-synthesize loop in one call, so this module stays a thin
wrapper instead of its own scraper/ranker. Claude (via OpenRouter) still
writes the actual persona reply in main.py - Gemini's only job is to come
back with a short, current, factual answer that gets folded into Claude's
context for that turn.

Safety note: search results are unfiltered web content. They get passed
through `_filter_unsafe` before ever reaching the persona's context. The
filter here is a minimal placeholder (length cap + a small blocklist) — for
production, run results through a real content-moderation pass, not just
this.
"""

import os

from google import genai
from google.genai import types

UNSAFE_MARKERS = [
    "explicit", "gore", "nsfw",  # placeholder list — replace with a real moderation API
]

GROUNDING_MODEL = "gemini-2.5-flash"

_client = None


def _get_client():
    global _client
    if _client is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            return None
        _client = genai.Client(api_key=api_key)
    return _client


def _call_provider(query: str) -> str | None:
    client = _get_client()
    if client is None:
        return None  # no key configured — caller proceeds without search context
    response = client.models.generate_content(
        model=GROUNDING_MODEL,
        contents=query,
        config=types.GenerateContentConfig(
            tools=[types.Tool(google_search=types.GoogleSearch())]
        ),
    )
    return response.text


def _filter_unsafe(text: str) -> str:
    lowered = text.lower()
    if any(marker in lowered for marker in UNSAFE_MARKERS):
        return ""
    return text[:800]  # cap length so it doesn't dominate the persona's context


def search(query: str) -> str | None:
    if not query:
        return None
    try:
        raw = _call_provider(query)
    except Exception:
        return None  # never let a search failure break the chat turn
    if not raw:
        return None
    cleaned = _filter_unsafe(raw)
    return cleaned or None
