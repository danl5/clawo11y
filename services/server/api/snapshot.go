package api

import (
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/danl5/clawo11y/services/server/database"
	"github.com/danl5/clawo11y/services/server/models"
)

func GetSnapshot(c *gin.Context) {
	var metric models.SystemMetric
	var sessions models.SessionsEvent
	var cron models.CronEvent

	database.DB.Order("id desc").First(&metric)
	database.DB.Order("id desc").First(&sessions)
	database.DB.Order("id desc").First(&cron)

	var workspaceEvents []models.WorkspaceEvent
	database.DB.Order("id desc").Limit(50).Find(&workspaceEvents)

	var agentEvents []models.AgentEvent
	database.DB.Order("id desc").Limit(1000).Find(&agentEvents)

	var gatewayLogs []models.GatewayLogEvent
	database.DB.Order("id desc").Limit(50).Find(&gatewayLogs)

	var events []gin.H

	if metric.ID != 0 {
		events = append(events, gin.H{
			"type":              "system_metrics",
			"node_id":           metric.NodeID,
			"cpu_percent":       metric.CPUPercent,
			"ram_used_mb":       metric.RAMUsedMB,
			"ram_percent":       metric.RAMPercent,
			"disk_used_percent": metric.DiskUsedPercent,
			"uptime_seconds":    metric.UptimeSeconds,
			"timestamp":         metric.Timestamp.Format(time.RFC3339Nano),
		})
	}

	if sessions.ID != 0 {
		var sessData []interface{}
		json.Unmarshal(sessions.Sessions, &sessData)
		events = append(events, gin.H{
			"type":          "sessions_event",
			"node_id":       sessions.NodeID,
			"session_count": sessions.SessionCount,
			"sessions":      sessData,
			"timestamp":     sessions.Timestamp.Format(time.RFC3339Nano),
		})
	}

	seenWsAgents := make(map[string]bool)
	for _, w := range workspaceEvents {
		agent := w.AgentName
		if agent == "" {
			agent = "main"
		}
		if !seenWsAgents[agent] {
			seenWsAgents[agent] = true

			var filesData []interface{}
			json.Unmarshal(w.Files, &filesData)

			events = append(events, gin.H{
				"type":    "workspace_event",
				"node_id": w.NodeID,
				"summary": gin.H{
					"agent_name":        agent,
					"soul_exists":       w.SoulExists,
					"agents_exists":     w.AgentsExists,
					"memory_exists":     w.MemoryExists,
					"state_exists":      w.StateExists,
					"soul_content":      w.SoulContent,
					"agents_content":    w.AgentsContent,
					"state_content":     w.StateContent,
					"heartbeat_ms_ago":  w.HeartbeatMsAgo,
					"daily_notes_count": w.DailyNotesCount,
				},
				"files":     filesData,
				"timestamp": w.Timestamp.Format(time.RFC3339Nano),
			})
		}
	}

	if cron.ID != 0 {
		var jobsData []interface{}
		json.Unmarshal(cron.Jobs, &jobsData)
		events = append(events, gin.H{
			"type":      "cron_event",
			"node_id":   cron.NodeID,
			"jobs":      jobsData,
			"timestamp": cron.Timestamp.Format(time.RFC3339Nano),
		})
	}

	// Python code reversed gateway logs and agent events before appending.
	for i := len(gatewayLogs) - 1; i >= 0; i-- {
		g := gatewayLogs[i]
		var linesData []interface{}
		json.Unmarshal(g.Lines, &linesData)
		events = append(events, gin.H{
			"type":       "gateway_log_event",
			"node_id":    g.NodeID,
			"event_type": g.EventType,
			"log_path":   g.LogPath,
			"lines":      linesData,
			"timestamp":  g.Timestamp.Format(time.RFC3339Nano),
		})
	}

	for i := len(agentEvents) - 1; i >= 0; i-- {
		ev := agentEvents[i]
		var contentData map[string]interface{}
		json.Unmarshal(ev.Content, &contentData)
		events = append(events, gin.H{
			"type":               "agent_event",
			"node_id":            ev.NodeID,
			"session_id":         ev.SessionID,
			"event_type":         ev.EventType,
			"model":              ev.Model,
			"provider":           ev.Provider,
			"input_tokens":       ev.InputTokens,
			"output_tokens":      ev.OutputTokens,
			"cache_read_tokens":  ev.CacheReadTokens,
			"cache_write_tokens": ev.CacheWriteTokens,
			"cost_usd":           ev.CostUSD,
			"tool_name":          ev.ToolName,
			"content":            contentData,
			"timestamp":          ev.Timestamp.Format(time.RFC3339Nano),
		})
	}

	if events == nil {
		events = []gin.H{} // return empty array instead of null
	}

	c.JSON(200, gin.H{"messages": events})
}
