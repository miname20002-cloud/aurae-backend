"""
DB models for Aurae.

Design note: UserInsightProfile intentionally stores *summarized patterns*
(tags, levels, short descriptors) rather than raw verbatim transcripts of
sensitive disclosures. This keeps the personalization value (the AI "knows"
the user) while reducing how much raw sensitive personal data is retained
long-term. ChatMessage retention should have a defined max retention window
in production, configurable per region's privacy law requirements.
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
    created_at = Column(DateTime, default=datetime.utcnow)

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


def get_engine(db_url="sqlite:///aurae.db"):
    engine = create_engine(db_url, connect_args={"check_same_thread": False} if "sqlite" in db_url else {})
    Base.metadata.create_all(engine)
    return engine


def get_session(engine):
    return sessionmaker(bind=engine)()
