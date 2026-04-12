export interface WsMessage {
  type: string;
  node_id: string;
  timestamp: string;
  cpu_percent?: number;
  cpu_count?: number;
  load_avg_1m?: number;
  ram_used_mb?: number;
  ram_total_mb?: number;
  ram_percent?: number;
  disk_used_percent?: number;
  uptime_seconds?: number;
  session_id?: string;
  event_type?: string;
  model?: string;
  provider?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cost_usd?: number;
  duration_ms?: number;
  tool_name?: string;
  content?: Record<string, unknown>;
  session_count?: number;
  active_count?: number;
  count?: number;
  log_path?: string;
  lines?: any[];
  level?: string;
  jobs?: Array<{
    id: string;
    name: string;
    schedule: string;
    enabled: boolean;
    last_run_ms?: number;
    next_run_ms?: number;
    run_count?: number;
    error_count?: number;
  }>;
  files?: Array<{
    path: string;
    filename: string;
    type: string;
    content?: string;
  }>;
  snapshots?: Array<{
    timestamp: number;
    cpu_percent: number;
    ram_percent: number;
    disk_percent: number;
  }>;
  sessions?: Array<{
    sessionId: string;
    key: string;
    label?: string;
    model?: string;
    provider?: string;
    status?: string;
    agent_name?: string;
    channel?: string;
    is_history?: boolean;
    last_active_ms?: number;
    created_at_ms?: number;
  }>;
  summary?: {
    agent_name?: string;
    soul_exists?: boolean;
    agents_exists?: boolean;
    memory_exists?: boolean;
    state_exists?: boolean;
    soul_content?: string;
    agents_content?: string;
    state_content?: string;
    heartbeat_ms_ago?: number;
    daily_notes_count?: number;
  };
}

export interface TimelineEvent {
  id: number | string;
  event_type: string;
  model?: string;
  provider?: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  duration_ms: number;
  tool_name?: string;
  content?: Record<string, unknown>;
  timestamp?: string;
}

export interface SessionSummary {
  session_id: string;
  event_count: number;
  last_event_at?: string;
  model?: string;
  last_event_type?: string;
  agent_name?: string;
}
