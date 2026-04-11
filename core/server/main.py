from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from core.server.database import engine, Base, SessionLocal
from core.server.models import Node, SystemMetric, AgentEvent, WorkspaceEvent, CronEvent, SessionsEvent, GatewayLogEvent, HealthHistoryEvent
import asyncio
from datetime import datetime, timedelta, timezone
import logging

logger = logging.getLogger(__name__)

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="OpenClaw O11y Server",
    description="Centralized observability server for OpenClaw nodes.",
    version="0.1.0",
)

# --- Data Retention Cleanup Task ---
async def cleanup_old_data():
    """Background task to delete data older than 7 days to prevent SQLite from growing infinitely."""
    while True:
        try:
            cutoff_date = datetime.now(timezone.utc) - timedelta(days=7)
            db = SessionLocal()
            try:
                # Clean up various event tables
                deleted_metrics = db.query(SystemMetric).filter(SystemMetric.timestamp < cutoff_date).delete()
                deleted_agents = db.query(AgentEvent).filter(AgentEvent.timestamp < cutoff_date).delete()
                deleted_workspaces = db.query(WorkspaceEvent).filter(WorkspaceEvent.timestamp < cutoff_date).delete()
                deleted_crons = db.query(CronEvent).filter(CronEvent.timestamp < cutoff_date).delete()
                deleted_sessions = db.query(SessionsEvent).filter(SessionsEvent.timestamp < cutoff_date).delete()
                deleted_gateways = db.query(GatewayLogEvent).filter(GatewayLogEvent.timestamp < cutoff_date).delete()
                deleted_health = db.query(HealthHistoryEvent).filter(HealthHistoryEvent.timestamp < cutoff_date).delete()
                
                db.commit()
                total_deleted = sum([deleted_metrics, deleted_agents, deleted_workspaces, deleted_crons, deleted_sessions, deleted_gateways, deleted_health])
                if total_deleted > 0:
                    logger.info(f"Cleanup task removed {total_deleted} old records (older than 7 days).")
            except Exception as e:
                db.rollback()
                logger.error(f"Error during cleanup task: {e}")
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Cleanup task failed: {e}")
        
        # Run once a day
        await asyncio.sleep(86400)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(cleanup_old_data())
# -----------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from core.server.routers import (
    nodes, metrics, events, websocket,
    workspace, cron, sessions, gateway, health,
)
from core.server.routers.timeline import router as timeline_router

app.include_router(nodes.router, prefix="/api/v1/nodes", tags=["Nodes"])
app.include_router(metrics.router, prefix="/api/v1/metrics", tags=["Metrics"])
app.include_router(events.router, prefix="/api/v1/events", tags=["Agent Events"])
app.include_router(workspace.router, prefix="/api/v1/events/workspace", tags=["Workspace Events"])
app.include_router(cron.router, prefix="/api/v1/events/cron", tags=["Cron Events"])
app.include_router(sessions.router, prefix="/api/v1/events/sessions", tags=["Sessions Events"])
app.include_router(gateway.router, prefix="/api/v1/events/gateway", tags=["Gateway Log Events"])
app.include_router(health.router, prefix="/api/v1/events/health", tags=["Health History Events"])
app.include_router(timeline_router, prefix="/api/v1/timeline", tags=["Session Timeline"])
app.include_router(websocket.router, prefix="/api/v1", tags=["WebSocket"])

web_dist = Path(__file__).parent.parent.parent / "web" / "dist"
if web_dist.exists():
    app.mount("/", StaticFiles(directory=str(web_dist), html=True), name="web")

@app.get("/health")
def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("core.server.main:app", host="0.0.0.0", port=8000, reload=True)
