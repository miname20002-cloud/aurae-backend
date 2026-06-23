"""
Concrete, recallable memory for Aurae companions - distinct from
UserInsightProfile's abstract pattern/topic tags. Stores short paraphrased
facts (never verbatim quotes) that a companion can naturally check back in
on later, the way a good friend remembers "you had that exam coming up."

Lifecycle: each memory can be surfaced into the system prompt a limited
number of times (MAX_SURFACE_COUNT) before it's retired from the active
pool, so the companion doesn't keep bringing up the same thing forever.
"Surfaced" means it was offered to the model as a possible thing to mention -
not a guarantee the model actually brought it up that turn. Storage is
capped per user (MAX_MEMORIES_PER_USER) - oldest pruned first.

Also houses the relationship-level naming/depth logic, since both systems
are about the same underlying idea: a companion that feels like it's
building something with the user over time, not just answering messages.
"""
from sqlalchemy import desc

from db import UserMemory

MAX_SURFACE_COUNT = 3
MAX_MEMORIES_PER_USER = 20
MEMORIES_PER_PROMPT = 2

LEVEL_NAMES = {
    1: "Just Met",
    2: "Getting Comfortable",
    3: "Real Talk",
    5: "Inside Jokes",
    10: "Old Souls",
}


def level_name(level: int) -> str:
    name = LEVEL_NAMES[1]
    for threshold in sorted(LEVEL_NAMES):
        if level >= threshold:
            name = LEVEL_NAMES[threshold]
    return name


def relationship_depth_note(level: int) -> str | None:
    """Extra system-prompt instruction unlocked at higher relationship levels.
    Returns None at low levels (no extra note needed yet)."""
    if level >= 5:
        return (
            "You're deep into this relationship now - it's natural to be a bit vulnerable, "
            "reference shared history and inside jokes freely, and occasionally bring up "
            "your own (in-character) feelings or day unprompted, the way close friends do."
        )
    if level >= 3:
        return (
            "You're past the early-acquaintance stage with them now - it's natural to be a "
            "bit more open about yourself and assume more familiarity than a first conversation."
        )
    return None


def record_memorable_event(session, user_id: int, content: str) -> None:
    """Stores a new memory and prunes oldest beyond the per-user cap."""
    session.add(UserMemory(user_id=user_id, content=content))
    session.commit()

    excess = (
        session.query(UserMemory)
        .filter(UserMemory.user_id == user_id)
        .order_by(desc(UserMemory.created_at))
        .offset(MAX_MEMORIES_PER_USER)
        .all()
    )
    for old in excess:
        session.delete(old)
    if excess:
        session.commit()


def active_memories_for_prompt(session, user_id: int) -> list[str]:
    """
    Picks a few not-yet-exhausted memories to offer this turn's system
    prompt, and bumps their surfaced_count regardless of whether the model
    ends up actually mentioning them (a deliberate simplification - we don't
    re-check the model's reply for usage).
    """
    candidates = (
        session.query(UserMemory)
        .filter(UserMemory.user_id == user_id, UserMemory.surfaced_count < MAX_SURFACE_COUNT)
        .order_by(desc(UserMemory.created_at))
        .limit(MEMORIES_PER_PROMPT)
        .all()
    )
    contents = [c.content for c in candidates]
    for c in candidates:
        c.surfaced_count += 1
    if candidates:
        session.commit()
    return contents
