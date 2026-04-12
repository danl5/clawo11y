from sqlalchemy import Column, Integer, String, Float, DateTime, JSON, Boolean, BigInteger
from sqlalchemy.sql import func
from core.server.database import Base

class Node(Base):
    __tablename__ = "nodes"

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String, unique=True, index=True, nullable=False)
    os_name = Column(String)
    ip_address = Column(String)
    openclaw_version = Column(String, nullable=True)
    hostname = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_seen_at = Column(DateTime(timezone=True), onupdate=func.now())

class SystemMetric(Base):
    __tablename__ = "system_metrics"

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String, index=True, nullable=False)
    cpu_percent = Column(Float)
    cpu_count = Column(Integer, default=0)
    load_avg_1m = Column(Float, default=0.0)
    load_avg_5m = Column(Float, default=0.0)
    load_avg_15m = Column(Float, default=0.0)
    ram_used_mb = Column(Float)
    ram_total_mb = Column(Float)
    ram_percent = Column(Float, default=0.0)
    swap_used_mb = Column(Float, default=0.0)
    swap_total_mb = Column(Float, default=0.0)
    disk_used_percent = Column(Float)
    disk_total_gb = Column(Float, default=0.0)
    uptime_seconds = Column(Integer, default=0)
    boot_time_seconds = Column(Integer, default=0)
    net_tx_bytes = Column(BigInteger, default=0)
    net_rx_bytes = Column(BigInteger, default=0)
    timestamp = Column(DateTime(timezone=True), nullable=False)

class AgentEvent(Base):
    __tablename__ = "agent_events"

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String, index=True, nullable=False)
    session_id = Column(String, index=True, nullable=False)
    event_type = Column(String, index=True)
    content = Column(JSON)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    model = Column(String, nullable=True)
    provider = Column(String, nullable=True)
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    cache_read_tokens = Column(Integer, default=0)
    cache_write_tokens = Column(Integer, default=0)
    cost_usd = Column(Float, default=0.0)
    duration_ms = Column(Integer, default=0)
    tool_name = Column(String, nullable=True)
    channel = Column(String, nullable=True)

class WorkspaceEvent(Base):
    __tablename__ = "workspace_events"

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String, index=True, nullable=False)
    event_type = Column(String, nullable=False)
    agent_name = Column(String, default="main")
    files = Column(JSON, default=list)
    soul_exists = Column(Boolean, default=False)
    agents_exists = Column(Boolean, default=False)
    memory_exists = Column(Boolean, default=False)
    state_exists = Column(Boolean, default=False)
    soul_content = Column(String, nullable=True)
    agents_content = Column(String, nullable=True)
    state_content = Column(String, nullable=True)
    heartbeat_ms_ago = Column(Integer, default=0)
    daily_notes_count = Column(Integer, default=0)
    timestamp = Column(DateTime(timezone=True), nullable=False)

class CronEvent(Base):
    __tablename__ = "cron_events"

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String, index=True, nullable=False)
    event_type = Column(String, nullable=False)
    jobs = Column(JSON, default=list)
    timestamp = Column(DateTime(timezone=True), nullable=False)

class SessionsEvent(Base):
    __tablename__ = "sessions_events"

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String, index=True, nullable=False)
    event_type = Column(String, nullable=False)
    sessions = Column(JSON, default=list)
    session_count = Column(Integer, default=0)
    active_count = Column(Integer, default=0)
    history_count = Column(Integer, default=0)
    timestamp = Column(DateTime(timezone=True), nullable=False)

class GatewayLogEvent(Base):
    __tablename__ = "gateway_log_events"

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String, index=True, nullable=False)
    event_type = Column(String, nullable=False)
    log_path = Column(String, nullable=True)
    lines = Column(JSON, default=list)
    timestamp = Column(DateTime(timezone=True), nullable=False)

class HealthHistoryEvent(Base):
    __tablename__ = "health_history_events"

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String, index=True, nullable=False)
    event_type = Column(String, nullable=False)
    snapshots = Column(JSON, default=list)
    count = Column(Integer, default=0)
    timestamp = Column(DateTime(timezone=True), nullable=False)
