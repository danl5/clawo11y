from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from core.server.database import get_db
from core.server.models import SessionsEvent
from core.server.websocket_manager import manager
from core.shared.schemas import SessionsEventPayload

router = APIRouter()

@router.post("/", status_code=status.HTTP_201_CREATED)
async def report_sessions_event(payload: SessionsEventPayload, db: Session = Depends(get_db)):
    try:
        db_event = SessionsEvent(
            node_id=payload.node_id,
            event_type=payload.type,
            sessions=[s.model_dump() for s in payload.sessions],
            session_count=payload.session_count,
            active_count=payload.active_count,
            history_count=payload.history_count,
            timestamp=payload.timestamp,
        )
        db.add(db_event)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    try:
        await manager.broadcast({
            "type": "sessions_event",
            "node_id": payload.node_id,
            "event_type": payload.type,
            "session_count": payload.session_count,
            "active_count": payload.active_count,
            "history_count": payload.history_count,
            "sessions": [s.model_dump() for s in payload.sessions],
            "timestamp": payload.timestamp.isoformat() if hasattr(payload.timestamp, 'isoformat') else str(payload.timestamp),
        })
    except Exception:
        pass

    return {"message": "Sessions event received"}
