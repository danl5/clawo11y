package api

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/danl5/clawo11y/services/server/database"
	"github.com/danl5/clawo11y/services/server/models"
)

func GetSessionTimeline(c *gin.Context) {
	sessionID := c.Param("session_id")
	var events []models.AgentEvent

	if err := database.DB.Where("session_id = ?", sessionID).Order("id asc").Find(&events).Error; err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}

	resp := make([]gin.H, 0, len(events))
	for _, e := range events {
		var contentData map[string]interface{}
		json.Unmarshal(e.Content, &contentData)

		resp = append(resp, gin.H{
			"id":                 e.ID,
			"event_type":         e.EventType,
			"model":              e.Model,
			"provider":           e.Provider,
			"input_tokens":       e.InputTokens,
			"output_tokens":      e.OutputTokens,
			"cache_read_tokens":  e.CacheReadTokens,
			"cache_write_tokens": e.CacheWriteTokens,
			"cost_usd":           e.CostUSD,
			"duration_ms":        e.DurationMs,
			"tool_name":          e.ToolName,
			"content":            contentData,
			"timestamp":          e.Timestamp.Format(time.RFC3339Nano),
		})
	}
	c.JSON(200, resp)
}

func ListSessions(c *gin.Context) {
	type Result struct {
		SessionID     string         `json:"session_id"`
		EventCount    int            `json:"event_count"`
		LastEventAt   sql.NullString `json:"last_event_at"`
		Model         string         `json:"model"`
		LastEventType string         `json:"last_event_type"`
	}

	var results []Result

	err := database.DB.Table("agent_events").
		Select("session_id, count(id) as event_count, max(timestamp) as last_event_at, max(model) as model, max(event_type) as last_event_type").
		Group("session_id").
		Order("last_event_at desc").
		Limit(100).
		Scan(&results).Error

	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}

	resp := make([]gin.H, 0, len(results))
	for _, r := range results {
		lastEventAt := r.LastEventAt.String
		if parsed, err := parseAggregateTimestamp(lastEventAt); err == nil {
			lastEventAt = parsed.Format(time.RFC3339Nano)
		}
		resp = append(resp, gin.H{
			"session_id":      r.SessionID,
			"event_count":     r.EventCount,
			"last_event_at":   lastEventAt,
			"model":           r.Model,
			"last_event_type": r.LastEventType,
		})
	}
	c.JSON(200, resp)
}

func parseAggregateTimestamp(value string) (time.Time, error) {
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05-07:00",
		"2006-01-02 15:04:05",
	}
	var lastErr error
	for _, layout := range layouts {
		if ts, err := time.Parse(layout, value); err == nil {
			return ts, nil
		} else {
			lastErr = err
		}
	}
	return time.Time{}, lastErr
}
