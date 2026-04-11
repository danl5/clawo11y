from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from core.server.database import engine, Base
from core.server.models import Node, SystemMetric, AgentEvent, WorkspaceEvent, CronEvent, SessionsEvent, GatewayLogEvent, HealthHistoryEvent

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="OpenClaw O11y Server",
    description="Centralized observability server for OpenClaw nodes.",
    version="0.1.0",
)

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
