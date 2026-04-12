package schemas

import "time"

type NodeInfo struct {
	NodeID          string `json:"node_id"`
	OSName          string `json:"os_name"`
	IPAddress       string `json:"ip_address"`
	OpenClawVersion string `json:"openclaw_version"`
	Hostname        string `json:"hostname"`
}

type SystemMetricsPayload struct {
	NodeID          string    `json:"node_id"`
	CPUPercent      float64   `json:"cpu_percent"`
	CPUCount        int       `json:"cpu_count"`
	LoadAvg1m       float64   `json:"load_avg_1m"`
	LoadAvg5m       float64   `json:"load_avg_5m"`
	LoadAvg15m      float64   `json:"load_avg_15m"`
	RAMUsedMB       float64   `json:"ram_used_mb"`
	RAMTotalMB      float64   `json:"ram_total_mb"`
	RAMPercent      float64   `json:"ram_percent"`
	SwapUsedMB      float64   `json:"swap_used_mb"`
	SwapTotalMB     float64   `json:"swap_total_mb"`
	DiskUsedPercent float64   `json:"disk_used_percent"`
	DiskTotalGB     float64   `json:"disk_total_gb"`
	UptimeSeconds   int64     `json:"uptime_seconds"`
	BootTimeSeconds int64     `json:"boot_time_seconds"`
	NetTxBytes      uint64    `json:"net_tx_bytes"`
	NetRxBytes      uint64    `json:"net_rx_bytes"`
	Timestamp       time.Time `json:"timestamp"`
}

type AgentEventPayload struct {
	NodeID       string                 `json:"node_id"`
	SessionID    string                 `json:"session_id"`
	EventType    string                 `json:"event_type"`
	Content      map[string]interface{} `json:"content"`
	Timestamp    time.Time              `json:"timestamp"`
	Model        string                 `json:"model,omitempty"`
	Provider     string                 `json:"provider,omitempty"`
	InputTokens  int                    `json:"input_tokens,omitempty"`
	OutputTokens int                    `json:"output_tokens,omitempty"`
	CacheRead    int                    `json:"cache_read_tokens,omitempty"`
	CacheWrite   int                    `json:"cache_write_tokens,omitempty"`
	CostUSD      float64                `json:"cost_usd,omitempty"`
	DurationMs   int64                  `json:"duration_ms,omitempty"`
	ToolName     string                 `json:"tool_name,omitempty"`
	Channel      string                 `json:"channel,omitempty"`
}

type WorkspaceEventPayload struct {
	NodeID    string                 `json:"node_id"`
	Type      string                 `json:"type"`
	Files     []WorkspaceFilePayload `json:"files,omitempty"`
	Summary   *WorkspaceSummary      `json:"summary,omitempty"`
	Timestamp time.Time              `json:"timestamp"`
}

type WorkspaceFilePayload struct {
	Path     string `json:"path"`
	Filename string `json:"filename"`
	Type     string `json:"type"`
	Content  string `json:"content,omitempty"`
}

type WorkspaceSummary struct {
	AgentName     string `json:"agent_name"`
	SoulExists    bool   `json:"soul_exists"`
	AgentsExists  bool   `json:"agents_exists"`
	MemoryExists  bool   `json:"memory_exists"`
	StateExists   bool   `json:"state_exists"`
	SoulContent   string `json:"soul_content,omitempty"`
	AgentsContent string `json:"agents_content,omitempty"`
	StateContent  string `json:"state_content,omitempty"`
	HeartbeatMs   int64  `json:"heartbeat_ms_ago"`
	DailyNotes    int    `json:"daily_notes_count"`
}

type CronEventPayload struct {
	NodeID    string    `json:"node_id"`
	Type      string    `json:"type"`
	Jobs      []CronJob `json:"jobs,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

type CronRunRecord struct {
	Timestamp int64  `json:"ts"`
	Status    string `json:"status"`
	Summary   string `json:"summary,omitempty"`
	Error     string `json:"error,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
	Duration  int64  `json:"durationMs,omitempty"`
}

type CronJob struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	Schedule   interface{}     `json:"schedule"`
	Enabled    bool            `json:"enabled"`
	Payload    interface{}     `json:"payload,omitempty"`
	LastRunMs  int64           `json:"last_run_ms"`
	NextRunMs  int64           `json:"next_run_ms"`
	RunCount   int             `json:"run_count"`
	ErrorCount int             `json:"error_count"`
	RecentRuns []CronRunRecord `json:"recent_runs,omitempty"`
}

type SessionsEventPayload struct {
	NodeID       string         `json:"node_id"`
	Type         string         `json:"type"`
	Sessions     []SessionEntry `json:"sessions,omitempty"`
	SessionCount int            `json:"session_count"`
	ActiveCount  int            `json:"active_count"`
	Timestamp    time.Time      `json:"timestamp"`
}

type SessionEntry struct {
	SessionID    string  `json:"sessionId"`
	Key          string  `json:"key"`
	Label        string  `json:"label,omitempty"`
	Model        string  `json:"model,omitempty"`
	Provider     string  `json:"provider,omitempty"`
	Status       string  `json:"status,omitempty"`
	CreatedAtMs  int64   `json:"created_at_ms,omitempty"`
	LastActiveMs int64   `json:"last_active_ms,omitempty"`
	TokenCount   int     `json:"token_count,omitempty"`
	CostUSD      float64 `json:"cost_usd,omitempty"`
	AgentName    string  `json:"agent_name,omitempty"`
	Channel      string  `json:"channel,omitempty"`
}

type GatewayLogEventPayload struct {
	NodeID    string                   `json:"node_id"`
	Type      string                   `json:"type"`
	LogPath   string                   `json:"log_path"`
	Lines     []map[string]interface{} `json:"lines,omitempty"`
	Timestamp time.Time                `json:"timestamp"`
}

type HealthHistoryEventPayload struct {
	NodeID    string           `json:"node_id"`
	Type      string           `json:"type"`
	Snapshots []HealthSnapshot `json:"snapshots"`
	Count     int              `json:"count"`
	Timestamp time.Time        `json:"timestamp"`
}

type HealthSnapshot struct {
	Timestamp int64   `json:"timestamp"`
	CPU       float64 `json:"cpu_percent"`
	RAM       float64 `json:"ram_percent"`
	Disk      float64 `json:"disk_percent"`
	TempCPU   float64 `json:"temp_cpu,omitempty"`
}
