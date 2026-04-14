package api

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/danl5/clawo11y/services/server/database"
	"github.com/danl5/clawo11y/services/server/models"
	"github.com/danl5/clawo11y/services/server/schemas"
	ws "github.com/danl5/clawo11y/services/server/websocket"
)

var EventQueue = make(chan *models.AgentEvent, 5000)
var MetricsQueue = make(chan *models.SystemMetric, 1000)
var GatewayLogQueue = make(chan *models.GatewayLogEvent, 5000)
var WorkspaceQueue = make(chan *models.WorkspaceEvent, 1000)
var CronQueue = make(chan *models.CronEvent, 1000)
var SessionsQueue = make(chan *models.SessionsEvent, 1000)
var HealthQueue = make(chan *models.HealthHistoryEvent, 1000)

func StartEventProcessors(ctx context.Context) {
	go processQueue(ctx, EventQueue, 50)
	go processQueue(ctx, MetricsQueue, 50)
	go processQueue(ctx, GatewayLogQueue, 50)
	go processQueue(ctx, WorkspaceQueue, 50)
	go processQueue(ctx, CronQueue, 50)
	go processQueue(ctx, SessionsQueue, 50)
	go processQueue(ctx, HealthQueue, 50)
}

// Generic generic function to process any model slice
func processQueue[T any](ctx context.Context, queue <-chan T, batchSize int) {
	batch := make([]T, 0, batchSize)
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			// Graceful shutdown: flush any remaining items in the batch
			if len(batch) > 0 {
				if err := database.BatchInsert(batch); err != nil {
					log.Printf("Final bulk insert failed on shutdown: %v", err)
				}
			}
			return
		case item := <-queue:
			batch = append(batch, item)
			// Drain the channel up to batchSize
			for len(batch) < batchSize {
				select {
				case nextItem := <-queue:
					batch = append(batch, nextItem)
				default:
					goto ProcessBatch
				}
			}
		ProcessBatch:
			if len(batch) > 0 {
				if err := database.BatchInsert(batch); err != nil {
					log.Printf("Bulk insert failed: %v", err)
				}
				// Clear batch while preserving capacity
				batch = batch[:0]
			}
		case <-ticker.C:
			// Flush if timeout reached and we have some items
			if len(batch) > 0 {
				if err := database.BatchInsert(batch); err != nil {
					log.Printf("Bulk insert failed (timeout): %v", err)
				}
				batch = batch[:0]
			}
		}
	}
}

func ReportAgentEvent(c *gin.Context) {
	var payload schemas.AgentEventPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(400, gin.H{"detail": err.Error()})
		return
	}

	model := ""
	if payload.Model != nil {
		model = *payload.Model
	}
	provider := ""
	if payload.Provider != nil {
		provider = *payload.Provider
	}
	toolName := ""
	if payload.ToolName != nil {
		toolName = *payload.ToolName
	}
	channel := ""
	if payload.Channel != nil {
		channel = *payload.Channel
	}

	dbEvent := &models.AgentEvent{
		NodeID:           payload.NodeID,
		SessionID:        payload.SessionID,
		EventType:        payload.EventType,
		Content:          payload.Content,
		Timestamp:        payload.Timestamp,
		Model:            model,
		Provider:         provider,
		InputTokens:      payload.InputTokens,
		OutputTokens:     payload.OutputTokens,
		CacheReadTokens:  payload.CacheReadTokens,
		CacheWriteTokens: payload.CacheWriteTokens,
		CostUSD:          payload.CostUSD,
		DurationMs:       payload.DurationMs,
		ToolName:         toolName,
		Channel:          channel,
	}

	select {
	case EventQueue <- dbEvent:
	default:
		log.Printf("Warning: EventQueue full, dropping event %s", payload.SessionID)
	}

	// Broadcast
	wsMsg, _ := json.Marshal(gin.H{
		"type":               "agent_event",
		"node_id":            payload.NodeID,
		"session_id":         payload.SessionID,
		"event_type":         payload.EventType,
		"model":              payload.Model,
		"provider":           payload.Provider,
		"input_tokens":       payload.InputTokens,
		"output_tokens":      payload.OutputTokens,
		"cache_read_tokens":  payload.CacheReadTokens,
		"cache_write_tokens": payload.CacheWriteTokens,
		"cost_usd":           payload.CostUSD,
		"duration_ms":        payload.DurationMs,
		"tool_name":          payload.ToolName,
		"content":            payload.Content,
		"timestamp":          payload.Timestamp.Format(time.RFC3339),
	})
	ws.Manager.BroadcastRaw(wsMsg)

	c.JSON(201, gin.H{"message": "Event received"})
}
