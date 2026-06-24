"""
Cron script - intended to run as a Render Cron Job (a separate scheduled
service, NOT the always-on web service), once per day.

Two independent jobs, deliberately sent with different "voices":

1. Streak reminders - sender is "Aurae" (the app), utility tone, no
   character personality. This is a system notification, not a message
   from the companion - putting a character's name/voice on a deadline
   reminder cheapens the relationship (it reads like the character is
   nagging about app mechanics).

2. Proactive character texts - sender is the companion's own name, written
   in their voice, and ALSO saved as a real ChatMessage (is_proactive=True)
   so it's sitting in the conversation when the user opens the app, not
   just a notification banner that disappears.

Both require the user to have a push_token saved (see POST /push-token in
main.py, set from the app via expo-notifications on launch).

IMPORTANT - timezone note: this MVP sends at whatever wall-clock time the
Render Cron Job is scheduled for, with no per-user timezone awareness. If
your user base spans multiple timezones, "streak ends in N hours" will be
inaccurate for some users. Fine for a single-region launch; revisit before
expanding regions.
"""
import os
import random
from datetime import date, datetime, timedelta

from exponent_server_sdk import PushClient, PushMessage, PushServerError, DeviceNotRegisteredError

from db import User, ChatMessage, get_engine, get_session

engine = get_engine(os.environ.get("DATABASE_URL", "sqlite:///aurae.db"))

PROACTIVE_MAX_PER_WEEK = 2
# 매일 도는 cron이 자격 있는 유저 전체한테 매번 다 보내면 스팸처럼 느껴진다.
# 하루 실행마다 자격자 중 일부만 무작위로 골라서, 결과적으로 "이따금"
# 느낌이 나게 한다 (요청하신 "선재 문자 + 게릴라" 느낌의 무작위성).
PROACTIVE_DAILY_SEND_PROBABILITY = 0.15

# 페르소나별 말투까지 맞춘 실제 생성은 claude_client를 통해 붙이는 게
# 이상적이지만(다음 단계 TODO), 우선 범용 멘트 풀로 시작한다 - 톤은
# rewards.py의 BONUS_LINES와 같은 결로 맞췄다.
PROACTIVE_LINES = [
    "hey - random thought, but you crossed my mind. what's going on with you?",
    "ok this is out of nowhere but I was just thinking about our last convo",
    "not gonna lie, it's been quiet without you. what's up?",
    "no real reason for this text, just wanted to say hey",
]


def send_push(token: str, title: str, body: str) -> bool:
    try:
        PushClient().publish(PushMessage(to=token, title=title, body=body, sound="default"))
        return True
    except DeviceNotRegisteredError:
        # 토큰이 더 이상 유효하지 않음(앱 삭제 등) - 호출부에서 push_token을
        # null로 비워서 다음 실행부터 조회 대상에서 자동 제외되게 한다.
        return False
    except PushServerError as e:
        print(f"[push error] {token}: {e}")
        return True  # 일시적 오류 - 토큰 자체는 살려둔다


def run_streak_reminders(session):
    """앱(Aurae) 명의로, 캐릭터 목소리 없이 보내는 사무적인 리마인더."""
    today = date.today().isoformat()
    candidates = (
        session.query(User)
        .filter(User.push_token.isnot(None))
        .filter(User.current_streak > 0)
        .filter(User.last_active_date != today)
        .all()
    )

    sent = 0
    for user in candidates:
        ok = send_push(
            user.push_token,
            "Aurae",
            f"🔥 Your {user.current_streak}-day streak ends soon - don't lose it.",
        )
        if not ok:
            user.push_token = None
        else:
            sent += 1
    session.commit()
    print(f"[streak reminders] sent to {sent}/{len(candidates)} candidates")


def run_proactive_messages(session):
    """캐릭터 본인 명의로, 캐릭터 목소리로 보내는 선제 문자 - 실제 채팅
    메시지로도 저장돼서 앱 열었을 때 대화창에 그대로 남아있다."""
    cutoff = datetime.utcnow() - timedelta(days=7)
    today = date.today().isoformat()

    candidates = (
        session.query(User)
        .filter(User.push_token.isnot(None))
        .filter(User.last_active_date != today)
        .all()
    )

    sent = 0
    for user in candidates:
        if random.random() > PROACTIVE_DAILY_SEND_PROBABILITY:
            continue

        recent_proactive_count = (
            session.query(ChatMessage)
            .filter(
                ChatMessage.user_id == user.id,
                ChatMessage.is_proactive.is_(True),
                ChatMessage.created_at >= cutoff,
            )
            .count()
        )
        if recent_proactive_count >= PROACTIVE_MAX_PER_WEEK:
            continue

        text = random.choice(PROACTIVE_LINES)
        session.add(ChatMessage(user_id=user.id, role="assistant", content=text, is_proactive=True))
        session.commit()

        companion_name = (user.companion_id or "").capitalize() or "Aurae"
        ok = send_push(user.push_token, companion_name, text)
        if not ok:
            user.push_token = None
            session.commit()
        else:
            sent += 1

    print(f"[proactive messages] sent to {sent} users")


if __name__ == "__main__":
    session = get_session(engine)
    try:
        run_streak_reminders(session)
        run_proactive_messages(session)
    finally:
        session.close()
