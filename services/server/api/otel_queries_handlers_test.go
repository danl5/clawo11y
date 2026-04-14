package api

import (
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/datatypes"
	"gorm.io/gorm"

	"github.com/danl5/clawo11y/services/server/models"
)

func seedOtelData(t *testing.T, db *gorm.DB) {
	t.Helper()
	now := time.Now()

	spans := []models.OtelSpan{
		{
			TraceID:          "trace-root-1",
			SpanID:           "span-root-1",
			ParentSpanID:     "",
			Name:             "command.process",
			Model:            "MiniMax-M2.7-highspeed",
			Provider:         "minimax-portal",
			TotalTokens:      120,
			PromptTokens:     50,
			CompletionTokens: 70,
			CostUsd:          1.2,
			DurationNs:       int64(2 * time.Second),
			StatusCode:       1,
			Attributes:       datatypes.JSON([]byte(`{"session_id":"sess-1","user_message":"hi","run_status":"ok","root_close_reason":"agent_end","total_cost_usd":1.2,"total_tokens":120,"llm_call_count":1,"tool_call_count":1,"subagent_call_count":0,"last_model":"MiniMax-M2.7-highspeed","last_provider":"minimax-portal"}`)),
			CreatedAt:        now.Add(-10 * time.Minute),
		},
		{
			TraceID:          "trace-root-2",
			SpanID:           "span-root-2",
			ParentSpanID:     "",
			Name:             "command.process",
			Model:            "gpt-4o",
			Provider:         "openai",
			TotalTokens:      80,
			PromptTokens:     30,
			CompletionTokens: 50,
			CostUsd:          0.8,
			DurationNs:       int64(1500 * time.Millisecond),
			StatusCode:       2,
			Attributes:       datatypes.JSON([]byte(`{"session_id":"sess-2","user_message":"oops","run_status":"error","root_close_reason":"idle_timeout","error_type":"tool","error":"failed","total_cost_usd":0.8,"total_tokens":80,"llm_call_count":1,"tool_call_count":1,"subagent_call_count":0,"last_model":"gpt-4o","last_provider":"openai"}`)),
			CreatedAt:        now.Add(-5 * time.Minute),
		},
		{
			TraceID:      "trace-root-1",
			SpanID:       "span-tool-1",
			ParentSpanID: "span-root-1",
			Name:         "tool:web_search",
			ToolName:     "web_search",
			Model:        "MiniMax-M2.7-highspeed",
			Provider:     "minimax-portal",
			DurationNs:   int64(400 * time.Millisecond),
			StatusCode:   1,
			Attributes:   datatypes.JSON([]byte(`{"session_id":"sess-1","tool_category":"web","tool_risk_class":"medium","tool_risk_reason":"network","duration_ms":400}`)),
			CreatedAt:    now.Add(-10 * time.Minute),
		},
		{
			TraceID:      "trace-root-2",
			SpanID:       "span-tool-2",
			ParentSpanID: "span-root-2",
			Name:         "tool:bash",
			ToolName:     "bash",
			Model:        "gpt-4o",
			Provider:     "openai",
			DurationNs:   int64(900 * time.Millisecond),
			StatusCode:   2,
			Attributes:   datatypes.JSON([]byte(`{"session_id":"sess-2","tool_category":"shell","tool_risk_class":"high","tool_risk_reason":"exec","tool_params_preview":"rm -rf /tmp","duration_ms":900,"error_type":"tool","error":"denied"}`)),
			CreatedAt:    now.Add(-5 * time.Minute),
		},
		{
			TraceID:      "trace-root-1",
			SpanID:       "span-sub-1",
			ParentSpanID: "span-root-1",
			Name:         "subagent:researcher",
			StatusCode:   1,
			DurationNs:   int64(700 * time.Millisecond),
			Attributes:   datatypes.JSON([]byte(`{"subagent.label":"researcher","subagent.mode":"tool"}`)),
			CreatedAt:    now.Add(-8 * time.Minute),
		},
	}
	if err := db.Create(&spans).Error; err != nil {
		t.Fatalf("seed spans: %v", err)
	}

	metrics := []models.OtelMetric{
		{
			Name:          "openclaw.run.duration",
			Description:   "duration",
			Unit:          "ms",
			Type:          "Gauge",
			DataPoints:    datatypes.JSON([]byte(`[{"value":123}]`)),
			ResourceAttrs: datatypes.JSON([]byte(`{"service.name":"openclaw"}`)),
		},
	}
	if err := db.Create(&metrics).Error; err != nil {
		t.Fatalf("seed metrics: %v", err)
	}
	db.Exec("UPDATE otel_metrics SET created_at = ? WHERE id = ?", now.Add(-2*time.Minute), metrics[0].ID)

	logs := []models.OtelLog{
		{
			TraceID:      "trace-root-1",
			SeverityText: "INFO",
			Body:         "run started",
			Attributes:   datatypes.JSON([]byte(`{"event_name":"run.started"}`)),
			CreatedAt:    now.Add(-10 * time.Minute),
		},
		{
			TraceID:      "trace-root-2",
			SeverityText: "WARN",
			Body:         "idle timeout",
			Attributes:   datatypes.JSON([]byte(`{"event_name":"trace.root.closed_idle_timeout","close_reason":"idle_timeout","session_id":"sess-2","anomaly_type":"trace.root.recreated"}`)),
			CreatedAt:    now.Add(-4 * time.Minute),
		},
	}
	if err := db.Create(&logs).Error; err != nil {
		t.Fatalf("seed logs: %v", err)
	}
}

