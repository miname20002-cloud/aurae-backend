"""
LLM access layer for Aurae, routed through OpenRouter (OpenAI-compatible
endpoint) so billing runs through the OpenRouter key instead of a direct
Anthropic key. Still uses Claude models underneath - OpenRouter is just the
billing/routing layer, not a model swap.

Reads OPENROUTER_API_KEY from the environment. Import-safe even if the key
isn't set yet (fails only when actually called).

Usage tracking note: OpenRouter automatically includes a usage object on
every response (token counts + the actual USD cost it billed for that
specific call - no markup, passthrough provider pricing). generate_reply()
and extract_insights() return that alongside the text so callers can log
real spend instead of estimating it from a hardcoded price table that can
drift out of date.
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


def _extract_usage(response, requested_model: str) -> dict:
    """
    Pulls token counts + actual billed cost off an OpenRouter response.
    cost is read via getattr first (works when the installed openai SDK
    version exposes OpenRouter's extra fields as attributes); falls back to
    model_dump() for older SDK versions that drop unrecognized fields from
    the typed object but still carry them in the raw payload.
    """
    usage = getattr(response, "usage", None)
    prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0 if usage else 0
    completion_tokens = getattr(usage, "completion_tokens", 0) or 0 if usage else 0
    cost = getattr(usage, "cost", None) if usage else None

    if cost is None:
        try:
            cost = response.model_dump().get("usage", {}).get("cost", 0.0)
        except Exception:
            cost = 0.0

    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cost": cost or 0.0,
        "model": getattr(response, "model", None) or requested_model,
    }


def generate_reply(
    system_prompt: str, history: list[dict], max_tokens: int = 400, model: str | None = None
) -> tuple[str, dict]:
    """
    history: list of {"role": "user"|"assistant", "content": str}
    model: override which model replies - lets the caller route free-tier
    users to the cheaper FAST_MODEL and premium users to the full MODEL.

    Returns (reply_text, usage) where usage = {prompt_tokens, completion_tokens,
    cost, model}.
    """
    requested_model = model or MODEL
    client = _get_client()
    response = client.chat.completions.create(
        model=requested_model,
        max_tokens=max_tokens,
        messages=[{"role": "system", "content": system_prompt}] + history,
    )
    text = response.choices[0].message.content.strip()
    usage = _extract_usage(response, requested_model)
    return text, usage


def classify_fast(system_prompt: str, user_message: str, max_tokens: int = 200) -> str:
    """Cheap/fast call for per-turn triage (mood + realtime-info need), kept
    separate from the main persona reply call so it never blocks on the
    bigger model.

    NOTE: left returning a plain string (not (text, usage)) since this is
    called from mood.py with a single-value unpack - changing its return
    shape would need mood.py updated too. Wire up usage logging here later
    if per-turn triage cost ever needs its own visibility."""
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


def extract_insights(conversation_excerpt: str) -> tuple[str, dict]:
    """
    Periodic summarization pass: turns raw recent messages into compact,
    privacy-conscious tags instead of storing verbatim transcripts long-term.

    Also extracts at most one "memorable_event" per call - a short,
    paraphrased, non-verbatim fact worth the companion naturally checking
    back in on later (an upcoming event, a decision, something they're
    worried/excited about). This rides on the same call as the existing
    tag extraction so it adds zero additional API cost.

    Expected to return JSON in the text half; caller is responsible for
    parsing/validating. Returns (raw_text, usage).
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
    text = response.choices[0].message.content.strip()
    usage = _extract_usage(response, MODEL)
    return text, usage
