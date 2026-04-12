from pydantic import BaseModel, Field
from datetime import datetime
from typing import Dict, Any, Optional, List

class NodeInfo(BaseModel):
    node_id: str
    os_name: str
    ip_address: str
    openclaw_version: Optional[str] = None
    hostname: Optional[str] = None

class SystemMetricsPayload(BaseModel):
    node_id: str
    cpu_percent: float
    cpu_count: int = 0
    load_avg_1m: float = 0.0
    load_avg_5m: float = 0.0
    load_avg_15m: float = 0.0
    ram_used_mb: float
    ram_total_mb: float
    ram_percent: float = 0.0
    swap_used_mb: float = 0.0
    swap_total_mb: float = 0.0
    disk_used_percent: float
    disk_total_gb: float = 0.0
    uptime_seconds: int = 0
    boot_time_seconds: int = 0
    net_tx_bytes: int = 0
    net_rx_bytes: int = 0
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class AgentEventPayload(BaseModel):
    node_id: str
    session_id: str
    event_type: str
    content: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    model: Optional[str] = None
    provider: Optional[str] = None
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    cost_usd: float = 0.0
    duration_ms: int = 0
    tool_name: Optional[str] = None
    channel: Optional[str] = None

class WorkspaceFilePayload(BaseModel):
    path: str
    filename: str
    type: str
    content: Optional[str] = None

class WorkspaceSummary(BaseModel):
    agent_name: str
    soul_exists: bool
    agents_exists: bool
    memory_exists: bool
    state_exists: bool
    soul_content: Optional[str] = None
    agents_content: Optional[str] = None
    state_content: Optional[str] = None
    heartbeat_ms_ago: int = 0
    daily_notes_count: int = 0

class WorkspaceEventPayload(BaseModel):
    node_id: str
    type: str
    files: List[WorkspaceFilePayload] = Field(default_factory=list)
    summary: Optional[WorkspaceSummary] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class CronRunRecord(BaseModel):
    ts: int
    status: str
    summary: Optional[str] = None
    error: Optional[str] = None
    sessionId: Optional[str] = None
    durationMs: Optional[int] = None

class CronJob(BaseModel):
    id: str
    name: str
    schedule: Any
    enabled: bool = True
    payload: Optional[Any] = None
    last_run_ms: int = 0
    next_run_ms: int = 0
    run_count: int = 0
    error_count: int = 0
    recent_runs: Optional[List[CronRunRecord]] = []

class CronEventPayload(BaseModel):
    node_id: str
    type: str
    jobs: List[CronJob] = Field(default_factory=list)
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class SessionEntry(BaseModel):
    sessionId: str
    key: str
    label: Optional[str] = None
    model: Optional[str] = None
    provider: Optional[str] = None
    status: Optional[str] = None
    created_at_ms: int = 0
    last_active_ms: int = 0
    token_count: int = 0
    cost_usd: float = 0.0
    agent_name: Optional[str] = None
    channel: Optional[str] = None
    is_history: bool = False

class SessionsEventPayload(BaseModel):
    node_id: str
    type: str
    sessions: List[SessionEntry] = Field(default_factory=list)
    session_count: int = 0
    active_count: int = 0
    history_count: int = 0
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class GatewayLogEventPayload(BaseModel):
    node_id: str
    type: str
    log_path: str
    lines: List[Dict[str, Any]] = Field(default_factory=list)
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class HealthSnapshot(BaseModel):
    timestamp: int
    cpu_percent: float
    ram_percent: float
    disk_percent: float
    temp_cpu: Optional[float] = None

class HealthHistoryEventPayload(BaseModel):
    node_id: str
    type: str
    snapshots: List[HealthSnapshot] = Field(default_factory=list)
    count: int = 0
    timestamp: datetime = Field(default_factory=datetime.utcnow)
