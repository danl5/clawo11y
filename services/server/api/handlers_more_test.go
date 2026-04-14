package api

import (
	"net/http"
	"testing"
	"time"

	"github.com/danl5/clawo11y/services/server/models"
)

func TestReportGatewayLogEventQueuesEvent(t *testing.T) {
	ts := time.Now().UTC().Truncate(time.Second)
	orig := GatewayLogQueue
	ch := make(chan *models.GatewayLogEvent, 1)
	GatewayLogQueue = ch
	defer func() { GatewayLogQueue = orig }()

	payload := map[string]any{
		"node_id":   "node-1",
		"type":      "gateway.log",
		"log_path":  "/tmp/gateway.log",
		"lines":     []map[string]any{{"level": "info", "msg": "hello"}},
		"timestamp": ts.Format(time.RFC3339),
	}

	rec := performJSONPost(t, ReportGatewayLogEvent, payload)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s", rec.Code, rec.Body.String())
	}
	select {
	case ev := <-ch:
		if ev.NodeID != "node-1" || ev.LogPath != "/tmp/gateway.log" || ev.EventType != "gateway.log" {
			t.Fatalf("unexpected gateway log event: %+v", ev)
		}
	default:
		t.Fatal("expected gateway log event to be queued")
	}
}

func TestReportCronEventQueuesEvent(t *testing.T) {
	ts := time.Now().UTC().Truncate(time.Second)
	orig := CronQueue
	ch := make(chan *models.CronEvent, 1)
	CronQueue = ch
	defer func() { CronQueue = orig }()

	payload := map[string]any{
		"node_id":   "node-1",
		"type":      "cron.snapshot",
		"jobs":      []map[string]any{{"id": "job-1", "name": "demo", "schedule": "* * * * *", "enabled": true, "last_run_ms": 0, "next_run_ms": 0, "run_count": 1, "error_count": 0}},
		"timestamp": ts.Format(time.RFC3339),
	}

	rec := performJSONPost(t, ReportCronEvent, payload)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s", rec.Code, rec.Body.String())
	}
	select {
	case ev := <-ch:
		if ev.NodeID != "node-1" || ev.EventType != "cron.snapshot" {
			t.Fatalf("unexpected cron event: %+v", ev)
		}
	default:
		t.Fatal("expected cron event to be queued")
	}
}

func TestReportSessionsEventQueuesEvent(t *testing.T) {
	ts := time.Now().UTC().Truncate(time.Second)
	orig := SessionsQueue
	ch := make(chan *models.SessionsEvent, 1)
	SessionsQueue = ch
	defer func() { SessionsQueue = orig }()

	payload := map[string]any{
		"node_id":       "node-1",
		"type":          "sessions.snapshot",
		"sessions":      []map[string]any{{"sessionId": "sess-1", "key": "main", "created_at_ms": 1, "last_active_ms": 2, "token_count": 3, "cost_usd": 0.1, "is_history": false}},
		"session_count": 1,
		"active_count":  1,
		"history_count": 0,
		"timestamp":     ts.Format(time.RFC3339),
	}

	rec := performJSONPost(t, ReportSessionsEvent, payload)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s", rec.Code, rec.Body.String())
	}
	select {
	case ev := <-ch:
		if ev.NodeID != "node-1" || ev.SessionCount != 1 || ev.ActiveCount != 1 {
			t.Fatalf("unexpected sessions event: %+v", ev)
		}
	default:
		t.Fatal("expected sessions event to be queued")
	}
}

func TestReportHealthHistoryEventQueuesEvent(t *testing.T) {
	ts := time.Now().UTC().Truncate(time.Second)
	orig := HealthQueue
	ch := make(chan *models.HealthHistoryEvent, 1)
	HealthQueue = ch
	defer func() { HealthQueue = orig }()

	payload := map[string]any{
		"node_id":   "node-1",
		"type":      "health.snapshot",
		"snapshots": []map[string]any{{"timestamp": 1, "cpu_percent": 10.5, "ram_percent": 20.0, "disk_percent": 30.0}},
		"count":     1,
		"timestamp": ts.Format(time.RFC3339),
	}

	rec := performJSONPost(t, ReportHealthHistoryEvent, payload)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s", rec.Code, rec.Body.String())
	}
	select {
	case ev := <-ch:
		if ev.NodeID != "node-1" || ev.Count != 1 || ev.EventType != "health.snapshot" {
			t.Fatalf("unexpected health event: %+v", ev)
		}
	default:
		t.Fatal("expected health event to be queued")
	}
}
