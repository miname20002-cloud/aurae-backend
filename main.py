import json
import os
import re

from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from pydantic import BaseModel
from sqlalchemy import func

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
from db import (
    User, ChatMessage, UserInsightProfile, UsageLog,
    AdWatchEvent, LimitReachedEvent, SubscriptionEvent,
    get_engine, get_session,
)

app = FastAPI(title="Aurae")


def get_real_ip(request: Request) -> str:
    """
    Render sits behind a reverse proxy, so request.client.host is the
    proxy's IP, not the real client's. Render forwards the real IP in
    X-Forwarded-For - read that first, falling back to request.client.host
    for local/non-proxied runs (e.g. tests).
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def get_db():
    """
    FastAPI dependency that yields a DB session and guarantees it gets
    closed after the request, success or failure. Every endpoint below
    used to call `session = get_session(engine)` directly and never close
    it - that silently leaked a connection per request. SQLAlchemy's
    default pool (pool_size=5, max_overflow=10) only allows 15 connections
    total, so the 16th concurrent request would hang for 30s waiting for
    one to free up, then raise QueuePool TimeoutError. Use
    `session = Depends(get_db)` in every endpoint instead of calling
    get_session(engine) directly.
    """
    session = get_session(engine)
    try:
        yield session
    finally:
        session.close()


def _log_usage(session, user_id: int, character: str | None, endpoint: str, usage: dict):
    """
    Persists one Anthropic-via-OpenRouter call's token counts + actual
    billed cost (usage["cost"], straight from OpenRouter's response - real
    spend, not an estimate). Called right after each claude_client call
    succeeds, before any downstream processing, so a later error in that
    request doesn't silently drop the cost record for a call that did
    happen and did get billed.
    """
    session.add(
        UsageLog(
            user_id=user_id,
            character=character,
            endpoint=endpoint,
            model=usage.get("model", "unknown"),
            input_tokens=usage.get("prompt_tokens", 0),
            output_tokens=usage.get("completion_tokens", 0),
            estimated_cost_usd=usage.get("cost", 0.0),
        )
    )
    session.commit()


limiter = Limiter(key_func=get_real_ip)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

PERSONAS = json.load(open(os.path.join(os.path.dirname(__file__), "personas.json"), encoding="utf-8"))

# 분쟁 대응(모함/허위 스크린샷 대응 등)용 admin 조회 엔드포인트 보호 키.
# Render 대시보드 환경변수에 ADMIN_API_KEY를 직접 설정하세요 - 코드에 값을
# 적어두면 안 됩니다. 설정 안 하면 해당 엔드포인트는 항상 403을 반환합니다.
ADMIN_API_KEY = os.environ.get("ADMIN_API_KEY")

engine = get_engine(os.environ.get("DATABASE_URL", "sqlite:///aurae.db"))
print(f"[DB DEBUG] Using: {'POSTGRES' if 'postgresql' in str(engine.url) else 'SQLITE - fallback!'} | URL host: {engine.url.host}")

app.include_router(rewards.router)

INSIGHT_REFRESH_INTERVAL = 6

# Every 3 trust_markers earned (one per insight-refresh cycle where Claude
# detected a genuine trust signal) bumps relationship_level by 1 - see
# _refresh_insights() below. This constant exists purely so the frontend
# gauge can show "how full is the current level's bar", independent of
# the leveling formula itself ever changing.
TRUST_MARKERS_PER_LEVEL = 3

FREE_DAILY_MESSAGE_LIMIT = 25
# Premium is marketed as "unlimited" - this cap is a sanity ceiling against
# extreme abuse, not the real cost control (see PREMIUM_SONNET_DAILY_THRESHOLD
# below for that). Tightened from 300 -> 150 after unit-economics review.
PREMIUM_DAILY_MESSAGE_LIMIT = 150
# After this many messages in a day, a premium user's remaining messages for
# that day auto-downgrade from Sonnet to Haiku. This is the real cost lever -
# the average premium user never notices (most days end well under this),
# but it caps the worst-case cost of the heaviest users, who are exactly the
# people most likely to actually hit a flat "unlimited" claim hard.
PREMIUM_SONNET_DAILY_THRESHOLD = 30
# VVIP never downgrades - this cap is purely an abuse backstop, not expected
# to be hit in normal use. The economics here are carried by the higher price
# point, not by usage throttling.
VVIP_DAILY_MESSAGE_LIMIT = 1000
FREE_TIER_REPLY_MODEL = claude_client.FAST_MODEL
PREMIUM_TIER_REPLY_MODEL = claude_client.MODEL
VVIP_TIER_REPLY_MODEL = claude_client.MODEL

# 무료유저가 일일 한도에 도달했을 때, 보상형 광고 1회 시청으로 +3개를
# 더 받을 수 있다. 하루 최대 3회(=+9개)까지로 캡을 걸어서, 광고를
# 무한정 반복 시청해 한도 자체를 무력화하는 걸 막는다. (총 여유분은 작게
# 유지하고 광고 시청 "회수"를 늘리는 쪽으로 설계 - 같은 총량이면 광고
# 노출 빈도가 광고 수익에 더 직접적으로 기여한다.)
AD_BONUS_MESSAGES = 3
AD_BONUS_MAX_PER_DAY = 3
# 광고 1회 완료 시 가정 수익 (USD). 실제 AdMob 콘솔 eCPM 확인 후 교체.
ASSUMED_AD_ECPM = 0.01

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


def _relationship_progress_pct(trust_markers: int) -> float:
    """0-100 fill for 'how close to the next relationship level' - purely
    for the frontend gauge. See TRUST_MARKERS_PER_LEVEL note above."""
    return round((trust_markers % TRUST_MARKERS_PER_LEVEL) / TRUST_MARKERS_PER_LEVEL * 100, 1)


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


class PushTokenRequest(BaseModel):
    push_token: str


@app.post("/debug/set-tier")
def debug_set_tier(
    req: SetTierRequest,
    current_user_id: int = Depends(auth.get_current_user_id),
    session=Depends(get_db),
):
    if req.tier not in ("free", "premium", "vvip"):
        raise HTTPException(status_code=400, detail="tier must be 'free', 'premium', or 'vvip'.")
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


@app.post("/rewards/ad-bonus")
def watch_ad_bonus(current_user_id: int = Depends(auth.get_current_user_id), session=Depends(get_db)):
    """
    Free-tier users who've hit today's message cap can watch a rewarded ad
    to unlock a few more messages right then - this is the actual
    monetization moment, since it's the exact instant a non-paying user is
    most willing to trade attention for access. Capped at AD_BONUS_MAX_PER_DAY
    redemptions/day so this can't be farmed into an unlimited-messages
    loophole that defeats the daily cap entirely.

    NOTE: this endpoint only grants the bonus - it does not itself verify
    that an ad was actually shown. The actual ad SDK (e.g. AdMob rewarded
    ad) must call this only from its "ad fully watched" callback on the
    client; calling it from anywhere else in the client is a client-side
    trust issue, not something this endpoint can prevent server-side
    without a signed ad-network server callback (most mediation SDKs offer
    one - wire that in before shipping if abuse becomes a real problem).
    """
    user = session.get(User, current_user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    if user.tier != "free":
        raise HTTPException(status_code=400, detail="Ad bonus is only available on the free tier.")

    today = date.today().isoformat()
    if user.ad_bonus_date != today:
        user.ad_bonus_date = today
        user.ad_bonus_count = 0

    if user.ad_bonus_count >= AD_BONUS_MAX_PER_DAY:
        raise HTTPException(status_code=403, detail="No more bonus messages available today.")

    user.ad_bonus_count += 1
    user.daily_message_count = max(0, user.daily_message_count - AD_BONUS_MESSAGES)

    # 위치 A: 광고 시청 완료 → AdWatchEvent 기록, 대기 중인 LimitReachedEvent → "watched_ad" 업데이트
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    pending_limit_event = (
        session.query(LimitReachedEvent)
        .filter(
            LimitReachedEvent.user_id == user.id,
            LimitReachedEvent.reached_at >= today_start,
            LimitReachedEvent.action_taken.is_(None),
        )
        .order_by(LimitReachedEvent.reached_at.desc())
        .first()
    )
    if pending_limit_event:
        pending_limit_event.action_taken = "watched_ad"
    session.add(AdWatchEvent(
        user_id=user.id,
        completed=True,
        reward_granted=True,
        daily_count_at_watch=user.ad_bonus_count,
    ))
    session.commit()

    return {
        "messages_granted": AD_BONUS_MESSAGES,
        "ad_bonus_remaining_today": AD_BONUS_MAX_PER_DAY - user.ad_bonus_count,
        "daily_message_count": user.daily_message_count,
        "daily_limit": FREE_DAILY_MESSAGE_LIMIT,
    }


class SubscriptionEventRequest(BaseModel):
    event_type: str   # "start" | "renew" | "cancel" | "downgrade"
    tier: str         # "premium" | "vvip"
    mrr_amount: float  # cancel/downgrade이면 0


@app.post("/subscriptions/event")
def record_subscription_event(
    req: SubscriptionEventRequest,
    current_user_id: int = Depends(auth.get_current_user_id),
    session=Depends(get_db),
):
    """
    구독 시작/갱신/해지/다운그레이드를 기록하고 user.tier를 반영합니다.

    TODO: 실제 PG 또는 RevenueCat 연동 후 이 엔드포인트를 webhook 수신처로 연결하세요.
    - RevenueCat webhook 설정: https://www.revenuecat.com/docs/integrations/webhooks
    - 이벤트 타입 매핑:
        INITIAL_PURCHASE  → event_type="start"
        RENEWAL           → event_type="renew"
        CANCELLATION      → event_type="cancel"
        PRODUCT_CHANGE    → event_type="downgrade" (또는 "start" with new tier)
    - webhook secret 검증(X-RevenueCat-Signature 헤더)은 보안 필수 - 론칭 전 추가 필요.
    현재는 JWT 인증된 클라이언트가 직접 호출하는 더미 엔드포인트입니다.
    """
    if req.event_type not in ("start", "renew", "cancel", "downgrade"):
        raise HTTPException(status_code=400, detail="event_type must be start/renew/cancel/downgrade.")
    if req.tier not in ("premium", "vvip"):
        raise HTTPException(status_code=400, detail="tier must be premium or vvip.")

    user = session.get(User, current_user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    if req.event_type in ("start", "renew"):
        user.tier = req.tier
    elif req.event_type in ("cancel", "downgrade"):
        user.tier = "free"

    # 위치 B-2: 업그레이드 시 당일 미해결 LimitReachedEvent → "upgraded" 업데이트
    if req.event_type == "start":
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        pending_limit_event = (
            session.query(LimitReachedEvent)
            .filter(
                LimitReachedEvent.user_id == user.id,
                LimitReachedEvent.reached_at >= today_start,
                LimitReachedEvent.action_taken.is_(None),
            )
            .order_by(LimitReachedEvent.reached_at.desc())
            .first()
        )
        if pending_limit_event:
            pending_limit_event.action_taken = "upgraded"

    session.add(SubscriptionEvent(
        user_id=user.id,
        event_type=req.event_type,
        tier=req.tier,
        mrr_amount=req.mrr_amount,
    ))
    session.commit()
    return {"ok": True, "tier": user.tier}


@app.get("/admin/users/{user_id}/messages")
def admin_get_user_messages(user_id: int, x_admin_key: str = Header(None), session=Depends(get_db)):
    """
    분쟁 대응용 - 유저가 가짜 스크린샷/조작된 대화로 모함할 경우, 실제
    서버에 저장된 원본 대화 기록(타임스탬프 포함)을 대조 확인하기 위한
    엔드포인트. ADMIN_API_KEY 헤더(x-admin-key)로만 접근 가능하며, 일반
    유저 인증(JWT)과는 별개의 보호 체계다.
    """
    if not ADMIN_API_KEY or x_admin_key != ADMIN_API_KEY:
        raise HTTPException(status_code=403, detail="Forbidden.")

    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    messages = (
        session.query(ChatMessage)
        .filter(ChatMessage.user_id == user_id)
        .order_by(ChatMessage.id.asc())
        .all()
    )

    return {
        "user_id": user.id,
        "name": user.name,
        "companion_id": user.companion_id,
        "account_created_at": user.created_at.isoformat() if user.created_at else None,
        "message_count": len(messages),
        "messages": [
            {
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ],
    }


@app.get("/admin/usage-report")
def admin_usage_report(x_admin_key: str = Header(None), session=Depends(get_db)):
    """
    캐릭터별/엔드포인트별 토큰 사용량과 실제 비용 집계.
    estimated_cost_usd는 OpenRouter가 응답마다 같이 내려주는 실제 청구
    금액(usage.cost)을 그대로 적재한 값이라, 별도 가격표로 추정한 값이
    아니라 실제로 청구된 금액에 가깝다 (claude_client._extract_usage 참고).
    ADMIN_API_KEY 헤더(x-admin-key)로만 접근 가능.
    """
    if not ADMIN_API_KEY or x_admin_key != ADMIN_API_KEY:
        raise HTTPException(status_code=403, detail="Forbidden.")

    total_cost = session.query(func.sum(UsageLog.estimated_cost_usd)).scalar() or 0.0
    total_calls = session.query(func.count(UsageLog.id)).scalar() or 0

    by_character = (
        session.query(
            UsageLog.character,
            func.sum(UsageLog.estimated_cost_usd),
            func.sum(UsageLog.input_tokens),
            func.sum(UsageLog.output_tokens),
            func.count(UsageLog.id),
        )
        .group_by(UsageLog.character)
        .all()
    )

    by_endpoint = (
        session.query(
            UsageLog.endpoint,
            func.sum(UsageLog.estimated_cost_usd),
            func.count(UsageLog.id),
        )
        .group_by(UsageLog.endpoint)
        .all()
    )

    return {
        "total_cost_usd": round(total_cost, 4),
        "total_calls": total_calls,
        "by_character": [
            {
                "character": character or "unknown",
                "cost_usd": round(cost or 0.0, 4),
                "input_tokens": int(input_tok or 0),
                "output_tokens": int(output_tok or 0),
                "calls": count,
            }
            for character, cost, input_tok, output_tok, count in by_character
        ],
        "by_endpoint": [
            {"endpoint": endpoint, "cost_usd": round(cost or 0.0, 4), "calls": count}
            for endpoint, cost, count in by_endpoint
        ],
    }


@app.get("/admin/economics-report")
def admin_economics_report(
    start_date: str = None,
    end_date: str = None,
    x_admin_key: str = Header(None),
    session=Depends(get_db),
):
    """
    Unit economics 리포트: ARPU vs 비용(Contribution Margin), 손익분기 DAU 역산,
    한도→광고/업그레이드 전환 퍼널. ADMIN_API_KEY 헤더(x-admin-key)로만 접근 가능.

    기본 기간: 최근 7일. start_date/end_date는 YYYY-MM-DD 형식.

    NOTE: cost.by_tier는 UsageLog를 현재 User.tier에 조인하므로 기간 중 티어 변경이
    있는 유저는 현재 티어 기준으로 집계됩니다. CBT 소규모 단계에서 허용 가능한 근사치.
    """
    if not ADMIN_API_KEY or x_admin_key != ADMIN_API_KEY:
        raise HTTPException(status_code=403, detail="Forbidden.")

    end_dt = (
        datetime.fromisoformat(end_date).replace(hour=23, minute=59, second=59)
        if end_date
        else datetime.utcnow()
    )
    start_dt = (
        datetime.fromisoformat(start_date).replace(hour=0, minute=0, second=0)
        if start_date
        else end_dt - timedelta(days=7)
    )

    # --- cost ---
    cost_total = (
        session.query(func.sum(UsageLog.estimated_cost_usd))
        .filter(UsageLog.created_at >= start_dt, UsageLog.created_at <= end_dt)
        .scalar() or 0.0
    )

    cost_by_char_rows = (
        session.query(UsageLog.character, func.sum(UsageLog.estimated_cost_usd))
        .filter(
            UsageLog.created_at >= start_dt,
            UsageLog.created_at <= end_dt,
            UsageLog.character.isnot(None),
        )
        .group_by(UsageLog.character)
        .all()
    )
    cost_by_char = {"chloe": 0.0, "maya": 0.0, "ethan": 0.0, "jayden": 0.0}
    for char, cost in cost_by_char_rows:
        if char in cost_by_char:
            cost_by_char[char] = round(cost or 0.0, 6)

    cost_by_tier_rows = (
        session.query(User.tier, func.sum(UsageLog.estimated_cost_usd))
        .join(User, UsageLog.user_id == User.id)
        .filter(
            UsageLog.created_at >= start_dt,
            UsageLog.created_at <= end_dt,
            UsageLog.user_id.isnot(None),
        )
        .group_by(User.tier)
        .all()
    )
    cost_by_tier = {"free": 0.0, "premium": 0.0, "vvip": 0.0}
    for tier, cost in cost_by_tier_rows:
        if tier in cost_by_tier:
            cost_by_tier[tier] = round(cost or 0.0, 6)

    # --- revenue ---
    ad_count = (
        session.query(func.count(AdWatchEvent.id))
        .filter(
            AdWatchEvent.completed.is_(True),
            AdWatchEvent.watched_at >= start_dt,
            AdWatchEvent.watched_at <= end_dt,
        )
        .scalar() or 0
    )
    ad_estimated = round(ad_count * ASSUMED_AD_ECPM, 6)

    # MRR 스냅샷: end_dt 시점에서 각 유저의 가장 최근 구독 이벤트가 start/renew인 경우만 합산
    latest_sub_subq = (
        session.query(
            SubscriptionEvent.user_id,
            func.max(SubscriptionEvent.event_at).label("latest_at"),
        )
        .filter(SubscriptionEvent.event_at <= end_dt)
        .group_by(SubscriptionEvent.user_id)
        .subquery()
    )
    active_subs = (
        session.query(SubscriptionEvent)
        .join(
            latest_sub_subq,
            (SubscriptionEvent.user_id == latest_sub_subq.c.user_id)
            & (SubscriptionEvent.event_at == latest_sub_subq.c.latest_at),
        )
        .filter(SubscriptionEvent.event_type.in_(["start", "renew"]))
        .all()
    )
    subscription_mrr = round(sum(s.mrr_amount or 0.0 for s in active_subs), 2)
    revenue_total = round(ad_estimated + subscription_mrr, 6)

    # --- users ---
    total_active = (
        session.query(func.count(func.distinct(ChatMessage.user_id)))
        .filter(
            ChatMessage.created_at >= start_dt,
            ChatMessage.created_at <= end_dt,
            ChatMessage.role == "user",
        )
        .scalar() or 0
    )
    arpu = round(revenue_total / total_active, 6) if total_active else 0.0
    cost_per_user = round(cost_total / total_active, 6) if total_active else 0.0
    contribution_margin = round(arpu - cost_per_user, 6)

    # --- limit funnel ---
    reached = (
        session.query(func.count(LimitReachedEvent.id))
        .filter(LimitReachedEvent.reached_at >= start_dt, LimitReachedEvent.reached_at <= end_dt)
        .scalar() or 0
    )
    watched_ad_count = (
        session.query(func.count(LimitReachedEvent.id))
        .filter(
            LimitReachedEvent.reached_at >= start_dt,
            LimitReachedEvent.reached_at <= end_dt,
            LimitReachedEvent.action_taken == "watched_ad",
        )
        .scalar() or 0
    )
    upgraded_count = (
        session.query(func.count(LimitReachedEvent.id))
        .filter(
            LimitReachedEvent.reached_at >= start_dt,
            LimitReachedEvent.reached_at <= end_dt,
            LimitReachedEvent.action_taken == "upgraded",
        )
        .scalar() or 0
    )
    gave_up = max(0, reached - watched_ad_count - upgraded_count)

    # 손익분기 DAU: 고정비 / contribution_margin
    # TODO: MONTHLY_FIXED_COST_USD 환경변수에 실제 서버/운영 고정비(USD) 입력 시 자동 계산
    monthly_fixed = os.environ.get("MONTHLY_FIXED_COST_USD")
    if monthly_fixed and contribution_margin > 0:
        breakeven_dau = int(float(monthly_fixed) / 30 / contribution_margin)
    else:
        breakeven_dau = None  # 고정비 입력 필요 (MONTHLY_FIXED_COST_USD 환경변수)

    return {
        "period": {"start": start_dt.isoformat(), "end": end_dt.isoformat()},
        "cost": {
            "total": round(cost_total, 6),
            "by_character": cost_by_char,
            "by_tier": cost_by_tier,
        },
        "revenue": {
            "ad_estimated": ad_estimated,
            "ad_completed_views": ad_count,
            "assumed_ad_ecpm": ASSUMED_AD_ECPM,
            "subscription_mrr": subscription_mrr,
            "total": revenue_total,
        },
        "users": {
            "total_active": total_active,
            "arpu": arpu,
            "cost_per_user": cost_per_user,
            "contribution_margin": contribution_margin,
        },
        "limit_funnel": {
            "reached": reached,
            "watched_ad": watched_ad_count,
            "upgraded": upgraded_count,
            "gave_up": gave_up,
        },
        "breakeven_dau_estimate": breakeven_dau,
    }


@app.post("/signup")
@limiter.limit("5/minute")
def signup(req: SignupRequest, request: Request, session=Depends(get_db)):

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
@limiter.limit("20/minute")
def refresh_token_endpoint(req: RefreshRequest, request: Request, session=Depends(get_db)):
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


@app.post("/push-token")
def register_push_token(
    req: PushTokenRequest,
    current_user_id: int = Depends(auth.get_current_user_id),
    session=Depends(get_db),
):
    """
    프론트에서 expo-notifications로 받은 Expo push token을 저장한다.
    send_reminders.py(Render Cron Job)가 이 토큰으로 스트릭 리마인더/
    선제문자를 보낸다. 토큰이 비어있으면(알림 권한 거부 등) 그냥 null로
    저장해서, 해당 유저는 cron 조회 시 자동으로 제외된다.
    """
    user = session.get(User, current_user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    user.push_token = req.push_token or None
    session.commit()
    return {"ok": True}


@app.get("/chat/history")
def chat_history(current_user_id: int = Depends(auth.get_current_user_id), session=Depends(get_db)):
    user = session.get(User, current_user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    profile = session.get(UserInsightProfile, user.id)
    level = profile.relationship_level if profile else 1
    trust_markers = profile.trust_markers if profile else 0

    recent = (
        session.query(ChatMessage)
        .filter(ChatMessage.user_id == user.id)
        .order_by(ChatMessage.id.desc())
        .limit(40)
        .all()
    )
    messages = [{"role": m.role, "content": m.content, "is_proactive": m.is_proactive} for m in reversed(recent)]

    asset_path = None
    if user.last_emotion_asset and "_question." not in user.last_emotion_asset:
        asset_path = asset_map.asset_path_for(user.companion_id, user.last_emotion_asset)

    return {
        "messages": messages,
        "asset_path": asset_path,
        "relationship_level": level,
        "relationship_level_name": memories.level_name(level),
        "relationship_progress_pct": _relationship_progress_pct(trust_markers),
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

    # 🌟 [Aurae 멤버십 전용 지침 추가] 엘리트적이고 도도한 톤앤매너 강제 주입
    aurae_elite_instruction = (
        "Core Companion Identity Directive:\n"
        "You are 'Aurae', an elite, minimalist AI companion for Gen Z professionals.\n"
        "- Maintain a sophisticated, calm, and premium tone at all times.\n"
        "- DO NOT provide excessive emotional flattery, clingy reactions, or useless compliments.\n"
        "- Focus heavily on intellectual value, sharp wit, and deep objective insights."
    )

    # blocks 배열에 aurae_elite_instruction을 추가하여 프롬프트에 병합
    blocks = [
        persona["base_system_prompt"], 
        aurae_elite_instruction, # 지침 결합
        level_note, 
        context_block, 
        mood_note, 
        emoji_note, 
        intro_note
    ]
    
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
def chat_greeting(current_user_id: int = Depends(auth.get_current_user_id), session=Depends(get_db)):
    """
    Generates the character's proactive opening line right after signup,
    before the user has typed anything. Only works once - if any messages
    already exist for this user, refuses (use /chat normally instead).

    Uses a dedicated cinematic "intro" video clip (e.g. Chloe_Assets/Chloe_intro.mp4)
    instead of a regular emotion-reaction clip, since this is meant to be a
    one-time attention-grabbing moment rather than a reactive expression.
    """
    user = session.get(User, current_user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    existing = session.query(ChatMessage).filter(ChatMessage.user_id == user.id).count()
    if existing > 0:
        raise HTTPException(status_code=400, detail="Greeting already sent for this user.")

    persona = PERSONAS[user.companion_id]
    profile = session.get(UserInsightProfile, user.id)
    reply_model = FREE_TIER_REPLY_MODEL if user.tier == "free" else PREMIUM_TIER_REPLY_MODEL

    turn_mood = {"mood": "curious", "intensity": 3, "life_theme": "first meeting", "needs_realtime_info": False}
    system_prompt = _build_system_prompt(persona, profile, turn_mood, None, True, user.name)

    opener_instruction = (
        f"This is the very start of your first conversation with {user.name} - they haven't said "
        "anything yet, this is your chance to message first. Open with a short, punchy, "
        "attention-grabbing line that *shows* your personality instead of *telling* them about it. "
        "Skip any 'proving you're real' or 'I'm genuine' disclaimers—just be yourself from the jump. "
        "Be specific and a little surprising, not generic small talk like 'how can I help you today.' "
        "Use their name naturally if it fits. This one message sets the tone for everything, so make it good."
    )
    history = [{"role": "user", "content": opener_instruction}]

    raw_reply, usage = claude_client.generate_reply(system_prompt, history, model=reply_model)
    _log_usage(session, user.id, user.companion_id, "chat_greeting", usage)

    match = EMO_TAG_PATTERN.search(raw_reply)
    emotion_tag = match.group(1) if match and match.group(1) in asset_map.EMOTION_TAGS else "smile"
    reply = EMO_TAG_PATTERN.sub("", raw_reply).strip()

    cap = user.companion_id[:1].upper() + user.companion_id[1:]
    asset_path = f"assets/{cap}_Assets/{cap}_intro.mp4"
    user.last_emotion_asset = os.path.basename(asset_path)

    session.add(ChatMessage(user_id=user.id, role="assistant", content=reply))
    session.commit()

    return {
        "reply": reply,
        "emotion_tag": emotion_tag,
        "asset_path": asset_path,
        "relationship_level": profile.relationship_level,
        "relationship_level_name": memories.level_name(profile.relationship_level),
        "relationship_progress_pct": _relationship_progress_pct(profile.trust_markers),
    }


@app.post("/chat")
def chat(
    req: ChatRequest,
    current_user_id: int = Depends(auth.get_current_user_id),
    session=Depends(get_db),
):
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
            "relationship_progress_pct": _relationship_progress_pct(profile.trust_markers),
            "relationship_level_up": None,
        }

    today = date.today().isoformat()
    if user.daily_count_date != today:
        user.daily_count_date = today
        user.daily_message_count = 0
        session.commit()

    daily_limit = {
        "vvip": VVIP_DAILY_MESSAGE_LIMIT,
        "premium": PREMIUM_DAILY_MESSAGE_LIMIT,
    }.get(user.tier, FREE_DAILY_MESSAGE_LIMIT)
    if user.daily_message_count >= daily_limit:
        reply_template = PREMIUM_LIMIT_REACHED_REPLY if user.tier in ("premium", "vvip") else LIMIT_REACHED_REPLY
        reply = reply_template.format(name=persona["name"])
        asset_path = asset_map.resolve_asset(user.companion_id, "neutral", user.last_emotion_asset)

        # 위치 B: 한도 첫 도달 시 1회만 기록. 이미 미해결 이벤트가 있으면 스킵
        # (광고 시청 후 추가 메시지를 소진하고 다시 한도에 도달하면 새 이벤트 생성).
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        already_logged = (
            session.query(LimitReachedEvent)
            .filter(
                LimitReachedEvent.user_id == user.id,
                LimitReachedEvent.reached_at >= today_start,
                LimitReachedEvent.action_taken.is_(None),
            )
            .first()
        )
        if not already_logged:
            session.add(LimitReachedEvent(user_id=user.id, tier_at_time=user.tier))
            session.commit()

        return {
            "reply": reply,
            "mood": "neutral",
            "emotion_tag": "neutral",
            "asset_path": asset_path,
            "crisis_flagged": False,
            "limit_reached": True,
            "ad_bonus_eligible": user.tier == "free",
            "streak": streak_info,
            "bonus": None,
            "relationship_level": profile.relationship_level,
            "relationship_progress_pct": _relationship_progress_pct(profile.trust_markers),
            "relationship_level_up": None,
        }

    if user.tier == "vvip":
        # VVIP never downgrades - the higher price point carries the cost,
        # not a usage throttle.
        reply_model = VVIP_TIER_REPLY_MODEL
    elif user.tier == "premium":
        # Cost control lever: once a premium user crosses the daily Sonnet
        # threshold, the rest of today's replies quietly downgrade to Haiku.
        # Most premium users never notice this - they're well under the
        # threshold on a typical day - but it caps the worst-case cost of
        # the heaviest users instead of relying on price alone.
        reply_model = (
            PREMIUM_TIER_REPLY_MODEL
            if user.daily_message_count < PREMIUM_SONNET_DAILY_THRESHOLD
            else FREE_TIER_REPLY_MODEL
        )
    else:
        reply_model = FREE_TIER_REPLY_MODEL

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

    raw_reply, usage = claude_client.generate_reply(system_prompt, history, model=reply_model)
    _log_usage(session, user.id, user.companion_id, "chat", usage)

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
        "relationship_progress_pct": _relationship_progress_pct(profile.trust_markers),
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
        raw, usage = claude_client.extract_insights(excerpt)
    except Exception:
        return None

    # Logged as soon as the call succeeds, regardless of whether the JSON
    # below parses cleanly - the cost was incurred either way.
    _log_usage(session, user.id, user.companion_id, "extract_insights", usage)

    try:
        data = json.loads(raw)
    except Exception:
        return None

    profile.emotional_patterns = json.dumps(data.get("emotional_patterns", []))
    profile.topics_of_interest = json.dumps(data.get("topics_of_interest", []))
    profile.comfort_style = data.get("comfort_style", profile.comfort_style)

    old_level = profile.relationship_level
    if data.get("trust_signal"):
        profile.trust_markers += 1
    profile.relationship_level = 1 + profile.trust_markers // TRUST_MARKERS_PER_LEVEL
    session.commit()

    memorable_event = data.get("memorable_event")
    if isinstance(memorable_event, str) and memorable_event.strip() and memorable_event.strip().lower() != "null":
        memories.record_memorable_event(session, user.id, memorable_event.strip())

    if profile.relationship_level > old_level:
        return {"new_level": profile.relationship_level, "level_name": memories.level_name(profile.relationship_level)}
    return None
