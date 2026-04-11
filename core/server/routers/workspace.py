from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from core.server.database import get_db
from core.server.models import WorkspaceEvent
from core.server.websocket_manager import manager
from core.shared.schemas import WorkspaceEventPayload

router = APIRouter()

@router.post("/", status_code=status.HTTP_201_CREATED)
async def report_workspace_event(payload: WorkspaceEventPayload, db: Session = Depends(get_db)):
    summary = payload.summary
    try:
        db_event = WorkspaceEvent(
            node_id=payload.node_id,
            event_type=payload.type,
            agent_name=summary.agent_name if summary else "main",
            files=[f.model_dump() for f in payload.files],
            soul_exists=summary.soul_exists if summary else False,
            agents_exists=summary.agents_exists if summary else False,
            memory_exists=summary.memory_exists if summary else False,
            state_exists=summary.state_exists if summary else False,
            soul_content=summary.soul_content if summary else None,
            agents_content=summary.agents_content if summary else None,
            state_content=summary.state_content if summary else None,
            heartbeat_ms_ago=summary.heartbeat_ms_ago if summary else 0,
            daily_notes_count=summary.daily_notes_count if summary else 0,
            timestamp=payload.timestamp,
        )
        db.add(db_event)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    try:
        await manager.broadcast({
            "type": "workspace_event",
            "node_id": payload.node_id,
            "event_type": payload.type,
            "summary": payload.summary.model_dump() if payload.summary else None,
            "files": [f.model_dump() for f in payload.files],
            "timestamp": payload.timestamp.isoformat() if hasattr(payload.timestamp, 'isoformat') else str(payload.timestamp),
        })
    except Exception:
        pass

    return {"message": "Workspace event received"}
