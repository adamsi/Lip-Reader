"""Supabase Postgres chat store, mirroring sigma-agent-server's
chat_memory / chat_messages tables (header + ordered messages).

Serverless-friendly: one cached connection per process (Supabase session
pooler), reopened on failure; schema is created lazily once per process.
"""
from __future__ import annotations

import json
import logging
import threading

import psycopg
from psycopg.rows import dict_row

from . import config

log = logging.getLogger("chaplin.db")

_DDL = """
CREATE TABLE IF NOT EXISTS chat_memory (
    conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    description VARCHAR(256),
    sequence_number BIGSERIAL
);
CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id UUID NOT NULL
        REFERENCES chat_memory (conversation_id) ON DELETE CASCADE,
    type VARCHAR(16) NOT NULL,
    content TEXT NOT NULL,
    steps JSONB
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id
    ON chat_messages (conversation_id);
"""

_lock = threading.Lock()
_conn: psycopg.Connection | None = None
_schema_ready = False


def _connect() -> psycopg.Connection:
    if not config.DATABASE_URL:
        raise RuntimeError("DATABASE_URL not configured")
    return psycopg.connect(config.DATABASE_URL, autocommit=True, row_factory=dict_row)


def _get_conn() -> psycopg.Connection:
    global _conn, _schema_ready
    with _lock:
        if _conn is None or _conn.closed:
            _conn = _connect()
        if not _schema_ready:
            _conn.execute(_DDL)
            _schema_ready = True
        return _conn


def _run(fn):
    """Run ``fn(conn)``, reconnecting once if the cached connection went stale."""
    global _conn
    try:
        return fn(_get_conn())
    except psycopg.OperationalError:
        with _lock:
            if _conn is not None:
                try:
                    _conn.close()
                except Exception:  # noqa: BLE001
                    pass
                _conn = None
        return fn(_get_conn())


# --- repository (sigma-agent-server shape) ---------------------------------

def ping() -> bool:
    return _run(lambda c: c.execute("SELECT 1").fetchone()) is not None


def create_conversation(title: str) -> dict:
    row = _run(lambda c: c.execute(
        "INSERT INTO chat_memory (description) VALUES (%s) "
        "RETURNING conversation_id, description, sequence_number",
        (title,),
    ).fetchone())
    return _conv_out(row)


def list_conversations() -> list[dict]:
    rows = _run(lambda c: c.execute(
        "SELECT conversation_id, description, sequence_number "
        "FROM chat_memory ORDER BY sequence_number DESC"
    ).fetchall())
    return [_conv_out(r) for r in rows]


def get_messages(conversation_id: str) -> list[dict]:
    rows = _run(lambda c: c.execute(
        "SELECT id, type, content, steps FROM chat_messages "
        "WHERE conversation_id = %s ORDER BY id ASC",
        (conversation_id,),
    ).fetchall())
    return [_msg_out(r) for r in rows]


def append_message(conversation_id: str, role: str, content: str,
                   steps: list | None = None) -> dict | None:
    def op(c: psycopg.Connection):
        row = c.execute(
            "INSERT INTO chat_messages (conversation_id, type, content, steps) "
            "SELECT %s, %s, %s, %s WHERE EXISTS "
            "(SELECT 1 FROM chat_memory WHERE conversation_id = %s) "
            "RETURNING id, type, content, steps",
            (conversation_id, role.upper(), content,
             json.dumps(steps) if steps else None, conversation_id),
        ).fetchone()
        if row is not None:
            # provisional title from the first message (sigma pattern)
            c.execute(
                "UPDATE chat_memory SET description = %s "
                "WHERE conversation_id = %s AND description = 'New chat' "
                "AND (SELECT COUNT(*) FROM chat_messages WHERE conversation_id = %s) = 1",
                (_provisional_title(content), conversation_id, conversation_id),
            )
        return row

    row = _run(op)
    return _msg_out(row) if row else None


def delete_conversation(conversation_id: str) -> bool:
    # chat_messages cascade via the FK
    return _run(lambda c: c.execute(
        "DELETE FROM chat_memory WHERE conversation_id = %s "
        "RETURNING conversation_id",
        (conversation_id,),
    ).fetchone()) is not None


def _provisional_title(content: str) -> str:
    words = " ".join(content.strip().split()[:4])
    return (words[:40] + "…" if len(words) > 40 else words) or "New chat"


def _conv_out(row: dict) -> dict:
    return {
        "id": str(row["conversation_id"]),
        "title": row["description"] or "New chat",
        "seq": row["sequence_number"],
    }


def _msg_out(row: dict) -> dict:
    out = {"id": row["id"], "role": row["type"].lower(), "content": row["content"]}
    if row.get("steps"):
        out["steps"] = row["steps"]
    return out
