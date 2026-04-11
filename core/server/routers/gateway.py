from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from core.server.database import get_db
from core.server.models import GatewayLogEvent
from core.server.websocket_manager import manager
from core.shared.schemas import GatewayLogEventPayload

router = APIRouter()

@router.post("/", status_code=status.HTTP_201_CREATED)
async def report_gateway_log_event(payload: GatewayLogEventPayload, db: Session = Depends(get_db)):
    try:
        db_event = GatewayLogEvent(
            node_id=payload.node_id,
            event_type=payload.type,
            log_path=payload.log_path,
            lines=payload.lines,
            timestamp=payload.timestamp,
        )
        db.add(db_event)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    try:
        await manager.broadcast({
            "type": "gateway_log_event",
            "node_id": payload.node_id,
            "event_type": payload.type,
            "log_path": payload.log_path,
            "lines": payload.lines,
            "timestamp": payload.timestamp.isoformat() if hasattr(payload.timestamp, 'isoformat') else str(payload.timestamp),
        })
    except Exception:
        pass

    return {"message": "Gateway log event received"}
