package schemas

import (
	"time"

	"gorm.io/datatypes"
)

type NodeInfo struct {
	NodeID          string  `json:"node_id"`
	OSName          string  `json:"os_name"`
	IPAddress       string  `json:"ip_address"`
	OpenClawVersion *string `json:"openclaw_version,omitempty"`
	Hostname        *string `json:"hostname,omitempty"`
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
	UptimeSeconds   int       `json:"uptime_seconds"`
	BootTimeSeconds int       `json:"boot_time_seconds"`
	NetTxBytes      int64     `json:"net_tx_bytes"`
	NetRxBytes      int64     `json:"net_rx_bytes"`
	Timestamp       time.Time `json:"timestamp"`
}

type AgentEventPayload struct {
	NodeID           string         `json:"node_id"`
	SessionID        string         `json:"session_id"`
	EventType        string         `json:"event_type"`
	Content          datatypes.JSON `json:"content"`
	Timestamp        time.Time      `json:"timestamp"`
	Model            *string        `json:"model,omitempty"`
	Provider         *string        `json:"provider,omitempty"`
	InputTokens      int            `json:"input_tokens"`
	OutputTokens     int            `json:"output_tokens"`
	CacheReadTokens  int            `json:"cache_read_tokens"`
	CacheWriteTokens int            `json:"cache_write_tokens"`
	CostUSD          float64        `json:"cost_usd"`
	DurationMs       int            `json:"duration_ms"`
	ToolName         *string        `json:"tool_name,omitempty"`
	Channel          *string        `json:"channel,omitempty"`
}

type WorkspaceFilePayload struct {
	Path     string  `json:"path"`
	Filename string  `json:"filename"`
	Type     string  `json:"type"`
	Content  *string `json:"content,omitempty"`
}

type WorkspaceSummary struct {
	AgentName       string  `json:"agent_name"`
	SoulExists      bool    `json:"soul_exists"`
	AgentsExists    bool    `json:"agents_exists"`
	MemoryExists    bool    `json:"memory_exists"`
	StateExists     bool    `json:"state_exists"`
	SoulContent     *string `json:"soul_content,omitempty"`
	AgentsContent   *string `json:"agents_content,omitempty"`
	StateContent    *string `json:"state_content,omitempty"`
	HeartbeatMsAgo  int     `json:"heartbeat_ms_ago"`
	DailyNotesCount int     `json:"daily_notes_count"`
}

type WorkspaceEventPayload struct {
	NodeID    string                 `json:"node_id"`
	Type      string                 `json:"type"`
	Files     []WorkspaceFilePayload `json:"files"`
	Summary   *WorkspaceSummary      `json:"summary,omitempty"`
	Timestamp time.Time              `json:"timestamp"`
}

type CronRunRecord struct {
	Ts         int     `json:"ts"`
	Status     string  `json:"status"`
	Summary    *string `json:"summary,omitempty"`
	Error      *string `json:"error,omitempty"`
	SessionId  *string `json:"sessionId,omitempty"`
	DurationMs *int    `json:"durationMs,omitempty"`
}

type CronJob struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Schedule    interface{}     `json:"schedule"`
	Enabled     bool            `json:"enabled"`
	Payload     interface{}     `json:"payload,omitempty"`
	LastRunMs   int             `json:"last_run_ms"`
	NextRunMs   int             `json:"next_run_ms"`
	RunCount    int             `json:"run_count"`
	ErrorCount  int             `json:"error_count"`
	RecentRuns  []CronRunRecord `json:"recent_runs,omitempty"`
}

type CronEventPayload struct {
	NodeID    string    `json:"node_id"`
	Type      string    `json:"type"`
	Jobs      []CronJob `json:"jobs"`
	Timestamp time.Time `json:"timestamp"`
}

type SessionEntry struct {
	SessionId    string  `json:"sessionId"`
	Key          string  `json:"key"`
	Label        *string `json:"label,omitempty"`
	Model        *string `json:"model,omitempty"`
	Provider     *string `json:"provider,omitempty"`
	Status       *string `json:"status,omitempty"`
	CreatedAtMs  int     `json:"created_at_ms"`
	LastActiveMs int     `json:"last_active_ms"`
	TokenCount   int     `json:"token_count"`
	CostUsd      float64 `json:"cost_usd"`
	AgentName    *string `json:"agent_name,omitempty"`
	Channel      *string `json:"channel,omitempty"`
	IsHistory    bool    `json:"is_history"`
}

type SessionsEventPayload struct {
	NodeID       string         `json:"node_id"`
	Type         string         `json:"type"`
	Sessions     []SessionEntry `json:"sessions"`
	SessionCount int            `json:"session_count"`
	ActiveCount  int            `json:"active_count"`
	HistoryCount int            `json:"history_count"`
	Timestamp    time.Time      `json:"timestamp"`
}

type GatewayLogEventPayload struct {
	NodeID    string                   `json:"node_id"`
	Type      string                   `json:"type"`
	LogPath   string                   `json:"log_path"`
	Lines     []map[string]interface{} `json:"lines"`
	Timestamp time.Time                `json:"timestamp"`
}

type HealthSnapshot struct {
	Timestamp   int      `json:"timestamp"`
	CPUPercent  float64  `json:"cpu_percent"`
	RAMPercent  float64  `json:"ram_percent"`
	DiskPercent float64  `json:"disk_percent"`
	TempCPU     *float64 `json:"temp_cpu,omitempty"`
}

type HealthHistoryEventPayload struct {
	NodeID    string           `json:"node_id"`
	Type      string           `json:"type"`
	Snapshots []HealthSnapshot `json:"snapshots"`
	Count     int              `json:"count"`
	Timestamp time.Time        `json:"timestamp"`
}
