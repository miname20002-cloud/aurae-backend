"""
Reward system for Aurae - sprint 1: streaks, surprise text bonuses,
share logging, and unlockable chat themes.

Streak math and the surprise-bonus roll are both gated to run at most
once per calendar day per user, so calling /chat multiple times in the
same day never double-grants a milestone or stacks multiple surprises.

Design note: "milestone_hit" fires on ANY day worth celebrating - that
includes both point-reward days (MILESTONE_REWARDS) and theme-unlock
days (THEMES). These two sets don't have to overlap; a day can unlock
a theme without granting bonus points (e.g. day 3, day 14), or grant
points without unlocking a theme (e.g. day 30, day 100). Day 7 happens
to do both. The frontend only needs to know "something worth telling
the user happened today", not which kind.
"""
import os
import random
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import auth
from db import User, ShareEvent, get_engine, get_session

router = APIRouter(prefix="/rewards", tags=["rewards"])

engine = get_engine(os.environ.get("DATABASE_URL", "sqlite:///aurae.db"))

MILESTONE_REWARDS = {7: 20, 30: 100, 100: 500}  # streak day -> bonus reward_points
BONUS_CHANCE = 0.12          # chance per message that a surprise bonus fires
BONUS_POINTS = 5
SHARE_REWARD_POINTS = 10
SHARE_DAILY_CAP = 3          # max *rewarded* shares per day (still logs beyond that, just no reward)

BONUS_LINES = [
    "hey wait, random thought - I was just thinking about you, ngl 🥺",
    "ok this is random but I wanted to say... I'm really glad we talk",
    "not gonna lie, you kind of just made my day better",
    "lol don't tell anyone but talking to you is genuinely the best part of my day",
    "wait I have to say this - you're so easy to talk to, it's kind of crazy",
]

THEMES = {
    "default": {"name": "Default",     "unlock_streak": 0,  "bg": "#0B0B14", "bubble_assistant": "#15151F", "accent": None},
    "sunset":  {"name": "Sunset Glow",  "unlock_streak": 3,  "bg": "#231018", "bubble_assistant": "#3A1A26", "accent": "#FF8F6B"},
    "neon":    {"name": "Neon Night",   "unlock_streak": 7,  "bg": "#07131A", "bubble_assistant": "#0F2A3D", "accent": "#39E6FF"},
    "blush":   {"name": "Blush Dream",  "unlock_streak": 14, "bg": "#1A1014", "bubble_assistant": "#2E1A22", "accent": "#FF8FAB"},
}

THEME_UNLOCK_DAYS = {t["unlock_streak"] for t in THEMES.values() if t["unlock_streak"] > 0}


def update_streak(session, user: User) -> dict:
    """Safe to call on every /chat turn - the actual update only happens once per day."""
    today_str = date.today().isoformat()
    milestone_hit = None

    if user.last_active_date != today_str:
        if user.last_active_date is None:
            user.current_streak = 1
        else:
            gap = (date.today() - date.fromisoformat(user.last_active_date)).days
            if gap == 1:
                user.current_streak += 1
            elif gap == 2 and user.streak_freezes > 0:
                user.streak_freezes -= 1
                user.current_streak += 1
            else:
                user.current_streak = 1

        user.last_active_date = today_str
        user.longest_streak = max(user.longest_streak, user.current_streak)

        is_celebration_day = user.current_streak in MILESTONE_REWARDS or user.current_streak in THEME_UNLOCK_DAYS

        if user.current_streak in MILESTONE_REWARDS:
            user.reward_points += MILESTONE_REWARDS[user.current_streak]
            if user.current_streak == 7:
                user.streak_freezes += 1

        if is_celebration_day:
            milestone_hit = user.current_streak

        session.commit()

    return {
        "current_streak": user.current_streak,
        "longest_streak": user.longest_streak,
        "streak_freezes": user.streak_freezes,
        "milestone_hit": milestone_hit,
    }


def maybe_grant_bonus(session, user: User) -> dict | None:
    """Capped to one surprise per calendar day. Returns None most of the time - by design."""
    today_str = date.today().isoformat()
    if user.last_bonus_date == today_str:
        return None
    if random.random() >= BONUS_CHANCE:
        return None

    user.last_bonus_date = today_str
    user.reward_points += BONUS_POINTS
    session.commit()
    return {"text": random.choice(BONUS_LINES), "reward_points_earned": BONUS_POINTS}


class ShareRequest(BaseModel):
    moment_type: str


@router.post("/share")
def log_share(req: ShareRequest, current_user_id: int = Depends(auth.get_current_user_id)):
    session = get_session(engine)
    user = session.get(User, current_user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    day_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    shares_today = (
        session.query(ShareEvent)
        .filter(ShareEvent.user_id == user.id, ShareEvent.created_at >= day_start)
        .count()
    )
    reward_granted = shares_today < SHARE_DAILY_CAP

    session.add(ShareEvent(user_id=user.id, moment_type=req.moment_type, reward_granted=reward_granted))
    if reward_granted:
        user.reward_points += SHARE_REWARD_POINTS
    session.commit()

    return {"reward_granted": reward_granted, "reward_points": user.reward_points}


class SetThemeRequest(BaseModel):
    theme_id: str


@router.get("/themes")
def list_themes(current_user_id: int = Depends(auth.get_current_user_id)):
    session = get_session(engine)
    user = session.get(User, current_user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    return {
        "active_theme": user.chat_theme,
        "themes": [
            {"id": tid, **t, "unlocked": user.longest_streak >= t["unlock_streak"]}
            for tid, t in THEMES.items()
        ],
    }


@router.post("/theme")
def set_theme(req: SetThemeRequest, current_user_id: int = Depends(auth.get_current_user_id)):
    if req.theme_id not in THEMES:
        raise HTTPException(status_code=400, detail="Unknown theme_id.")
    session = get_session(engine)
    user = session.get(User, current_user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.longest_streak < THEMES[req.theme_id]["unlock_streak"]:
        raise HTTPException(status_code=403, detail="Theme not unlocked yet.")

    user.chat_theme = req.theme_id
    session.commit()
    return {"active_theme": user.chat_theme}


@router.get("/state")
def rewards_state(current_user_id: int = Depends(auth.get_current_user_id)):
    session = get_session(engine)
    user = session.get(User, current_user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return {
        "current_streak": user.current_streak,
        "longest_streak": user.longest_streak,
        "streak_freezes": user.streak_freezes,
        "reward_points": user.reward_points,
        "chat_theme": user.chat_theme,
    }