package api

import (
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"

	"github.com/danl5/clawo11y/services/server/models"
	"github.com/danl5/clawo11y/services/server/schemas"
	ws "github.com/danl5/clawo11y/services/server/websocket"
)

func ReportSystemMetrics(c *gin.Context) {
	var payload schemas.SystemMetricsPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(400, gin.H{"detail": err.Error()})
		return
	}

	dbEvent := &models.SystemMetric{
		NodeID:          payload.NodeID,
		CPUPercent:      payload.CPUPercent,
		CPUCount:        payload.CPUCount,
		LoadAvg1m:       payload.LoadAvg1m,
		LoadAvg5m:       payload.LoadAvg5m,
		LoadAvg15m:      payload.LoadAvg15m,
		RAMUsedMB:       payload.RAMUsedMB,
		RAMTotalMB:      payload.RAMTotalMB,
		RAMPercent:      payload.RAMPercent,
		SwapUsedMB:      payload.SwapUsedMB,
		SwapTotalMB:     payload.SwapTotalMB,
		DiskUsedPercent: payload.DiskUsedPercent,
		DiskTotalGB:     payload.DiskTotalGB,
		UptimeSeconds:   payload.UptimeSeconds,
		BootTimeSeconds: payload.BootTimeSeconds,
		NetTxBytes:      payload.NetTxBytes,
		NetRxBytes:      payload.NetRxBytes,
		Timestamp:       payload.Timestamp,
	}

	select {
	case MetricsQueue <- dbEvent:
	default:
	}

	wsMsg, _ := json.Marshal(gin.H{
		"type":              "system_metrics",
		"node_id":           payload.NodeID,
		"cpu_percent":       payload.CPUPercent,
		"ram_used_mb":       payload.RAMUsedMB,
		"ram_percent":       payload.RAMPercent,
		"disk_used_percent": payload.DiskUsedPercent,
		"uptime_seconds":    payload.UptimeSeconds,
		"timestamp":         payload.Timestamp.Format(time.RFC3339Nano),
	})
	ws.Manager.BroadcastRaw(wsMsg)

	c.JSON(201, gin.H{"message": "Metrics received"})
}

func ReportGatewayLogEvent(c *gin.Context) {
	var payload schemas.GatewayLogEventPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(400, gin.H{"detail": err.Error()})
		return
	}

	linesJSON, err := json.Marshal(payload.Lines)
	if err != nil {
		c.JSON(400, gin.H{"detail": "invalid lines format"})
		return
	}

	dbEvent := &models.GatewayLogEvent{
		NodeID:    payload.NodeID,
		EventType: payload.Type,
		LogPath:   payload.LogPath,
		Lines:     datatypes.JSON(linesJSON),
		Timestamp: payload.Timestamp,
	}

	select {
	case GatewayLogQueue <- dbEvent:
	default:
	}

	wsMsg, _ := json.Marshal(gin.H{
		"type":       "gateway_log_event",
		"node_id":    payload.NodeID,
		"event_type": payload.Type,
		"log_path":   payload.LogPath,
		"lines":      payload.Lines,
		"timestamp":  payload.Timestamp.Format(time.RFC3339Nano),
	})
	ws.Manager.BroadcastRaw(wsMsg)

	c.JSON(201, gin.H{"message": "Gateway log event received"})
}

