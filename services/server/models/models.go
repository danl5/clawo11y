package models

import (
	"time"

	"gorm.io/datatypes"
)

type Node struct {
	ID              uint      `gorm:"primaryKey"`
	NodeID          string    `gorm:"uniqueIndex;not null"`
	OSName          string
	IPAddress       string
	OpenClawVersion string
	Hostname        string
	CreatedAt       time.Time `gorm:"autoCreateTime"`
	LastSeenAt      time.Time `gorm:"autoUpdateTime"`
}

type SystemMetric struct {
	ID              uint      `gorm:"primaryKey"`
	NodeID          string    `gorm:"index;not null"`
	CPUPercent      float64
	CPUCount        int       `gorm:"default:0"`
	LoadAvg1m       float64   `gorm:"default:0.0"`
	LoadAvg5m       float64   `gorm:"default:0.0"`
	LoadAvg15m      float64   `gorm:"default:0.0"`
	RAMUsedMB       float64
	RAMTotalMB      float64
	RAMPercent      float64   `gorm:"default:0.0"`
	SwapUsedMB      float64   `gorm:"default:0.0"`
	SwapTotalMB     float64   `gorm:"default:0.0"`
	DiskUsedPercent float64
	DiskTotalGB     float64   `gorm:"default:0.0"`
	UptimeSeconds   int       `gorm:"default:0"`
	BootTimeSeconds int       `gorm:"default:0"`
	NetTxBytes      int64     `gorm:"default:0"`
	NetRxBytes      int64     `gorm:"default:0"`
	Timestamp       time.Time `gorm:"not null"`
}

type AgentEvent struct {
	ID               uint           `gorm:"primaryKey"`
	NodeID           string         `gorm:"index;not null"`
	SessionID        string         `gorm:"index;not null"`
	EventType        string         `gorm:"index"`
	Content          datatypes.JSON
	Timestamp        time.Time      `gorm:"not null"`
	Model            string
	Provider         string
	InputTokens      int            `gorm:"default:0"`
	OutputTokens     int            `gorm:"default:0"`
	CacheReadTokens  int            `gorm:"default:0"`
	CacheWriteTokens int            `gorm:"default:0"`
	CostUSD          float64        `gorm:"default:0.0"`
	DurationMs       int            `gorm:"default:0"`
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
	HeartbeatMsAgo  int            `gorm:"default:0"`
	DailyNotesCount int            `gorm:"default:0"`
	Timestamp       time.Time      `gorm:"not null"`
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
	ID        uint           `gorm:"primaryKey"`
	NodeID    string         `gorm:"index;not null"`
	EventType string         `gorm:"not null"`
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
