import os
import re
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
    
    # 🛠️ [보안벽 강화] OpenRouter 규격에 맞는 JSON 오프셋 포맷 설정 지시 추가
    response = client.chat.completions.create(
        model=MODEL,
        max_tokens=300,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": conversation_excerpt},
        ],
    )
    
    raw_text = response.choices[0].message.content.strip()
    
    # 🛠️ [예외 처리] 마크다운 코드 블록(```json) 노이즈가 유입될 경우를 대비한 2차 정제 밸브
    if raw_text.startswith("```"):
        raw_text = re.sub(r"^```json\s*|```$", "", raw_text, flags=re.IGNORECASE).strip()
        
    usage = _extract_usage(response, MODEL)
    return raw_text, usage
