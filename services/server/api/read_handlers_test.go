package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	"github.com/danl5/clawo11y/services/server/models"
)

func performGET(t *testing.T, handler gin.HandlerFunc, path string, params gin.Params) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	req := httptest.NewRequest(http.MethodGet, path, nil)
	ctx.Request = req
	ctx.Params = params
	handler(ctx)
	return rec
}

func decodeJSONBody(t *testing.T, rec *httptest.ResponseRecorder, out any) {
	t.Helper()
	if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
		t.Fatalf("decode json: %v body=%s", err, rec.Body.String())
	}
}

func TestRegisterNodeAndGetNodes(t *testing.T) {
	withInMemoryDB(t, func(db *gorm.DB) {
		version := "1.2.3"
		hostname := "vm-1"
		payload := map[string]any{
			"node_id":          "node-1",
			"os_name":          "linux",
			"ip_address":       "10.0.0.1",
			"openclaw_version": version,
			"hostname":         hostname,
		}

		rec := performJSONPost(t, RegisterNode, payload)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
		}

		updatePayload := map[string]any{
			"node_id":    "node-1",
			"os_name":    "ubuntu",
			"ip_address": "10.0.0.2",
		}
		rec = performJSONPost(t, RegisterNode, updatePayload)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 on update, got %d body=%s", rec.Code, rec.Body.String())
		}

		listRec := performGET(t, GetNodes, "/nodes", nil)
		if listRec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d body=%s", listRec.Code, listRec.Body.String())
		}

		var resp []map[string]any
		decodeJSONBody(t, listRec, &resp)
		if len(resp) != 1 {
			t.Fatalf("expected one node, got %d", len(resp))
		}
		if resp[0]["os_name"] != "ubuntu" || resp[0]["ip_address"] != "10.0.0.2" {
			t.Fatalf("unexpected node payload: %+v", resp[0])
		}
	})
}

func TestTimelineQueries(t *testing.T) {
	withInMemoryDB(t, func(gormDB *gorm.DB) {
		ts1 := time.Now().Add(-2 * time.Minute).UTC().Truncate(time.Second)
		ts2 := time.Now().Add(-1 * time.Minute).UTC().Truncate(time.Second)

		events := []models.AgentEvent{
			{
				NodeID:       "node-1",
				SessionID:    "sess-1",
				EventType:    "message",
				Model:        "MiniMax-M2.7",
				Provider:     "minimax-portal",
				InputTokens:  10,
				OutputTokens: 20,
				CostUSD:      0.5,
				ToolName:     "web_search",
				Content:      datatypes.JSON([]byte(`{"text":"first"}`)),
				Timestamp:    ts1,
			},
			{
				NodeID:    "node-1",
				SessionID: "sess-1",
				EventType: "tool_result",
				Model:     "MiniMax-M2.7",
				Provider:  "minimax-portal",
				Content:   datatypes.JSON([]byte(`{"text":"second"}`)),
				Timestamp: ts2,
			},
			{
				NodeID:    "node-2",
				SessionID: "sess-2",
				EventType: "message",
				Model:     "gpt-4o",
				Content:   datatypes.JSON([]byte(`{"text":"third"}`)),
				Timestamp: ts2,
			},
		}
		if err := gormDB.Create(&events).Error; err != nil {
			t.Fatalf("seed agent events: %v", err)
		}

		rec := performGET(t, GetSessionTimeline, "/sessions/sess-1", gin.Params{{Key: "session_id", Value: "sess-1"}})
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
		}

		var timeline []map[string]any
		decodeJSONBody(t, rec, &timeline)
		if len(timeline) != 2 {
			t.Fatalf("expected two timeline events, got %d", len(timeline))
		}
		if timeline[0]["event_type"] != "message" || timeline[1]["event_type"] != "tool_result" {
			t.Fatalf("unexpected timeline order: %+v", timeline)
		}

		listRec := performGET(t, ListSessions, "/sessions", nil)
		if listRec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d body=%s", listRec.Code, listRec.Body.String())
		}

		var sessions []map[string]any
		decodeJSONBody(t, listRec, &sessions)
		if len(sessions) != 2 {
			t.Fatalf("expected two grouped sessions, got %d", len(sessions))
		}
		if sessions[0]["session_id"] != "sess-2" && sessions[0]["session_id"] != "sess-1" {
			t.Fatalf("unexpected grouped sessions: %+v", sessions)
		}
	})
}

