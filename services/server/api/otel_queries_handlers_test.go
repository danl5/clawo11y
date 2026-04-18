package api

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	collectortracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonv1 "go.opentelemetry.io/proto/otlp/common/v1"
	resourcev1 "go.opentelemetry.io/proto/otlp/resource/v1"
	tracev1 "go.opentelemetry.io/proto/otlp/trace/v1"
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
			Attributes:       datatypes.JSON([]byte(`{"session_id":"sess-1","run_lineage_id":"run-root-1","root_run_lineage_id":"run-root-1","user_message":"hi","run_status":"ok","run_close_reason":"agent_end","total_cost_usd":1.2,"total_tokens":120,"run_llm_call_count":1,"run_tool_call_count":1,"run_subagent_call_count":1,"last_model":"MiniMax-M2.7-highspeed","last_provider":"minimax-portal"}`)),
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
			Attributes:       datatypes.JSON([]byte(`{"session_id":"sess-2","run_lineage_id":"run-child-1","parent_run_lineage_id":"run-root-1","root_run_lineage_id":"run-root-1","user_message":"oops","run_status":"error","run_close_reason":"agent_end","error_type":"tool","error":"failed","total_cost_usd":0.8,"total_tokens":80,"run_llm_call_count":1,"run_tool_call_count":1,"run_subagent_call_count":0,"last_model":"gpt-4o","last_provider":"openai"}`)),
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

func waitForOtelSpanRows(t *testing.T, db *gorm.DB, want int64) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for {
		var count int64
		if err := db.Model(&models.OtelSpan{}).Count(&count).Error; err != nil {
			t.Fatalf("count otel spans: %v", err)
		}
		if count == want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected %d otel spans, got %d", want, count)
		}
		time.Sleep(10 * time.Millisecond)
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
			t.Fatalf("expected two recent root runs, got %+v", recent)
		}

		relatedRunsRec := performGET(t, GetRelatedRuns, "/related-runs/run-root-1", gin.Params{{Key: "root_run_lineage_id", Value: "run-root-1"}})
		if relatedRunsRec.Code != http.StatusOK {
			t.Fatalf("related runs expected 200, got %d body=%s", relatedRunsRec.Code, relatedRunsRec.Body.String())
		}
		var relatedRuns []map[string]any
		decodeJSONBody(t, relatedRunsRec, &relatedRuns)
		if len(relatedRuns) != 2 {
			t.Fatalf("expected two related runs, got %+v", relatedRuns)
		}
	})
}

