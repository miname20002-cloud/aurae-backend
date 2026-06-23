"""
LLM access layer for Aurae, routed through OpenRouter (OpenAI-compatible
endpoint) so billing runs through the OpenRouter key instead of a direct
Anthropic key. Still uses Claude models underneath - OpenRouter is just the
billing/routing layer, not a model swap.

Reads OPENROUTER_API_KEY from the environment. Import-safe even if the key
isn't set yet (fails only when actually called).
"""

import os
from openai import OpenAI

MODEL = "anthropic/claude-sonnet-4.6"
FAST_MODEL = "anthropic/claude-haiku-4.5"

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=os.environ.get("OPENROUTER_API_KEY"),
            default_headers={"HTTP-Referer": "https://aurae.app", "X-Title": "Aurae"},
        )
    return _client


def generate_reply(system_prompt: str, history: list[dict], max_tokens: int = 400, model: str | None = None) -> str:
    """
    history: list of {"role": "user"|"assistant", "content": str}
    model: override which model replies - lets the caller route free-tier
    users to the cheaper FAST_MODEL and premium users to the full MODEL.
    """
    client = _get_client()
    response = client.chat.completions.create(
        model=model or MODEL,
        max_tokens=max_tokens,
        messages=[{"role": "system", "content": system_prompt}] + history,
    )
    return response.choices[0].message.content.strip()


def classify_fast(system_prompt: str, user_message: str, max_tokens: int = 200) -> str:
    """Cheap/fast call for per-turn triage (mood + realtime-info need), kept
    separate from the main persona reply call so it never blocks on the
    bigger model."""
    client = _get_client()
    response = client.chat.completions.create(
        model=FAST_MODEL,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
    )
    return response.choices[0].message.content.strip()


def extract_insights(conversation_excerpt: str) -> str:
    """
    Periodic summarization pass: turns raw recent messages into compact,
    privacy-conscious tags instead of storing verbatim transcripts long-term.

    Also extracts at most one "memorable_event" per call - a short,
    paraphrased, non-verbatim fact worth the companion naturally checking
    back in on later (an upcoming event, a decision, something they're
    worried/excited about). This rides on the same call as the existing
    tag extraction so it adds zero additional API cost.

    Expected to return JSON; caller is responsible for parsing/validating.
    """
    system = (
        "You analyze a short excerpt of a conversation between a person and their "
        "AI companion. Output ONLY valid JSON with this shape, nothing else: "
        '{"emotional_patterns": ["short tag", ...], "topics_of_interest": ["short tag", ...], '
        '"comfort_style": "direct|gentle|hype|unknown", "trust_signal": true|false, '
        '"memorable_event": "short paraphrased fact, or null"}. '
        "Keep tags short (2-4 words), non-verbatim, and non-identifying. Do not quote the user directly. "
        "For memorable_event: only fill this in if something concrete and specific came up that a good "
        "friend would naturally circle back to later - a named upcoming event, a decision they're "
        "weighing, something they're worried or excited about. Phrase it as a short paraphrase under "
        "12 words, never a direct quote, never including identifying details (no full names, addresses, "
        "etc). If nothing like that came up in this excerpt, use null - don't force one."
    )
    client = _get_client()
    response = client.chat.completions.create(
        model=MODEL,
        max_tokens=300,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": conversation_excerpt},
        ],
    )
    return response.choices[0].message.content.strip()
