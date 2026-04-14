package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/danl5/clawo11y/services/server/models"
	"github.com/gin-gonic/gin"
	collectorlogsv1 "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	collectormetricsv1 "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	collectortracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonv1 "go.opentelemetry.io/proto/otlp/common/v1"
	logsv1 "go.opentelemetry.io/proto/otlp/logs/v1"
	metricsv1 "go.opentelemetry.io/proto/otlp/metrics/v1"
	resourcev1 "go.opentelemetry.io/proto/otlp/resource/v1"
	tracev1 "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func withSpanQueue(t *testing.T, size int, fn func(chan *models.OtelSpan)) {
	t.Helper()
	orig := OtelSpanQueue
	ch := make(chan *models.OtelSpan, size)
	OtelSpanQueue = ch
	defer func() { OtelSpanQueue = orig }()
	fn(ch)
}

func withMetricQueue(t *testing.T, size int, fn func(chan *models.OtelMetric)) {
	t.Helper()
	orig := OtelMetricQueue
	ch := make(chan *models.OtelMetric, size)
	OtelMetricQueue = ch
	defer func() { OtelMetricQueue = orig }()
	fn(ch)
}

func withLogQueue(t *testing.T, size int, fn func(chan *models.OtelLog)) {
	t.Helper()
	orig := OtelLogQueue
	ch := make(chan *models.OtelLog, size)
	OtelLogQueue = ch
	defer func() { OtelLogQueue = orig }()
	fn(ch)
}

func performJSONHandler(t *testing.T, handler gin.HandlerFunc, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	ctx.Request = req
	handler(ctx)
	return rec
}

func jsonBody(t *testing.T, msg proto.Message) []byte {
	t.Helper()
	body, err := protojson.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal protojson: %v", err)
	}
	return body
}

func TestReceiveOtelTracesEnqueuesMaterializedSpan(t *testing.T) {
	withSpanQueue(t, 1, func(ch chan *models.OtelSpan) {
		req := &collectortracev1.ExportTraceServiceRequest{
			ResourceSpans: []*tracev1.ResourceSpans{
				{
					Resource: &resourcev1.Resource{
						Attributes: []*commonv1.KeyValue{
							{Key: "service.name", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_StringValue{StringValue: "openclaw"}}},
						},
					},
					ScopeSpans: []*tracev1.ScopeSpans{
						{
							Spans: []*tracev1.Span{
								{
									TraceId:           []byte{0x01, 0x02},
									SpanId:            []byte{0x03, 0x04},
									ParentSpanId:      []byte{0x05, 0x06},
									Name:              "llm.call",
									Kind:              tracev1.Span_SPAN_KIND_CLIENT,
									StartTimeUnixNano: 100,
									EndTimeUnixNano:   250,
									Attributes: []*commonv1.KeyValue{
										{Key: "model", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_StringValue{StringValue: "MiniMax-M2.7"}}},
										{Key: "provider", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_StringValue{StringValue: "minimax-portal"}}},
										{Key: "tool_name", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_StringValue{StringValue: "web_search"}}},
										{Key: "prompt_tokens", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_IntValue{IntValue: 12}}},
										{Key: "completion_tokens", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_IntValue{IntValue: 34}}},
										{Key: "total_tokens", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_IntValue{IntValue: 46}}},
										{Key: "cost_usd", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_DoubleValue{DoubleValue: 0.12}}},
									},
									Status: &tracev1.Status{Code: tracev1.Status_STATUS_CODE_OK, Message: "ok"},
								},
							},
						},
					},
				},
			},
		}

		rec := performJSONHandler(t, ReceiveOtelTraces, jsonBody(t, req))
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
		}

		select {
		case span := <-ch:
			if span.Name != "llm.call" || span.Model != "MiniMax-M2.7" || span.Provider != "minimax-portal" {
				t.Fatalf("unexpected materialized span: %+v", span)
			}
			if span.PromptTokens != 12 || span.CompletionTokens != 34 || span.TotalTokens != 46 {
				t.Fatalf("unexpected token materialization: %+v", span)
			}
			if span.CostUsd != 0.12 || span.DurationNs != 150 {
				t.Fatalf("unexpected span cost/duration: %+v", span)
			}
		default:
			t.Fatal("expected span to be queued")
		}
	})
}

