import json
import os
import re

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import asset_map
import claude_client
import mood as mood_module
import realtime_search
import resonance
import safety
from db import User, ChatMessage, UserInsightProfile, get_engine, get_session

app = FastAPI(title="Aurae")

PERSONAS = json.load(open(os.path.join(os.path.dirname(__file__), "personas.json")))

engine = get_engine()

# how many user turns between insight-extraction passes
INSIGHT_REFRESH_INTERVAL = 6

EMO_TAG_PATTERN = re.compile(r"\[EMO:(\w+)\]")
EMOTION_INSTRUCTION = (
    "At the very end of your reply, on its own with nothing after it, append exactly one tag "
    "from this exact set: " + " ".join(f"[EMO:{t}]" for t in asset_map.EMOTION_TAGS) + ". "
    "Pick whichever best matches the emotional tone of your reply. Never invent a new tag, "
    "never omit it, never output more than one."
)

ASSETS_PARENT_DIR = os.path.dirname(__file__)
for _char_dir in ["Chloe_Assets", "Ethan_Assets", "Jayden_Assets", "Maya_Assets"]:
    _full_path = os.path.join(ASSETS_PARENT_DIR, _char_dir)
    if os.path.isdir(_full_path):
        app.mount(f"/assets/{_char_dir}", StaticFiles(directory=_full_path), name=_char_dir)


class SignupRequest(BaseModel):
    name: str
    age_confirmed: bool
    gender_preference: str  # "female" | "male"
    companion_id: str       # one of PERSONAS keys
    initial_tone: str = "unknown"  # "gentle" | "witty" | "unknown" - seeds comfort_style


class ChatRequest(BaseModel):
    user_id: int
    message: str


@app.post("/signup")
def signup(req: SignupRequest):
    if not req.age_confirmed:
        raise HTTPException(status_code=403, detail="Age confirmation (18+) is required to use Aurae.")
    if req.companion_id not in PERSONAS:
        raise HTTPException(status_code=400, detail="Unknown companion_id.")
    if PERSONAS[req.companion_id]["gender"] != req.gender_preference:
        raise HTTPException(status_code=400, detail="companion_id does not match gender_preference.")

    session = get_session(engine)
    user = User(name=req.name, age_verified=True, companion_id=req.companion_id)
    session.add(user)
    session.commit()
    session.add(UserInsightProfile(user_id=user.id, comfort_style=req.initial_tone))
    session.commit()
    return {"user_id": user.id, "companion": PERSONAS[req.companion_id]["name"]}


def _build_system_prompt(persona: dict, profile: UserInsightProfile, turn_mood: dict, search_snippet: str | None) -> str:
    patterns = json.loads(profile.emotional_patterns or "[]")
    topics = json.loads(profile.topics_of_interest or "[]")
    context_lines = []
    if patterns:
        context_lines.append("Things you've noticed about this person: " + ", ".join(patterns))
    if topics:
        context_lines.append("Topics they care about: " + ", ".join(topics))
    if profile.comfort_style and profile.comfort_style != "unknown":
        context_lines.append(f"They tend to respond best to a {profile.comfort_style} comfort style.")
    context_block = "\n".join(context_lines)
    level_note = f"Relationship level: {profile.relationship_level} (higher = more history together, more emotional shorthand, more inside jokes)."

    mood_note = (
        f"Right now they seem to be feeling: {turn_mood['mood']} "
        f"(intensity {turn_mood['intensity']}/5, theme: {turn_mood['life_theme']}). "
        "Let this genuinely shape your tone for this reply, don't just acknowledge it and move on."
    )

    resonance_hint = resonance.pick_hint(turn_mood["life_theme"])

    blocks = [persona["base_system_prompt"], level_note, context_block, mood_note]
    if resonance_hint:
        blocks.append(resonance_hint)
    if search_snippet:
        blocks.append(
            "Current real-world info you can naturally weave in if relevant "
            f"(don't dump it like a search result, just use it like you'd know it): {search_snippet}"
        )
    blocks.append(EMOTION_INSTRUCTION)
    return "\n\n".join(b for b in blocks if b).strip()


