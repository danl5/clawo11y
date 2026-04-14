package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/danl5/clawo11y/services/server/database"
	"github.com/danl5/clawo11y/services/server/models"
)

func withEventQueueForTest(t *testing.T, size int, fn func(chan *models.AgentEvent)) {
	t.Helper()
	orig := EventQueue
	ch := make(chan *models.AgentEvent, size)
	EventQueue = ch
	defer func() { EventQueue = orig }()
	fn(ch)
}

func withMetricsQueueForTest(t *testing.T, size int, fn func(chan *models.SystemMetric)) {
	t.Helper()
	orig := MetricsQueue
	ch := make(chan *models.SystemMetric, size)
	MetricsQueue = ch
	defer func() { MetricsQueue = orig }()
	fn(ch)
}

func withWorkspaceQueueForTest(t *testing.T, size int, fn func(chan *models.WorkspaceEvent)) {
	t.Helper()
	orig := WorkspaceQueue
	ch := make(chan *models.WorkspaceEvent, size)
	WorkspaceQueue = ch
	defer func() { WorkspaceQueue = orig }()
	fn(ch)
}

func performJSONPost(t *testing.T, handler gin.HandlerFunc, payload any) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	ctx.Request = req
	handler(ctx)
	return rec
}

func withInMemoryDB(t *testing.T, fn func(*gorm.DB)) {
	t.Helper()
	tmp, err := os.CreateTemp("", "o11y-test-*.db")
	if err != nil {
		t.Fatalf("create temp file for test db: %v", err)
	}
	tmp.Close()
	dsn := "file:" + tmp.Name() + "?_journal_mode=WAL&_synchronous=NORMAL&_busy_timeout=5000"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		os.Remove(tmp.Name())
		t.Fatalf("open test db: %v", err)
	}
	defer func() {
		if underlyingDB, err := db.DB(); err == nil {
			underlyingDB.Close()
		}
		os.Remove(tmp.Name())
	}()
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sql db: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(
		&models.Node{},
		&models.SystemMetric{},
		&models.AgentEvent{},
		&models.WorkspaceEvent{},
		&models.CronEvent{},
		&models.SessionsEvent{},
		&models.GatewayLogEvent{},
		&models.HealthHistoryEvent{},
		&models.OtelSpan{},
		&models.OtelMetric{},
		&models.OtelLog{},
	); err != nil {
		t.Fatalf("migrate test models: %v", err)
	}

	orig := database.DB
	database.DB = db
	defer func() { database.DB = orig }()
	fn(db)
}

func TestProcessQueueInsertsBatch(t *testing.T) {
	withInMemoryDB(t, func(db *gorm.DB) {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		queue := make(chan *models.AgentEvent)
		done := make(chan struct{})
		go func() {
			processQueue(ctx, queue, 10)
			close(done)
		}()

		queue <- &models.AgentEvent{
			NodeID:    "node-1",
			SessionID: "session-1",
			EventType: "message",
			Timestamp: time.Now(),
		}

		var count int64
		deadline := time.Now().Add(500 * time.Millisecond)
		for {
			if err := db.Model(&models.AgentEvent{}).Count(&count).Error; err != nil {
				t.Fatalf("count agent events: %v", err)
			}
			if count == 1 || time.Now().After(deadline) {
				break
			}
			time.Sleep(10 * time.Millisecond)
		}

		if count != 1 {
			t.Fatalf("expected one inserted event, got %d", count)
		}

		cancel()
		<-done
	})
}

func TestReportAgentEventQueuesMappedEvent(t *testing.T) {
	ts := time.Now().UTC().Truncate(time.Second)
	withEventQueueForTest(t, 1, func(ch chan *models.AgentEvent) {
		payload := map[string]any{
			"node_id":            "node-1",
			"session_id":         "session-1",
			"event_type":         "message",
			"content":            map[string]any{"text": "hello"},
			"timestamp":          ts.Format(time.RFC3339),
			"model":              "MiniMax-M2.7-highspeed",
			"provider":           "minimax-portal",
			"input_tokens":       12,
			"output_tokens":      34,
			"cache_read_tokens":  2,
			"cache_write_tokens": 3,
			"cost_usd":           0.45,
			"duration_ms":        678,
			"tool_name":          "web_search",
			"channel":            "feishu",
		}

		rec := performJSONPost(t, ReportAgentEvent, payload)
		if rec.Code != http.StatusCreated {
			t.Fatalf("expected 201, got %d body=%s", rec.Code, rec.Body.String())
		}

		select {
		case event := <-ch:
			if event.NodeID != "node-1" || event.SessionID != "session-1" || event.Model != "MiniMax-M2.7-highspeed" {
				t.Fatalf("unexpected queued event: %+v", event)
			}
			if event.InputTokens != 12 || event.OutputTokens != 34 || event.CostUSD != 0.45 {
				t.Fatalf("unexpected usage mapping: %+v", event)
			}
			if event.ToolName != "web_search" || event.Channel != "feishu" {
				t.Fatalf("unexpected tool/channel mapping: %+v", event)
			}
		default:
			t.Fatal("expected agent event to be queued")
		}
	})
}

