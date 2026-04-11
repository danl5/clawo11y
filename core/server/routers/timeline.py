from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from core.server.database import get_db
from core.server.models import AgentEvent

router = APIRouter()

@router.get("/{session_id}/timeline")
def get_session_timeline(session_id: str, db: Session = Depends(get_db)):
    events = (
        db.query(AgentEvent)
        .filter(AgentEvent.session_id == session_id)
        .order_by(AgentEvent.id.asc())
        .all()
    )
    return [
        {
            "id": e.id,
            "event_type": e.event_type,
            "model": e.model,
            "provider": e.provider,
            "input_tokens": e.input_tokens,
            "output_tokens": e.output_tokens,
            "cache_read_tokens": e.cache_read_tokens,
            "cache_write_tokens": e.cache_write_tokens,
            "cost_usd": e.cost_usd,
            "duration_ms": e.duration_ms,
            "tool_name": e.tool_name,
            "content": e.content,
            "timestamp": e.timestamp.isoformat() if e.timestamp else None,
        }
        for e in events
    ]

@router.get("/list")
def list_sessions(db: Session = Depends(get_db)):
    from sqlalchemy import func, distinct
    rows = (
        db.query(
            AgentEvent.session_id,
            func.count(AgentEvent.id).label("event_count"),
            func.max(AgentEvent.timestamp).label("last_event_at"),
            func.max(AgentEvent.model).label("model"),
            func.max(AgentEvent.event_type).label("last_event_type"),
        )
        .group_by(AgentEvent.session_id)
        .order_by(func.max(AgentEvent.timestamp).desc())
        .limit(100)
        .all()
    )
    return [
        {
            "session_id": r.session_id,
            "event_count": r.event_count,
            "last_event_at": r.last_event_at.isoformat() if r.last_event_at else None,
            "model": r.model,
            "last_event_type": r.last_event_type,
        }
        for r in rows
    ]