func TestRelatedRunsRealChainE2E(t *testing.T) {
	const (
		mainSession       = "agent:main:feishu:direct:parent"
		childSession      = "agent:main:subagent:child-run-1"
		rootRunLineageID  = "run-main-1"
		childRunLineageID = "run-child-1"
		mainTraceHex      = "101112131415161718191a1b1c1d1e1f"
		childTraceHex     = "202122232425262728292a2b2c2d2e2f"
	)

	withInMemoryDB(t, func(db *gorm.DB) {
		withSpanQueue(t, 8, func(ch chan *models.OtelSpan) {
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan struct{})
			go func() {
				processQueue(ctx, ch, 8)
				close(done)
			}()
			defer func() {
				cancel()
				<-done
			}()

			kvStr := func(key, value string) *commonv1.KeyValue {
				return &commonv1.KeyValue{
					Key: key,
					Value: &commonv1.AnyValue{
						Value: &commonv1.AnyValue_StringValue{StringValue: value},
					},
				}
			}
			kvInt := func(key string, value int64) *commonv1.KeyValue {
				return &commonv1.KeyValue{
					Key: key,
					Value: &commonv1.AnyValue{
						Value: &commonv1.AnyValue_IntValue{IntValue: value},
					},
				}
			}
			kvDouble := func(key string, value float64) *commonv1.KeyValue {
				return &commonv1.KeyValue{
					Key: key,
					Value: &commonv1.AnyValue{
						Value: &commonv1.AnyValue_DoubleValue{DoubleValue: value},
					},
				}
			}

			start := uint64(time.Now().Add(-2 * time.Minute).UnixNano())
			mainTraceID := []byte{0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f}
			childTraceID := []byte{0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f}
			mainRootSpanID := []byte{0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08}
			sessionsSpawnSpanID := []byte{0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18}
			subagentSpanID := []byte{0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28}
			childRootSpanID := []byte{0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38}
			announceSpanID := []byte{0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48}

			req := &collectortracev1.ExportTraceServiceRequest{
				ResourceSpans: []*tracev1.ResourceSpans{
					{
						Resource: &resourcev1.Resource{
							Attributes: []*commonv1.KeyValue{
								kvStr("service.name", "openclaw"),
							},
						},
						ScopeSpans: []*tracev1.ScopeSpans{
							{
								Spans: []*tracev1.Span{
									{
										TraceId:           mainTraceID,
										SpanId:            mainRootSpanID,
										Name:              "command.process",
										StartTimeUnixNano: start,
										EndTimeUnixNano:   start + uint64(8*time.Second),
										Status:            &tracev1.Status{Code: tracev1.Status_STATUS_CODE_OK},
										Attributes: []*commonv1.KeyValue{
											kvStr("session_id", mainSession),
											kvStr("run_lineage_id", rootRunLineageID),
											kvStr("root_run_lineage_id", rootRunLineageID),
											kvStr("run_status", "ok"),
											kvStr("run_close_reason", "agent_end"),
											kvStr("user_message", "ship a rollout plan"),
											kvStr("last_model", "MiniMax-M2.7-highspeed"),
											kvStr("last_provider", "minimax-portal"),
											kvInt("run_tool_call_count", 1),
											kvInt("run_subagent_call_count", 1),
											kvInt("total_tokens", 120),
											kvDouble("total_cost_usd", 1.2),
										},
									},
									{
										TraceId:           mainTraceID,
										SpanId:            sessionsSpawnSpanID,
										ParentSpanId:      mainRootSpanID,
										Name:              "tool.call: sessions_spawn",
										StartTimeUnixNano: start + uint64(1*time.Second),
										EndTimeUnixNano:   start + uint64(2*time.Second),
										Status:            &tracev1.Status{Code: tracev1.Status_STATUS_CODE_OK},
										Attributes: []*commonv1.KeyValue{
											kvStr("session_id", mainSession),
											kvStr("tool_name", "sessions_spawn"),
											kvStr("tool_call_id", "call_spawn_1"),
										},
									},
									{
										TraceId:           mainTraceID,
										SpanId:            subagentSpanID,
										ParentSpanId:      mainRootSpanID,
										Name:              "subagent:researcher",
										StartTimeUnixNano: start + uint64(2*time.Second),
										EndTimeUnixNano:   start + uint64(7*time.Second),
										Status:            &tracev1.Status{Code: tracev1.Status_STATUS_CODE_OK},
										Attributes: []*commonv1.KeyValue{
											kvStr("session_id", mainSession),
											kvStr("subagent.parent_run_lineage_id", rootRunLineageID),
											kvStr("subagent.root_run_lineage_id", rootRunLineageID),
											kvStr("subagent.child_session_key", childSession),
											kvStr("subagent.label", "researcher"),
											kvStr("subagent.mode", "run"),
											kvStr("subagent.fallback_source", "sessions_spawn"),
										},
									},
								},
							},
						},
					},
					{
						Resource: &resourcev1.Resource{
							Attributes: []*commonv1.KeyValue{
								kvStr("service.name", "openclaw"),
							},
						},
						ScopeSpans: []*tracev1.ScopeSpans{
							{
								Spans: []*tracev1.Span{
									{
										TraceId:           childTraceID,
										SpanId:            childRootSpanID,
										Name:              "command.process",
										StartTimeUnixNano: start + uint64(3*time.Second),
										EndTimeUnixNano:   start + uint64(6*time.Second),
										Status:            &tracev1.Status{Code: tracev1.Status_STATUS_CODE_OK},
										Attributes: []*commonv1.KeyValue{
											kvStr("session_id", childSession),
											kvStr("run_lineage_id", childRunLineageID),
											kvStr("parent_run_lineage_id", rootRunLineageID),
											kvStr("root_run_lineage_id", rootRunLineageID),
											kvStr("run_status", "ok"),
											kvStr("run_close_reason", "agent_end"),
											kvStr("last_model", "MiniMax-M2.7-highspeed"),
											kvStr("last_provider", "minimax-portal"),
											kvInt("run_llm_call_count", 1),
											kvInt("total_tokens", 80),
											kvDouble("total_cost_usd", 0.8),
										},
									},
									{
										TraceId:           childTraceID,
										SpanId:            announceSpanID,
										ParentSpanId:      childRootSpanID,
										Name:              "announce",
										StartTimeUnixNano: start + uint64(4*time.Second),
										EndTimeUnixNano:   start + uint64(5*time.Second),
										Status:            &tracev1.Status{Code: tracev1.Status_STATUS_CODE_OK},
										Attributes: []*commonv1.KeyValue{
											kvStr("session_id", childSession),
											kvStr("event_name", "run.started"),
											kvStr("message", "researcher joined the run"),
										},
									},
								},
							},
						},
					},
				},
			}

			rec := performJSONHandler(t, ReceiveOtelTraces, jsonBody(t, req))
			if rec.Code != http.StatusOK {
				t.Fatalf("ingest traces expected 200, got %d body=%s", rec.Code, rec.Body.String())
			}

			waitForOtelSpanRows(t, db, 5)
		})

		recentRec := performGET(t, GetRecentTraces, "/recent-traces", nil)
		if recentRec.Code != http.StatusOK {
			t.Fatalf("recent traces expected 200, got %d body=%s", recentRec.Code, recentRec.Body.String())
		}
		var recent []map[string]any
		decodeJSONBody(t, recentRec, &recent)
		if len(recent) != 2 {
			t.Fatalf("expected 2 root traces from real chain, got %+v", recent)
		}

		recentBySession := make(map[string]map[string]any, len(recent))
		for _, span := range recent {
			attrs := span["Attributes"].(map[string]any)
			recentBySession[attrs["session_id"].(string)] = attrs
		}
		if recentBySession[mainSession]["run_lineage_id"] != rootRunLineageID {
			t.Fatalf("main root trace lost run_lineage_id: %+v", recentBySession[mainSession])
		}
		if recentBySession[childSession]["parent_run_lineage_id"] != rootRunLineageID {
			t.Fatalf("child root trace lost parent_run_lineage_id: %+v", recentBySession[childSession])
		}
		if recentBySession[childSession]["root_run_lineage_id"] != rootRunLineageID {
			t.Fatalf("child root trace lost root_run_lineage_id: %+v", recentBySession[childSession])
		}

		parentTreeRec := performGET(t, GetTraceTree, "/trace/main", gin.Params{{Key: "trace_id", Value: mainTraceHex}})
		if parentTreeRec.Code != http.StatusOK {
			t.Fatalf("parent trace tree expected 200, got %d body=%s", parentTreeRec.Code, parentTreeRec.Body.String())
		}
		var parentTree []map[string]any
		decodeJSONBody(t, parentTreeRec, &parentTree)
		if len(parentTree) != 1 {
			t.Fatalf("expected one parent root node, got %+v", parentTree)
		}
		parentChildren := parentTree[0]["children"].([]any)
		if len(parentChildren) != 2 {
			t.Fatalf("expected sessions_spawn and subagent children, got %+v", parentChildren)
		}

		childTreeRec := performGET(t, GetTraceTree, "/trace/child", gin.Params{{Key: "trace_id", Value: childTraceHex}})
		if childTreeRec.Code != http.StatusOK {
			t.Fatalf("child trace tree expected 200, got %d body=%s", childTreeRec.Code, childTreeRec.Body.String())
		}
		var childTree []map[string]any
		decodeJSONBody(t, childTreeRec, &childTree)
		if len(childTree) != 1 {
			t.Fatalf("expected one child root node, got %+v", childTree)
		}
		childChildren := childTree[0]["children"].([]any)
		if len(childChildren) != 1 {
			t.Fatalf("expected announce leaf span under child turn, got %+v", childChildren)
		}
		if childChildren[0].(map[string]any)["Name"] != "announce" {
			t.Fatalf("expected announce leaf span, got %+v", childChildren[0])
		}

		relatedRunsRec := performGET(t, GetRelatedRuns, "/related-runs/"+rootRunLineageID, gin.Params{{Key: "root_run_lineage_id", Value: rootRunLineageID}})
		if relatedRunsRec.Code != http.StatusOK {
			t.Fatalf("related runs expected 200, got %d body=%s", relatedRunsRec.Code, relatedRunsRec.Body.String())
		}
		var relatedRuns []map[string]any
		decodeJSONBody(t, relatedRunsRec, &relatedRuns)
		if len(relatedRuns) != 2 {
			t.Fatalf("expected parent and child related runs, got %+v", relatedRuns)
		}

		relatedRunsBySession := make(map[string]map[string]any, len(relatedRuns))
		for _, span := range relatedRuns {
			attrs := span["Attributes"].(map[string]any)
			relatedRunsBySession[attrs["session_id"].(string)] = attrs
		}
		if relatedRunsBySession[mainSession]["run_lineage_id"] != rootRunLineageID {
			t.Fatalf("related runs missing main run lineage root id: %+v", relatedRunsBySession[mainSession])
		}
		if relatedRunsBySession[childSession]["run_lineage_id"] != childRunLineageID {
			t.Fatalf("related runs missing child run lineage id: %+v", relatedRunsBySession[childSession])
		}
		if relatedRunsBySession[childSession]["parent_run_lineage_id"] != rootRunLineageID {
			t.Fatalf("related runs missing child lineage parent id: %+v", relatedRunsBySession[childSession])
		}
	})
}