func TestReportSystemMetricsQueuesMetric(t *testing.T) {
	ts := time.Now().UTC().Truncate(time.Second)
	withMetricsQueueForTest(t, 1, func(ch chan *models.SystemMetric) {
		payload := map[string]any{
			"node_id":           "node-1",
			"cpu_percent":       12.5,
			"cpu_count":         8,
			"load_avg_1m":       0.5,
			"load_avg_5m":       0.6,
			"load_avg_15m":      0.7,
			"ram_used_mb":       1024.0,
			"ram_total_mb":      4096.0,
			"ram_percent":       25.0,
			"swap_used_mb":      12.0,
			"swap_total_mb":     512.0,
			"disk_used_percent": 66.0,
			"disk_total_gb":     100.0,
			"uptime_seconds":    3600,
			"boot_time_seconds": 123,
			"net_tx_bytes":      1000,
			"net_rx_bytes":      2000,
			"timestamp":         ts.Format(time.RFC3339),
		}

		rec := performJSONPost(t, ReportSystemMetrics, payload)
		if rec.Code != http.StatusCreated {
			t.Fatalf("expected 201, got %d body=%s", rec.Code, rec.Body.String())
		}

		select {
		case metric := <-ch:
			if metric.NodeID != "node-1" || metric.CPUCount != 8 || metric.RAMPercent != 25 {
				t.Fatalf("unexpected queued metric: %+v", metric)
			}
			if metric.NetTxBytes != 1000 || metric.NetRxBytes != 2000 {
				t.Fatalf("unexpected network metrics: %+v", metric)
			}
		default:
			t.Fatal("expected system metric to be queued")
		}
	})
}

func TestReportWorkspaceEventQueuesSummaryFields(t *testing.T) {
	ts := time.Now().UTC().Truncate(time.Second)
	withWorkspaceQueueForTest(t, 1, func(ch chan *models.WorkspaceEvent) {
		payload := map[string]any{
			"node_id":   "node-1",
			"type":      "workspace.snapshot",
			"files":     []map[string]any{{"path": "/tmp/a", "filename": "a", "type": "file"}},
			"timestamp": ts.Format(time.RFC3339),
			"summary": map[string]any{
				"agent_name":        "main",
				"soul_exists":       true,
				"agents_exists":     true,
				"memory_exists":     false,
				"state_exists":      true,
				"soul_content":      "soul",
				"agents_content":    "agents",
				"state_content":     "state",
				"heartbeat_ms_ago":  1234,
				"daily_notes_count": 5,
			},
		}

		rec := performJSONPost(t, ReportWorkspaceEvent, payload)
		if rec.Code != http.StatusCreated {
			t.Fatalf("expected 201, got %d body=%s", rec.Code, rec.Body.String())
		}

		select {
		case event := <-ch:
			if event.NodeID != "node-1" || event.EventType != "workspace.snapshot" || event.AgentName != "main" {
				t.Fatalf("unexpected workspace event: %+v", event)
			}
			if !event.SoulExists || !event.AgentsExists || !event.StateExists {
				t.Fatalf("expected summary booleans to be mapped: %+v", event)
			}
			if event.HeartbeatMsAgo != 1234 || event.DailyNotesCount != 5 {
				t.Fatalf("unexpected summary counters: %+v", event)
			}
		default:
			t.Fatal("expected workspace event to be queued")
		}
	})
}

func TestReportHandlersRejectInvalidJSON(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handlers := []gin.HandlerFunc{ReportAgentEvent, ReportSystemMetrics, ReportWorkspaceEvent}
	for _, handler := range handlers {
		rec := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(rec)
		req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader([]byte(`{"bad"`)))
		req.Header.Set("Content-Type", "application/json")
		ctx.Request = req
		handler(ctx)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for invalid payload, got %d", rec.Code)
		}
	}
}