func TestGetSnapshotBuildsCompositeMessageList(t *testing.T) {
	withInMemoryDB(t, func(gormDB *gorm.DB) {
		now := time.Now().UTC().Truncate(time.Second)

		if err := gormDB.Create(&models.SystemMetric{
			NodeID:          "node-1",
			CPUPercent:      25.5,
			RAMUsedMB:       512,
			RAMPercent:      50,
			DiskUsedPercent: 70,
			UptimeSeconds:   1234,
			Timestamp:       now,
		}).Error; err != nil {
			t.Fatalf("seed metric: %v", err)
		}
		if err := gormDB.Create(&models.SessionsEvent{
			NodeID:       "node-1",
			EventType:    "sessions.snapshot",
			Sessions:     datatypes.JSON([]byte(`[{"sessionId":"sess-1"}]`)),
			SessionCount: 1,
			ActiveCount:  1,
			HistoryCount: 0,
			Timestamp:    now,
		}).Error; err != nil {
			t.Fatalf("seed sessions event: %v", err)
		}
		if err := gormDB.Create(&models.WorkspaceEvent{
			NodeID:          "node-1",
			EventType:       "workspace.snapshot",
			AgentName:       "main",
			Files:           datatypes.JSON([]byte(`[{"filename":"MEMORY.md"}]`)),
			SoulExists:      true,
			AgentsExists:    true,
			MemoryExists:    true,
			StateExists:     true,
			HeartbeatMsAgo:  123,
			DailyNotesCount: 2,
			Timestamp:       now,
		}).Error; err != nil {
			t.Fatalf("seed workspace event: %v", err)
		}
		if err := gormDB.Create(&models.CronEvent{
			NodeID:    "node-1",
			EventType: "cron.snapshot",
			Jobs:      datatypes.JSON([]byte(`[{"id":"job-1"}]`)),
			Timestamp: now,
		}).Error; err != nil {
			t.Fatalf("seed cron event: %v", err)
		}
		if err := gormDB.Create(&models.GatewayLogEvent{
			NodeID:    "node-1",
			EventType: "gateway.log",
			LogPath:   "/tmp/gateway.log",
			Lines:     datatypes.JSON([]byte(`[{"msg":"hello"}]`)),
			Timestamp: now,
		}).Error; err != nil {
			t.Fatalf("seed gateway log: %v", err)
		}
		if err := gormDB.Create(&models.AgentEvent{
			NodeID:    "node-1",
			SessionID: "sess-1",
			EventType: "message",
			Model:     "MiniMax-M2.7",
			Provider:  "minimax-portal",
			Content:   datatypes.JSON([]byte(`{"text":"hello"}`)),
			Timestamp: now,
		}).Error; err != nil {
			t.Fatalf("seed agent event: %v", err)
		}

		rec := performGET(t, GetSnapshot, "/snapshot", nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
		}

		var resp map[string][]map[string]any
		decodeJSONBody(t, rec, &resp)
		if len(resp["messages"]) < 6 {
			t.Fatalf("expected composite snapshot messages, got %+v", resp)
		}
	})
}

func TestParseAggregateTimestamp(t *testing.T) {
	cases := []string{
		"2026-04-14T20:00:00Z",
		"2026-04-14 20:00:00+00:00",
		"2026-04-14 20:00:00",
	}
	for _, value := range cases {
		if _, err := parseAggregateTimestamp(value); err != nil {
			t.Fatalf("expected %q to parse, got %v", value, err)
		}
	}
	if _, err := parseAggregateTimestamp("not-a-time"); err == nil {
		t.Fatal("expected invalid timestamp parsing to fail")
	}
}
