"""
DB models for Aurae.
Design note: UserInsightProfile intentionally stores *summarized patterns*
(tags, levels, short descriptors) rather than raw verbatim transcripts of
sensitive disclosures. This keeps the personalization value (the AI "knows"
the user) while reducing how much raw sensitive personal data is retained
long-term. ChatMessage retention should have a defined max retention window
in production, configurable per region's privacy law requirements.

Reward system note: ShareEvent only logs *that* a share action happened and
its type (e.g. "chat_bubble"), never the actual shared content/image, since
that content already exists transiently in the app UI and doesn't need
server-side duplication.

Memory system note: UserMemory stores short, paraphrased, non-verbatim
"recallable facts" (e.g. "has a job interview Friday") - never raw quotes -
so the companion can naturally check back in on something later, the way a
friend would. Capped per user and retired after being surfaced a few times
(see memories.py) so it doesn't grow unbounded or get repeated forever.
"""
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
Base = declarative_base()
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    age_verified = Column(Boolean, default=False, nullable=False)
    companion_id = Column(String, nullable=True)  # chloe / maya / ethan / jayden
    last_emotion_asset = Column(String, nullable=True)  # filename only, e.g. "Chloe_wink2.mp4"
    tier = Column(String, default="free", nullable=False)  # "free" | "premium" | "vvip"
    daily_message_count = Column(Integer, default=0, nullable=False)
    daily_count_date = Column(String, nullable=True)  # "YYYY-MM-DD", resets count when it changes
    refresh_token_hash = Column(String, nullable=True)
    device_id = Column(String, nullable=True)
    refresh_token_expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # --- reward sprint 1 ---
    current_streak = Column(Integer, default=0, nullable=False)
    longest_streak = Column(Integer, default=0, nullable=False)
    last_active_date = Column(String, nullable=True)  # "YYYY-MM-DD", drives streak math
    streak_freezes = Column(Integer, default=0, nullable=False)  # earned "skip a day" tokens
    last_bonus_date = Column(String, nullable=True)  # "YYYY-MM-DD", caps surprise bonus to 1/day
    reward_points = Column(Integer, default=0, nullable=False)  # soft currency from streaks/shares/bonuses
    chat_theme = Column(String, default="default", nullable=False)  # active chat theme id

    # --- rewarded-ad bonus messages (free tier, monetizes the daily-cap wall) ---
    ad_bonus_date = Column(String, nullable=True)  # "YYYY-MM-DD", resets ad_bonus_count when it changes
    ad_bonus_count = Column(Integer, default=0, nullable=False)  # rewarded ads redeemed today, capped per day

    messages = relationship("ChatMessage", back_populates="user")
    insight_profile = relationship("UserInsightProfile", back_populates="user", uselist=False)
class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    role = Column(String, nullable=False)  # "user" or "assistant"
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="messages")
class UserInsightProfile(Base):
    __tablename__ = "user_insight_profiles"
    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    relationship_level = Column(Integer, default=1) 
    emotional_patterns = Column(Text, default="[]")   # JSON-encoded list of short tags
    comfort_style = Column(String, default="unknown")  # e.g. direct / gentle / hype
    topics_of_interest = Column(Text, default="[]")   # JSON-encoded list of tags
    trust_markers = Column(Integer, default=0)        # count, not raw content
    last_updated = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="insight_profile")
class ShareEvent(Base):
    __tablename__ = "share_events"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    moment_type = Column(String, nullable=False)  # e.g. "chat_bubble", "milestone", "theme"
    reward_granted = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User")
class UserMemory(Base):
    __tablename__ = "user_memories"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)  # short paraphrased fact, never a verbatim quote
    surfaced_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User")
def get_engine(db_url="sqlite:///aurae.db"):
    engine = create_engine(
        db_url,
        pool_pre_ping=True,
        connect_args={"check_same_thread": False} if "sqlite" in db_url else {},
    )
    Base.metadata.create_all(engine)
    return engine
def get_session(engine):
    return sessionmaker(bind=engine)()
