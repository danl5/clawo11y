from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from core.server.database import get_db, SessionLocal
from core.server.models import AgentEvent, SystemMetric, SessionsEvent, WorkspaceEvent, CronEvent, GatewayLogEvent
from core.server.websocket_manager import manager
from core.shared.schemas import AgentEventPayload

router = APIRouter()

import asyncio
import logging

logger = logging.getLogger(__name__)

# --- Event Queue for Batch Insert ---
# This prevents SQLite from locking up during high concurrency (e.g. Agent restart)
event_queue = asyncio.Queue()

async def process_event_queue():
    """Background task that takes events from the queue and inserts them in batches."""
    batch = []
    batch_size = 50
    
    while True:
        try:
            # Wait for at least one item
            item = await event_queue.get()
            batch.append(item)
            
            # Try to grab more items immediately available, up to batch_size
            while len(batch) < batch_size and not event_queue.empty():
                batch.append(event_queue.get_nowait())
                
            # Perform bulk insert
            if batch:
                db = SessionLocal()
                try:
                    db.bulk_save_objects(batch)
                    db.commit()
                except Exception as e:
                    db.rollback()
                    logger.error(f"Bulk insert failed: {e}")
                finally:
                    db.close()
                    
                # Mark tasks as done
                for _ in range(len(batch)):
                    event_queue.task_done()
                batch.clear()
                
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Queue processor error: {e}")
            await asyncio.sleep(1)

# -----------------------------------

@router.get("/snapshot")
def get_snapshot(db: Session = Depends(get_db)):
    """Returns the latest state for all widgets."""
    metric = db.query(SystemMetric).order_by(SystemMetric.id.desc()).first()
    sessions = db.query(SessionsEvent).order_by(SessionsEvent.id.desc()).first()
    workspace_events = db.query(WorkspaceEvent).order_by(WorkspaceEvent.id.desc()).limit(50).all()
    cron = db.query(CronEvent).order_by(CronEvent.id.desc()).first()
    agent_events = db.query(AgentEvent).order_by(AgentEvent.id.desc()).limit(1000).all()
    gateway_logs = db.query(GatewayLogEvent).order_by(GatewayLogEvent.id.desc()).limit(50).all()
    
    events = []
    if metric:
        events.append({
            "type": "system_metrics", "node_id": metric.node_id, "cpu_percent": metric.cpu_percent,
            "ram_used_mb": metric.ram_used_mb, "ram_percent": metric.ram_percent,
            "disk_used_percent": metric.disk_used_percent, "uptime_seconds": metric.uptime_seconds,
            "timestamp": metric.timestamp.isoformat() if metric.timestamp else None,
        })
    if sessions:
        events.append({
            "type": "sessions_event", "node_id": sessions.node_id, "session_count": sessions.session_count,
            "sessions": sessions.sessions, "timestamp": sessions.timestamp.isoformat() if sessions.timestamp else None,
        })
        
    seen_ws_agents = set()
    for w in workspace_events:
        agent = getattr(w, "agent_name", "main")
        if agent not in seen_ws_agents:
            seen_ws_agents.add(agent)
            events.append({
                "type": "workspace_event", 
                "node_id": w.node_id, 
                "summary": {
                    "agent_name": agent,
                    "soul_exists": w.soul_exists,
                    "agents_exists": w.agents_exists,
                    "memory_exists": w.memory_exists,
                    "state_exists": getattr(w, "state_exists", False),
                    "soul_content": getattr(w, "soul_content", None),
                    "agents_content": getattr(w, "agents_content", None),
                    "state_content": getattr(w, "state_content", None),
                    "heartbeat_ms_ago": w.heartbeat_ms_ago,
                    "daily_notes_count": w.daily_notes_count,
                },
                "files": w.files, 
                "timestamp": w.timestamp.isoformat() if w.timestamp else None,
            })
            
    if cron:
        events.append({
            "type": "cron_event", "node_id": cron.node_id, "jobs": cron.jobs,
            "timestamp": cron.timestamp.isoformat() if cron.timestamp else None,
        })
    for g in reversed(gateway_logs):
        events.append({
            "type": "gateway_log_event", "node_id": g.node_id, "event_type": g.event_type,
            "log_path": getattr(g, "log_path", ""), "lines": g.lines,
            "timestamp": g.timestamp.isoformat() if g.timestamp else None,
        })
    for ev in reversed(agent_events):
        events.append({
            "type": "agent_event", "node_id": ev.node_id, "session_id": ev.session_id,
            "event_type": ev.event_type, "model": ev.model, "provider": ev.provider,
            "input_tokens": ev.input_tokens, "output_tokens": ev.output_tokens,
            "cache_read_tokens": ev.cache_read_tokens, "cache_write_tokens": ev.cache_write_tokens,
            "cost_usd": ev.cost_usd, "tool_name": ev.tool_name, "content": ev.content,
            "timestamp": ev.timestamp.isoformat() if ev.timestamp else None,
        })
    return {"messages": events}

@router.post("/", status_code=status.HTTP_201_CREATED)
async def report_event(payload: AgentEventPayload):
    try:
        db_event = AgentEvent(
            node_id=payload.node_id,
            session_id=payload.session_id,
            event_type=payload.event_type,
            content=payload.content,
            timestamp=payload.timestamp,
            model=payload.model,
            provider=payload.provider,
            input_tokens=payload.input_tokens,
            output_tokens=payload.output_tokens,
            cache_read_tokens=payload.cache_read_tokens,
            cache_write_tokens=payload.cache_write_tokens,
            cost_usd=payload.cost_usd,
            duration_ms=payload.duration_ms,
            tool_name=payload.tool_name,
            channel=payload.channel,
        )
        
        # Enqueue the event for background bulk insertion
        await event_queue.put(db_event)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    try:
        await manager.broadcast({
            "type": "agent_event",
            "node_id": payload.node_id,
            "session_id": payload.session_id,
            "event_type": payload.event_type,
            "model": payload.model,
            "provider": payload.provider,
            "input_tokens": payload.input_tokens,
            "output_tokens": payload.output_tokens,
            "cache_read_tokens": payload.cache_read_tokens,
            "cache_write_tokens": payload.cache_write_tokens,
            "cost_usd": payload.cost_usd,
            "duration_ms": payload.duration_ms,
            "tool_name": payload.tool_name,
            "content": payload.content,
            "timestamp": payload.timestamp.isoformat() if hasattr(payload.timestamp, 'isoformat') else str(payload.timestamp),
        })
    except Exception:
        pass

    return {"message": "Event received"}
