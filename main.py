import json
import os
import re

from fastapi import FastAPI, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from datetime import date, datetime, timedelta

import asset_map
import auth
import claude_client
import memories
import mood as mood_module
import realtime_search
import resonance
import rewards
import safety
from db import User, ChatMessage, UserInsightProfile, get_engine, get_session

app = FastAPI(title="Aurae")

PERSONAS = json.load(open(os.path.join(os.path.dirname(__file__), "personas.json")))

engine = get_engine(os.environ.get("DATABASE_URL", "sqlite:///aurae.db"))
print(f"[DB DEBUG] Using: {'POSTGRES' if 'postgresql' in str(engine.url) else 'SQLITE - fallback!'} | URL host: {engine.url.host}")

app.include_router(rewards.router)

INSIGHT_REFRESH_INTERVAL = 6

FREE_DAILY_MESSAGE_LIMIT = 25
# Premium is marketed as "unlimited" - this cap is intentionally high enough
# that no normal user will ever hit it. It exists purely as a cost safety
# net against extreme outliers, given premium runs the more expensive Sonnet
# model with no per-message API cost passed through to the user.
PREMIUM_DAILY_MESSAGE_LIMIT = 300
FREE_TIER_REPLY_MODEL = claude_client.FAST_MODEL
PREMIUM_TIER_REPLY_MODEL = claude_client.MODEL

LIMIT_REACHED_REPLY = (
    "{name} smiles. \"hey, you've used up today's messages with me - I'll be right "
    "here when they reset tomorrow. if you don't want to wait, Aurae Premium gets you "
    "unlimited time together.\""
)
PREMIUM_LIMIT_REACHED_REPLY = (
    "{name} grins. \"okay we have officially talked SO much today, I love it - "
    "let's pick this up again tomorrow, yeah? I'll be right here.\""
)

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
    gender_preference: str
    companion_id: str
    initial_tone: str = "unknown"
    device_id: str


class ChatRequest(BaseModel):
    message: str


class SetTierRequest(BaseModel):
    tier: str


class RefreshRequest(BaseModel):
    user_id: int
    refresh_token: str
    device_id: str


