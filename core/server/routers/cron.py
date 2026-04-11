from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from core.server.database import get_db
from core.server.models import CronEvent
from core.server.websocket_manager import manager
from core.shared.schemas import CronEventPayload

router = APIRouter()

@router.post("/", status_code=status.HTTP_201_CREATED)
async def report_cron_event(payload: CronEventPayload, db: Session = Depends(get_db)):
    try:
        db_event = CronEvent(
            node_id=payload.node_id,
            event_type=payload.type,
            jobs=[j.model_dump() for j in payload.jobs],
            timestamp=payload.timestamp,
        )
        db.add(db_event)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    try:
        await manager.broadcast({
            "type": "cron_event",
            "node_id": payload.node_id,
            "event_type": payload.type,
            "jobs": [j.model_dump() for j in payload.jobs],
            "timestamp": payload.timestamp.isoformat() if hasattr(payload.timestamp, 'isoformat') else str(payload.timestamp),
        })
    except Exception:
        pass

    return {"message": "Cron event received"}