func TestReceiveOtelMetricsEnqueuesMetric(t *testing.T) {
	withMetricQueue(t, 1, func(ch chan *models.OtelMetric) {
		req := &collectormetricsv1.ExportMetricsServiceRequest{
			ResourceMetrics: []*metricsv1.ResourceMetrics{
				{
					Resource: &resourcev1.Resource{
						Attributes: []*commonv1.KeyValue{
							{Key: "service.name", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_StringValue{StringValue: "openclaw"}}},
						},
					},
					ScopeMetrics: []*metricsv1.ScopeMetrics{
						{
							Metrics: []*metricsv1.Metric{
								{
									Name:        "openclaw.run.duration",
									Description: "run duration",
									Unit:        "ms",
									Data: &metricsv1.Metric_Gauge{
										Gauge: &metricsv1.Gauge{
											DataPoints: []*metricsv1.NumberDataPoint{
												{
													Value: &metricsv1.NumberDataPoint_AsDouble{AsDouble: 123.4},
												},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		}

		rec := performJSONHandler(t, ReceiveOtelMetrics, jsonBody(t, req))
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
		}

		select {
		case metric := <-ch:
			if metric.Name != "openclaw.run.duration" || metric.Type != "Gauge" || metric.Unit != "ms" {
				t.Fatalf("unexpected metric: %+v", metric)
			}
		default:
			t.Fatal("expected metric to be queued")
		}
	})
}

func TestReceiveOtelLogsEnqueuesLog(t *testing.T) {
	withLogQueue(t, 1, func(ch chan *models.OtelLog) {
		req := &collectorlogsv1.ExportLogsServiceRequest{
			ResourceLogs: []*logsv1.ResourceLogs{
				{
					Resource: &resourcev1.Resource{
						Attributes: []*commonv1.KeyValue{
							{Key: "service.name", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_StringValue{StringValue: "openclaw"}}},
						},
					},
					ScopeLogs: []*logsv1.ScopeLogs{
						{
							LogRecords: []*logsv1.LogRecord{
								{
									TraceId:        []byte{0xaa},
									SpanId:         []byte{0xbb},
									TimeUnixNano:   12345,
									SeverityText:   "INFO",
									SeverityNumber: logsv1.SeverityNumber_SEVERITY_NUMBER_INFO,
									Body:           &commonv1.AnyValue{Value: &commonv1.AnyValue_StringValue{StringValue: "hello"}},
									Attributes: []*commonv1.KeyValue{
										{Key: "event.name", Value: &commonv1.AnyValue{Value: &commonv1.AnyValue_StringValue{StringValue: "run.started"}}},
									},
								},
							},
						},
					},
				},
			},
		}

		rec := performJSONHandler(t, ReceiveOtelLogs, jsonBody(t, req))
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
		}

		select {
		case logRecord := <-ch:
			if logRecord.Body != "hello" || logRecord.SeverityText != "INFO" || logRecord.TimestampUnix != 12345 {
				t.Fatalf("unexpected log record: %+v", logRecord)
			}
		default:
			t.Fatal("expected log to be queued")
		}
	})
}

func TestReceiveOtelPayloadReturnsBadRequestOnInvalidBody(t *testing.T) {
	handlers := []gin.HandlerFunc{ReceiveOtelTraces, ReceiveOtelMetrics, ReceiveOtelLogs}
	for _, handler := range handlers {
		rec := performJSONHandler(t, handler, []byte(`{"bad"`))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for invalid payload, got %d", rec.Code)
		}
		var body map[string]string
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if body["error"] == "" {
			t.Fatalf("expected error body, got %v", body)
		}
	}
}