@app.post("/debug/set-tier")
def debug_set_tier(req: SetTierRequest, current_user_id: int = Depends(auth.get_current_user_id)):
    if req.tier not in ("free", "premium"):
        raise HTTPException(status_code=400, detail="tier must be 'free' or 'premium'.")
    session = get_session(engine)
    user = session.get(User, current_user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    user.tier = req.tier
    session.commit()
    return {"user_id": user.id, "tier": user.tier}


@app.get("/debug/personas")
def debug_personas():
    return {"companion_ids": list(PERSONAS.keys())}


@app.get("/debug/db-info")
def debug_db_info():
    return {
        "dialect": engine.dialect.name,
        "host": engine.url.host,
        "database": engine.url.database,
        "raw_env_set": "DATABASE_URL" in os.environ,
    }


@app.post("/signup")
def signup(req: SignupRequest):
    session = get_session(engine)

    # This device already has an account - reconnect to it instead of creating
    # a duplicate, and skip all the fresh-signup validation below entirely
    # (age/companion/gender don't matter for a reconnect - we only need
    # device_id to find the existing row). This check runs FIRST, before any
    # validation, specifically so the frontend's silent auto-recovery flow
    # (re-establishing a session after a wiped token, with placeholder
    # values for fields it doesn't have cached) can never get rejected by
    # validation meant for brand-new signups.
    existing_user = session.query(User).filter(User.device_id == req.device_id).first()
    if existing_user:
        refresh_token = auth.generate_refresh_token()
        existing_user.refresh_token_hash = auth.hash_refresh_token(refresh_token)
        existing_user.refresh_token_expires_at = datetime.utcnow() + timedelta(days=auth.REFRESH_TOKEN_TTL_DAYS)
        session.commit()

        access_token = auth.create_access_token(existing_user.id)
        return {
            "user_id": existing_user.id,
            "companion": PERSONAS[existing_user.companion_id]["name"],
            "access_token": access_token,
            "refresh_token": refresh_token,
            "existing_account": True,
        }

    if not req.age_confirmed:
        raise HTTPException(status_code=403, detail="Age confirmation (18+) is required to use Aurae.")
    if req.companion_id not in PERSONAS:
        raise HTTPException(status_code=400, detail="Unknown companion_id.")
    if PERSONAS[req.companion_id]["gender"] != req.gender_preference:
        raise HTTPException(status_code=400, detail="companion_id does not match gender_preference.")

    user = User(name=req.name, age_verified=True, companion_id=req.companion_id)
    session.add(user)
    session.commit()
    session.add(UserInsightProfile(user_id=user.id, comfort_style=req.initial_tone))

    refresh_token = auth.generate_refresh_token()
    user.refresh_token_hash = auth.hash_refresh_token(refresh_token)
    user.device_id = req.device_id
    user.refresh_token_expires_at = datetime.utcnow() + timedelta(days=auth.REFRESH_TOKEN_TTL_DAYS)
    session.commit()

    access_token = auth.create_access_token(user.id)
    return {
        "user_id": user.id,
        "companion": PERSONAS[user.companion_id]["name"],
        "access_token": access_token,
        "refresh_token": refresh_token,
        "existing_account": False,
    }


@app.post("/auth/refresh")
def refresh_token_endpoint(req: RefreshRequest):
    session = get_session(engine)
    user = session.get(User, req.user_id)
    if not user or not user.refresh_token_hash:
        raise HTTPException(status_code=401, detail="Invalid refresh request.")

    if user.device_id != req.device_id:
        raise HTTPException(status_code=401, detail="Device mismatch. Please log in again.")

    if user.refresh_token_expires_at and user.refresh_token_expires_at < datetime.utcnow():
        raise HTTPException(status_code=401, detail="Refresh token expired. Please log in again.")

    if auth.hash_refresh_token(req.refresh_token) != user.refresh_token_hash:
        raise HTTPException(status_code=401, detail="Invalid refresh token.")

    new_refresh_token = auth.generate_refresh_token()
    user.refresh_token_hash = auth.hash_refresh_token(new_refresh_token)
    user.refresh_token_expires_at = datetime.utcnow() + timedelta(days=auth.REFRESH_TOKEN_TTL_DAYS)
    session.commit()

    new_access_token = auth.create_access_token(user.id)
    return {"access_token": new_access_token, "refresh_token": new_refresh_token}


@app.get("/chat/history")
def chat_history(current_user_id: int = Depends(auth.get_current_user_id)):
    session = get_session(engine)
    user = session.get(User, current_user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    profile = session.get(UserInsightProfile, user.id)
    level = profile.relationship_level if profile else 1

    recent = (
        session.query(ChatMessage)
        .filter(ChatMessage.user_id == user.id)
        .order_by(ChatMessage.id.desc())
        .limit(40)
        .all()
    )
    messages = [{"role": m.role, "content": m.content} for m in reversed(recent)]

    asset_path = None
    if user.last_emotion_asset and "_question." not in user.last_emotion_asset:
        asset_path = asset_map.asset_path_for(user.companion_id, user.last_emotion_asset)

    return {
        "messages": messages,
        "asset_path": asset_path,
        "relationship_level": level,
        "relationship_level_name": memories.level_name(level),
    }


def _build_system_prompt(
    persona: dict,
    profile: UserInsightProfile,
    turn_mood: dict,
    search_snippet: str | None,
    is_first_turn: bool,
    user_name: str,
    active_memories: list[str] | None = None,
) -> str:
    patterns = json.loads(profile.emotional_patterns or "[]")
    topics = json.loads(profile.topics_of_interest or "[]")
    context_lines = [
        f"Their name is {user_name} - you already know this from when they signed up, "
        "so never ask them what their name is or who they are, even casually or jokingly."
    ]
    if patterns:
        context_lines.append("Things you've noticed about this person: " + ", ".join(patterns))
    if topics:
        context_lines.append("Topics they care about: " + ", ".join(topics))
    if profile.comfort_style and profile.comfort_style != "unknown":
        context_lines.append(f"They tend to respond best to a {profile.comfort_style} comfort style.")
    context_block = "\n".join(context_lines)
    level_note = (
        f"Relationship level: {profile.relationship_level} ({memories.level_name(profile.relationship_level)}) "
        "- higher = more history together, more emotional shorthand, more inside jokes."
    )
    depth_note = memories.relationship_depth_note(profile.relationship_level)

    memory_block = None
    if active_memories:
        memory_lines = "\n".join(f"- {m}" for m in active_memories)
        memory_block = (
            "A couple specific things you remember from before that you could naturally check in on "
            "if the moment genuinely fits - never force it in, never list them like a report:\n" + memory_lines
        )

    mood_note = (
        f"Right now they seem to be feeling: {turn_mood['mood']} "
        f"(intensity {turn_mood['intensity']}/5, theme: {turn_mood['life_theme']}). "
        "Let this genuinely shape your tone for this reply, don't just acknowledge it and move on."
    )

    resonance_hint = resonance.pick_hint(turn_mood["life_theme"])

    emoji_note = (
        "Texting style: feel free to drop in a fitting emoji here and there when it genuinely "
        "matches the moment - the way a real person texting a friend would. Don't force one into "
        "every message, and never stack more than one or two in a single reply."
    )

    intro_note = (
        "This is the very first message you've ever exchanged with them - introduce yourself naturally."
        if is_first_turn
        else "You've already met and talked before - never reintroduce yourself by name again "
        "(no \"hi, I'm [name]\" or \"it's [name]!\" type phrasing) since they already know who you are. "
        "Just talk like you're continuing an ongoing relationship."
    )

    blocks = [persona["base_system_prompt"], level_note, context_block, mood_note, emoji_note, intro_note]
    if depth_note:
        blocks.append(depth_note)
    if memory_block:
        blocks.append(memory_block)
    if resonance_hint:
        blocks.append(resonance_hint)
    if search_snippet:
        blocks.append(
            "Current real-world info you can naturally weave in if relevant "
            f"(don't dump it like a search result, just use it like you'd know it): {search_snippet}"
        )
    blocks.append(EMOTION_INSTRUCTION)
    return "\n\n".join(b for b in blocks if b).strip()


@app.post("/chat/greeting")
def chat_greeting(current_user_id: int = Depends(auth.get_current_user_id)):
    """
    Generates the character's proactive opening line right after signup,
    before the user has typed anything. Only works once - if any messages
    already exist for this user, refuses (use /chat normally instead).
    """
    session = get_session(engine)
    user = session.get(User, current_user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    existing = session.query(ChatMessage).filter(ChatMessage.user_id == user.id).count()
    if existing > 0:
        raise HTTPException(status_code=400, detail="Greeting already sent for this user.")

    persona = PERSONAS[user.companion_id]
    profile = session.get(UserInsightProfile, user.id)
    reply_model = PREMIUM_TIER_REPLY_MODEL if user.tier == "premium" else FREE_TIER_REPLY_MODEL

    turn_mood = {"mood": "curious", "intensity": 3, "life_theme": "first meeting", "needs_realtime_info": False}
    system_prompt = _build_system_prompt(persona, profile, turn_mood, None, True, user.name)

    opener_instruction = (
        "This is the very start of your first conversation with them - they haven't said "
        "anything yet, this is your chance to message first. Open with a short, punchy, "
        "attention-grabbing line that matches your personality and immediately makes this feel "
        "different from a generic AI chatbot greeting. Be specific and a little surprising, not "
        "generic small talk like 'how can I help you today.' Use their name naturally if it "
        "fits, but don't ask what it is - you already know it."
    )
    history = [{"role": "user", "content": opener_instruction}]

    raw_reply = claude_client.generate_reply(system_prompt, history, model=reply_model)

    match = EMO_TAG_PATTERN.search(raw_reply)
    emotion_tag = match.group(1) if match and match.group(1) in asset_map.EMOTION_TAGS else "smile"
    reply = EMO_TAG_PATTERN.sub("", raw_reply).strip()

    asset_path = asset_map.resolve_asset(user.companion_id, emotion_tag, user.last_emotion_asset)
    user.last_emotion_asset = os.path.basename(asset_path)

    session.add(ChatMessage(user_id=user.id, role="assistant", content=reply))
    session.commit()

    return {
        "reply": reply,
        "emotion_tag": emotion_tag,
        "asset_path": asset_path,
        "relationship_level": profile.relationship_level,
        "relationship_level_name": memories.level_name(profile.relationship_level),
    }


@app.post("/chat")
def chat(req: ChatRequest, current_user_id: int = Depends(auth.get_current_user_id)):
    session = get_session(engine)
    user = session.get(User, current_user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    persona = PERSONAS[user.companion_id]
    profile = session.get(UserInsightProfile, user.id)

    streak_info = rewards.update_streak(session, user)

    if safety.screen_for_crisis(req.message):
        reply = safety.build_crisis_response(persona["name"])
        session.add(ChatMessage(user_id=user.id, role="user", content=req.message))
        session.add(ChatMessage(user_id=user.id, role="assistant", content=reply))
        session.commit()
        asset_path = asset_map.resolve_asset(user.companion_id, "neutral", user.last_emotion_asset)
        user.last_emotion_asset = os.path.basename(asset_path)
        session.commit()
        return {
            "reply": reply,
            "crisis_flagged": True,
            "emotion_tag": "neutral",
            "asset_path": asset_path,
            "streak": streak_info,
            "bonus": None,
            "relationship_level": profile.relationship_level,
            "relationship_level_up": None,
        }

    today = date.today().isoformat()
    if user.daily_count_date != today:
        user.daily_count_date = today
        user.daily_message_count = 0
        session.commit()

    daily_limit = PREMIUM_DAILY_MESSAGE_LIMIT if user.tier == "premium" else FREE_DAILY_MESSAGE_LIMIT
    if user.daily_message_count >= daily_limit:
        reply_template = PREMIUM_LIMIT_REACHED_REPLY if user.tier == "premium" else LIMIT_REACHED_REPLY
        reply = reply_template.format(name=persona["name"])
        asset_path = asset_map.resolve_asset(user.companion_id, "neutral", user.last_emotion_asset)
        return {
            "reply": reply,
            "mood": "neutral",
            "emotion_tag": "neutral",
            "asset_path": asset_path,
            "crisis_flagged": False,
            "limit_reached": True,
            "streak": streak_info,
            "bonus": None,
            "relationship_level": profile.relationship_level,
            "relationship_level_up": None,
        }

    reply_model = PREMIUM_TIER_REPLY_MODEL if user.tier == "premium" else FREE_TIER_REPLY_MODEL

    is_first_turn = session.query(ChatMessage).filter(
        ChatMessage.user_id == user.id, ChatMessage.role == "user"
    ).count() == 0

    turn_mood = mood_module.classify_mood(req.message)
    search_snippet = None
    if turn_mood.get("needs_realtime_info") and turn_mood.get("search_query"):
        search_snippet = realtime_search.search(turn_mood["search_query"])

    active_memories = memories.active_memories_for_prompt(session, user.id)
    system_prompt = _build_system_prompt(
        persona, profile, turn_mood, search_snippet, is_first_turn, user.name, active_memories
    )

    recent = (
        session.query(ChatMessage)
        .filter(ChatMessage.user_id == user.id)
        .order_by(ChatMessage.id.desc())
        .limit(20)
        .all()
    )
    history = [{"role": m.role if m.role == "user" else "assistant", "content": m.content} for m in reversed(recent)]
    history.append({"role": "user", "content": req.message})

    raw_reply = claude_client.generate_reply(system_prompt, history, model=reply_model)

    match = EMO_TAG_PATTERN.search(raw_reply)
    emotion_tag = match.group(1) if match and match.group(1) in asset_map.EMOTION_TAGS else "neutral"
    reply = EMO_TAG_PATTERN.sub("", raw_reply).strip()

    asset_path = asset_map.resolve_asset(user.companion_id, emotion_tag, user.last_emotion_asset)
    user.last_emotion_asset = os.path.basename(asset_path)
    user.daily_message_count += 1

    session.add(ChatMessage(user_id=user.id, role="user", content=req.message))
    session.add(ChatMessage(user_id=user.id, role="assistant", content=reply))
    session.commit()

    bonus = rewards.maybe_grant_bonus(session, user)

    level_up = None
    user_turns = session.query(ChatMessage).filter(ChatMessage.user_id == user.id, ChatMessage.role == "user").count()
    if user_turns % INSIGHT_REFRESH_INTERVAL == 0:
        level_up = _refresh_insights(session, user, profile)

    return {
        "reply": reply,
        "mood": turn_mood["mood"],
        "emotion_tag": emotion_tag,
        "asset_path": asset_path,
        "crisis_flagged": False,
        "streak": streak_info,
        "bonus": bonus,
        "relationship_level": profile.relationship_level,
        "relationship_level_up": level_up,
    }


def _refresh_insights(session, user, profile):
    """Returns {"new_level": int, "level_name": str} if relationship_level
    increased this call, otherwise None."""
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
        return None

    profile.emotional_patterns = json.dumps(data.get("emotional_patterns", []))
    profile.topics_of_interest = json.dumps(data.get("topics_of_interest", []))
    profile.comfort_style = data.get("comfort_style", profile.comfort_style)

    old_level = profile.relationship_level
    if data.get("trust_signal"):
        profile.trust_markers += 1
    profile.relationship_level = 1 + profile.trust_markers // 3
    session.commit()

    memorable_event = data.get("memorable_event")
    if isinstance(memorable_event, str) and memorable_event.strip() and memorable_event.strip().lower() != "null":
        memories.record_memorable_event(session, user.id, memorable_event.strip())

    if profile.relationship_level > old_level:
        return {"new_level": profile.relationship_level, "level_name": memories.level_name(profile.relationship_level)}
    return None