@app.post("/chat")
def chat(req: ChatRequest):
    session = get_session(engine)
    user = session.get(User, req.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    persona = PERSONAS[user.companion_id]

    # Crisis screening always runs first, and the persona LLM is never the
    # thing deciding whether this path triggers.
    if safety.screen_for_crisis(req.message):
        reply = safety.build_crisis_response(persona["name"])
        session.add(ChatMessage(user_id=user.id, role="user", content=req.message))
        session.add(ChatMessage(user_id=user.id, role="assistant", content=reply))
        session.commit()
        asset_path = asset_map.resolve_asset(user.companion_id, "neutral", user.last_emotion_asset)
        user.last_emotion_asset = os.path.basename(asset_path)
        session.commit()
        return {"reply": reply, "crisis_flagged": True, "emotion_tag": "neutral", "asset_path": asset_path}

    profile = session.get(UserInsightProfile, user.id)

    # Fast triage: mood + whether this turn needs real-world info.
    turn_mood = mood_module.classify_mood(req.message)
    search_snippet = None
    if turn_mood.get("needs_realtime_info") and turn_mood.get("search_query"):
        search_snippet = realtime_search.search(turn_mood["search_query"])

    system_prompt = _build_system_prompt(persona, profile, turn_mood, search_snippet)

    recent = (
        session.query(ChatMessage)
        .filter(ChatMessage.user_id == user.id)
        .order_by(ChatMessage.id.desc())
        .limit(20)
        .all()
    )
    history = [{"role": m.role if m.role == "user" else "assistant", "content": m.content} for m in reversed(recent)]
    history.append({"role": "user", "content": req.message})

    raw_reply = claude_client.generate_reply(system_prompt, history)

    match = EMO_TAG_PATTERN.search(raw_reply)
    emotion_tag = match.group(1) if match and match.group(1) in asset_map.EMOTION_TAGS else "neutral"
    reply = EMO_TAG_PATTERN.sub("", raw_reply).strip()

    asset_path = asset_map.resolve_asset(user.companion_id, emotion_tag, user.last_emotion_asset)
    user.last_emotion_asset = os.path.basename(asset_path)

    session.add(ChatMessage(user_id=user.id, role="user", content=req.message))
    session.add(ChatMessage(user_id=user.id, role="assistant", content=reply))
    session.commit()

    user_turns = session.query(ChatMessage).filter(ChatMessage.user_id == user.id, ChatMessage.role == "user").count()
    if user_turns % INSIGHT_REFRESH_INTERVAL == 0:
        _refresh_insights(session, user, profile)

    return {
        "reply": reply,
        "mood": turn_mood["mood"],
        "emotion_tag": emotion_tag,
        "asset_path": asset_path,
        "crisis_flagged": False,
    }


def _refresh_insights(session, user, profile):
    recent = (
        session.query(ChatMessage)
        .filter(ChatMessage.user_id == user.id)
        .order_by(ChatMessage.id.desc())
        .limit(INSIGHT_REFRESH_INTERVAL * 2)
        .all()
    )
    excerpt = "\n".join(f"{m.role}: {m.content}" for m in reversed(recent))
    try:
        raw = claude_client.extract_insights(excerpt)
        data = json.loads(raw)
    except Exception:
        return  # don't let a parsing hiccup break the chat flow

    profile.emotional_patterns = json.dumps(data.get("emotional_patterns", []))
    profile.topics_of_interest = json.dumps(data.get("topics_of_interest", []))
    profile.comfort_style = data.get("comfort_style", profile.comfort_style)
    if data.get("trust_signal"):
        profile.trust_markers += 1
    profile.relationship_level = 1 + profile.trust_markers // 3
    session.commit()
