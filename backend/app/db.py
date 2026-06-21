"""Tiny persistence layer: a single ``users`` table.

SQLAlchemy 2.0 so the same code runs on SQLite (local MVP) or Postgres
(set ``DATABASE_URL``). Voice mp4 samples live on disk, not in the DB.
"""
from __future__ import annotations

from sqlalchemy import String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from .config import DATABASE_URL

_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=_connect_args)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    clerk_user_id: Mapped[str] = mapped_column(String, primary_key=True)
    voice_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # "uploaded" | "preset" | None (not yet onboarded)
    voice_source: Mapped[str | None] = mapped_column(String, nullable=True)


Base.metadata.create_all(engine)


def get_or_create_user(clerk_user_id: str) -> User:
    with Session(engine) as s:
        user = s.get(User, clerk_user_id)
        if user is None:
            user = User(clerk_user_id=clerk_user_id)
            s.add(user)
            s.commit()
            s.refresh(user)
        return user


def set_voice(clerk_user_id: str, voice_id: str, voice_source: str) -> User:
    with Session(engine) as s:
        user = s.get(User, clerk_user_id)
        if user is None:
            user = User(clerk_user_id=clerk_user_id)
            s.add(user)
        user.voice_id = voice_id
        user.voice_source = voice_source
        s.commit()
        s.refresh(user)
        return user