func ReportWorkspaceEvent(c *gin.Context) {
	var payload schemas.WorkspaceEventPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(400, gin.H{"detail": err.Error()})
		return
	}

	filesJSON, _ := json.Marshal(payload.Files)

	dbEvent := &models.WorkspaceEvent{
		NodeID:    payload.NodeID,
		EventType: payload.Type,
		Files:     datatypes.JSON(filesJSON),
		Timestamp: payload.Timestamp,
	}

	if payload.Summary != nil {
		dbEvent.AgentName = payload.Summary.AgentName
		dbEvent.SoulExists = payload.Summary.SoulExists
		dbEvent.AgentsExists = payload.Summary.AgentsExists
		dbEvent.MemoryExists = payload.Summary.MemoryExists
		dbEvent.StateExists = payload.Summary.StateExists
		if payload.Summary.SoulContent != nil {
			dbEvent.SoulContent = *payload.Summary.SoulContent
		}
		if payload.Summary.AgentsContent != nil {
			dbEvent.AgentsContent = *payload.Summary.AgentsContent
		}
		if payload.Summary.StateContent != nil {
			dbEvent.StateContent = *payload.Summary.StateContent
		}
		dbEvent.HeartbeatMsAgo = payload.Summary.HeartbeatMsAgo
		dbEvent.DailyNotesCount = payload.Summary.DailyNotesCount
	}

	select {
	case WorkspaceQueue <- dbEvent:
	default:
	}

	wsMsg, _ := json.Marshal(gin.H{
		"type":      "workspace_event",
		"node_id":   payload.NodeID,
		"summary":   payload.Summary,
		"files":     payload.Files,
		"timestamp": payload.Timestamp.Format(time.RFC3339Nano),
	})
	ws.Manager.BroadcastRaw(wsMsg)

	c.JSON(201, gin.H{"message": "Workspace event received"})
}

func ReportCronEvent(c *gin.Context) {
	var payload schemas.CronEventPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(400, gin.H{"detail": err.Error()})
		return
	}

	jobsJSON, _ := json.Marshal(payload.Jobs)

	dbEvent := &models.CronEvent{
		NodeID:    payload.NodeID,
		EventType: payload.Type,
		Jobs:      datatypes.JSON(jobsJSON),
		Timestamp: payload.Timestamp,
	}

	select {
	case CronQueue <- dbEvent:
	default:
	}

	wsMsg, _ := json.Marshal(gin.H{
		"type":      "cron_event",
		"node_id":   payload.NodeID,
		"jobs":      payload.Jobs,
		"timestamp": payload.Timestamp.Format(time.RFC3339Nano),
	})
	ws.Manager.BroadcastRaw(wsMsg)

	c.JSON(201, gin.H{"message": "Cron event received"})
}

func ReportSessionsEvent(c *gin.Context) {
	var payload schemas.SessionsEventPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(400, gin.H{"detail": err.Error()})
		return
	}

	sessionsJSON, _ := json.Marshal(payload.Sessions)

	dbEvent := &models.SessionsEvent{
		NodeID:       payload.NodeID,
		EventType:    payload.Type,
		Sessions:     datatypes.JSON(sessionsJSON),
		SessionCount: payload.SessionCount,
		ActiveCount:  payload.ActiveCount,
		HistoryCount: payload.HistoryCount,
		Timestamp:    payload.Timestamp,
	}

	select {
	case SessionsQueue <- dbEvent:
	default:
	}

	wsMsgSess, _ := json.Marshal(gin.H{
		"type":          "sessions_event",
		"node_id":       payload.NodeID,
		"session_count": payload.SessionCount,
		"sessions":      payload.Sessions,
		"timestamp":     payload.Timestamp.Format(time.RFC3339Nano),
	})
	ws.Manager.BroadcastRaw(wsMsgSess)

	c.JSON(201, gin.H{"message": "Sessions event received"})
}

func ReportHealthHistoryEvent(c *gin.Context) {
	var payload schemas.HealthHistoryEventPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(400, gin.H{"detail": err.Error()})
		return
	}

	snapshotsJSON, _ := json.Marshal(payload.Snapshots)

	dbEvent := &models.HealthHistoryEvent{
		NodeID:    payload.NodeID,
		EventType: payload.Type,
		Snapshots: datatypes.JSON(snapshotsJSON),
		Count:     payload.Count,
		Timestamp: payload.Timestamp,
	}

	select {
	case HealthQueue <- dbEvent:
	default:
	}

	wsMsgHealth, _ := json.Marshal(gin.H{
		"type":      "health_history_event",
		"node_id":   payload.NodeID,
		"count":     payload.Count,
		"snapshots": payload.Snapshots,
		"timestamp": payload.Timestamp.Format(time.RFC3339Nano),
	})
	ws.Manager.BroadcastRaw(wsMsgHealth)

	c.JSON(201, gin.H{"message": "Health history event received"})
}
