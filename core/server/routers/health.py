from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from core.server.database import get_db
from core.server.models import HealthHistoryEvent
from core.server.websocket_manager import manager
from core.shared.schemas import HealthHistoryEventPayload

router = APIRouter()

@router.post("/", status_code=status.HTTP_201_CREATED)
async def report_health_history_event(payload: HealthHistoryEventPayload, db: Session = Depends(get_db)):
    try:
        db_event = HealthHistoryEvent(
            node_id=payload.node_id,
            event_type=payload.type,
            snapshots=[s.model_dump() for s in payload.snapshots],
            count=payload.count,
            timestamp=payload.timestamp,
        )
        db.add(db_event)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    try:
        await manager.broadcast({
            "type": "health_history_event",
            "node_id": payload.node_id,
            "event_type": payload.type,
            "count": payload.count,
            "timestamp": payload.timestamp.isoformat() if hasattr(payload.timestamp, 'isoformat') else str(payload.timestamp),
        })
    except Exception:
        pass

    return {"message": "Health history event received"}
