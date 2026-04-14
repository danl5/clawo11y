package models

import (
	"time"

	"gorm.io/datatypes"
)

type Node struct {
	ID              uint   `gorm:"primaryKey"`
	NodeID          string `gorm:"uniqueIndex;not null"`
	OSName          string
	IPAddress       string
	OpenClawVersion string
	Hostname        string
	CreatedAt       time.Time `gorm:"autoCreateTime"`
	LastSeenAt      time.Time `gorm:"autoUpdateTime"`
}

type SystemMetric struct {
	ID              uint   `gorm:"primaryKey"`
	NodeID          string `gorm:"index;not null"`
	CPUPercent      float64
	CPUCount        int     `gorm:"default:0"`
	LoadAvg1m       float64 `gorm:"default:0.0"`
	LoadAvg5m       float64 `gorm:"default:0.0"`
	LoadAvg15m      float64 `gorm:"default:0.0"`
	RAMUsedMB       float64
	RAMTotalMB      float64
	RAMPercent      float64 `gorm:"default:0.0"`
	SwapUsedMB      float64 `gorm:"default:0.0"`
	SwapTotalMB     float64 `gorm:"default:0.0"`
	DiskUsedPercent float64
	DiskTotalGB     float64   `gorm:"default:0.0"`
	UptimeSeconds   int       `gorm:"default:0"`
	BootTimeSeconds int       `gorm:"default:0"`
	NetTxBytes      int64     `gorm:"default:0"`
	NetRxBytes      int64     `gorm:"default:0"`
	Timestamp       time.Time `gorm:"not null"`
}

type AgentEvent struct {
	ID               uint   `gorm:"primaryKey"`
	NodeID           string `gorm:"index;not null"`
	SessionID        string `gorm:"index;not null"`
	EventType        string `gorm:"index"`
	Content          datatypes.JSON
	Timestamp        time.Time `gorm:"not null"`
	Model            string
	Provider         string
	InputTokens      int     `gorm:"default:0"`
	OutputTokens     int     `gorm:"default:0"`
	CacheReadTokens  int     `gorm:"default:0"`
	CacheWriteTokens int     `gorm:"default:0"`
	CostUSD          float64 `gorm:"default:0.0"`
	DurationMs       int     `gorm:"default:0"`
	ToolName         string
	Channel          string
}

type WorkspaceEvent struct {
	ID              uint           `gorm:"primaryKey"`
	NodeID          string         `gorm:"index;not null"`
	EventType       string         `gorm:"not null"`
	AgentName       string         `gorm:"default:'main'"`
	Files           datatypes.JSON `gorm:"default:'[]'"`
	SoulExists      bool           `gorm:"default:false"`
	AgentsExists    bool           `gorm:"default:false"`
	MemoryExists    bool           `gorm:"default:false"`
	StateExists     bool           `gorm:"default:false"`
	SoulContent     string
	AgentsContent   string
	StateContent    string
	HeartbeatMsAgo  int       `gorm:"default:0"`
	DailyNotesCount int       `gorm:"default:0"`
	Timestamp       time.Time `gorm:"not null"`
}

type CronEvent struct {
	ID        uint           `gorm:"primaryKey"`
	NodeID    string         `gorm:"index;not null"`
	EventType string         `gorm:"not null"`
	Jobs      datatypes.JSON `gorm:"default:'[]'"`
	Timestamp time.Time      `gorm:"not null"`
}

type SessionsEvent struct {
	ID           uint           `gorm:"primaryKey"`
	NodeID       string         `gorm:"index;not null"`
	EventType    string         `gorm:"not null"`
	Sessions     datatypes.JSON `gorm:"default:'[]'"`
	SessionCount int            `gorm:"default:0"`
	ActiveCount  int            `gorm:"default:0"`
	HistoryCount int            `gorm:"default:0"`
	Timestamp    time.Time      `gorm:"not null"`
}

type GatewayLogEvent struct {
	ID        uint   `gorm:"primaryKey"`
	NodeID    string `gorm:"index;not null"`
	EventType string `gorm:"not null"`
	LogPath   string
	Lines     datatypes.JSON `gorm:"default:'[]'"`
	Timestamp time.Time      `gorm:"not null"`
}

type HealthHistoryEvent struct {
	ID        uint           `gorm:"primaryKey"`
	NodeID    string         `gorm:"index;not null"`
	EventType string         `gorm:"not null"`
	Snapshots datatypes.JSON `gorm:"default:'[]'"`
	Count     int            `gorm:"default:0"`
	Timestamp time.Time      `gorm:"not null"`
}

// OtelSpan represents a flattened OpenTelemetry Span specifically tailored for OpenClaw observability
type OtelSpan struct {
	ID            uint   `gorm:"primaryKey"`
	TraceID       string `gorm:"index;not null;size:64"`
	SpanID        string `gorm:"uniqueIndex;not null;size:64"`
	ParentSpanID  string `gorm:"index;size:64"`
	Name          string `gorm:"index"`
	Kind          int    `gorm:"default:0"`
	StartTimeUnix int64  `gorm:"index"` // Unix nanoseconds
	EndTimeUnix   int64
	DurationNs    int64
	StatusCode    int `gorm:"default:0"`
	StatusMessage string

	// Materialized columns from OpenClaw specific attributes
	Model            string  `gorm:"index"`
	Provider         string  `gorm:"index"`
	ToolName         string  `gorm:"index"`
	PromptTokens     int     `gorm:"default:0"`
	CompletionTokens int     `gorm:"default:0"`
	TotalTokens      int     `gorm:"default:0"`
	CostUsd          float64 `gorm:"default:0.0"`

	// Raw attributes as JSON fallback
	Attributes    datatypes.JSON
	ResourceAttrs datatypes.JSON

	CreatedAt time.Time `gorm:"autoCreateTime"`
}

// OtelMetric represents an OpenTelemetry Metric
type OtelMetric struct {
	ID            uint   `gorm:"primaryKey"`
	Name          string `gorm:"index;not null"`
	Description   string
	Unit          string
	Type          string         `gorm:"index"` // Gauge, Sum, Histogram, Summary
	DataPoints    datatypes.JSON // Store actual values and timestamps as JSON
	ResourceAttrs datatypes.JSON
	CreatedAt     time.Time `gorm:"autoCreateTime"`
}

// OtelLog represents an OpenTelemetry Log Record
type OtelLog struct {
	ID             uint   `gorm:"primaryKey"`
	TraceID        string `gorm:"index;size:64"`
	SpanID         string `gorm:"index;size:64"`
	TimestampUnix  int64  `gorm:"index"`
	SeverityText   string `gorm:"index"`
	SeverityNumber int    `gorm:"default:0"`
	Body           string
	Attributes     datatypes.JSON
	ResourceAttrs  datatypes.JSON
	CreatedAt      time.Time `gorm:"autoCreateTime"`
}