func TestGetMetricsDashboardAndRecentLogs(t *testing.T) {
	withInMemoryDB(t, func(db *gorm.DB) {
		seedOtelData(t, db)

		rec := performGET(t, GetMetricsDashboard, "/metrics", nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("metrics dashboard expected 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		var metrics []map[string]any
		decodeJSONBody(t, rec, &metrics)
		t.Logf("metrics dashboard response: len=%d payload=%v", len(metrics), metrics)
		if len(metrics) != 1 || metrics[0]["name"] != "openclaw.run.duration" {
			t.Fatalf("unexpected metrics dashboard payload: %+v", metrics)
		}

		logRec := performGET(t, GetRecentLogs, "/logs", nil)
		if logRec.Code != http.StatusOK {
			t.Fatalf("recent logs expected 200, got %d body=%s", logRec.Code, logRec.Body.String())
		}
		var logs []map[string]any
		decodeJSONBody(t, logRec, &logs)
		if len(logs) != 2 {
			t.Fatalf("expected 2 logs, got %+v", logs)
		}
	})
}

func TestGetCostDashboard(t *testing.T) {
	withInMemoryDB(t, func(db *gorm.DB) {
		seedOtelData(t, db)

		rec := performGET(t, GetCostDashboard, "/cost", nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("cost dashboard expected 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		var resp map[string]any
		decodeJSONBody(t, rec, &resp)
		summary := resp["summary"].(map[string]any)
		if int(summary["total_calls"].(float64)) < 2 {
			t.Fatalf("unexpected cost summary: %+v", summary)
		}
		if len(resp["providers"].([]any)) == 0 || len(resp["top_runs"].([]any)) == 0 {
			t.Fatalf("expected providers and top runs in cost dashboard: %+v", resp)
		}
	})
}

func TestGetOtelOverviewHealthAndSecurity(t *testing.T) {
	withInMemoryDB(t, func(db *gorm.DB) {
		seedOtelData(t, db)

		overviewRec := performGET(t, GetOtelOverview, "/overview", nil)
		if overviewRec.Code != http.StatusOK {
			t.Fatalf("overview expected 200, got %d body=%s", overviewRec.Code, overviewRec.Body.String())
		}
		var overview map[string]any
		decodeJSONBody(t, overviewRec, &overview)
		summary := overview["summary"].(map[string]any)
		if int(summary["total_runs"].(float64)) != 2 || int(summary["errored_runs"].(float64)) != 1 {
			t.Fatalf("unexpected overview summary: %+v", summary)
		}
		if len(overview["recent_runs"].([]any)) == 0 || len(overview["tools"].([]any)) == 0 {
			t.Fatalf("expected overview aggregates: %+v", overview)
		}

		healthRec := performGET(t, GetOtelHealth, "/health", nil)
		if healthRec.Code != http.StatusOK {
			t.Fatalf("health expected 200, got %d body=%s", healthRec.Code, healthRec.Body.String())
		}
		var health map[string]any
		decodeJSONBody(t, healthRec, &health)
		healthSummary := health["summary"].(map[string]any)
		if int(healthSummary["anomaly_count"].(float64)) < 1 || int(healthSummary["idle_timeout_closures"].(float64)) < 1 {
			t.Fatalf("unexpected health summary: %+v", healthSummary)
		}

		securityRec := performGET(t, GetOtelSecurityTimeline, "/security", nil)
		if securityRec.Code != http.StatusOK {
			t.Fatalf("security expected 200, got %d body=%s", securityRec.Code, securityRec.Body.String())
		}
		var security map[string]any
		decodeJSONBody(t, securityRec, &security)
		securitySummary := security["summary"].(map[string]any)
		if int(securitySummary["high_risk_count"].(float64)) != 1 || int(securitySummary["medium_risk_count"].(float64)) != 1 {
			t.Fatalf("unexpected security summary: %+v", securitySummary)
		}
		if len(security["timeline"].([]any)) != 2 {
			t.Fatalf("expected two risky timeline items, got %+v", security["timeline"])
		}
	})
}

func TestGetTraceTreeAndRecentTraces(t *testing.T) {
	withInMemoryDB(t, func(db *gorm.DB) {
		seedOtelData(t, db)

		traceRec := performGET(t, GetTraceTree, "/trace/trace-root-1", gin.Params{{Key: "trace_id", Value: "trace-root-1"}})
		if traceRec.Code != http.StatusOK {
			t.Fatalf("trace tree expected 200, got %d body=%s", traceRec.Code, traceRec.Body.String())
		}
		var tree []map[string]any
		decodeJSONBody(t, traceRec, &tree)
		if len(tree) == 0 || len(tree[0]["children"].([]any)) == 0 {
			t.Fatalf("expected rooted span tree, got %+v", tree)
		}

		missingRec := performGET(t, GetTraceTree, "/trace/missing", gin.Params{{Key: "trace_id", Value: "missing"}})
		if missingRec.Code != http.StatusNotFound {
			t.Fatalf("missing trace expected 404, got %d body=%s", missingRec.Code, missingRec.Body.String())
		}

		recentRec := performGET(t, GetRecentTraces, "/recent-traces", nil)
		if recentRec.Code != http.StatusOK {
			t.Fatalf("recent traces expected 200, got %d body=%s", recentRec.Code, recentRec.Body.String())
		}
		var recent []map[string]any
		decodeJSONBody(t, recentRec, &recent)
		if len(recent) != 2 {
			t.Fatalf("expected two recent root traces, got %+v", recent)
		}
	})
}
