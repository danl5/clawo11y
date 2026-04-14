package api

import (
	"context"
	"encoding/json"
	"io"
	"log"

	"github.com/gin-gonic/gin"
	collectorlogsv1 "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	collectormetricsv1 "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	collectortracev1 "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonv1 "go.opentelemetry.io/proto/otlp/common/v1"
	metricsv1 "go.opentelemetry.io/proto/otlp/metrics/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"gorm.io/datatypes"

	"github.com/danl5/clawo11y/services/server/models"
)

var OtelSpanQueue = make(chan *models.OtelSpan, 10000)
var OtelMetricQueue = make(chan *models.OtelMetric, 10000)
var OtelLogQueue = make(chan *models.OtelLog, 10000)

func StartOtelProcessors(ctx context.Context) {
	go processQueue(ctx, OtelSpanQueue, 200)
	go processQueue(ctx, OtelMetricQueue, 200)
	go processQueue(ctx, OtelLogQueue, 200)
}

func parseAnyValue(v *commonv1.AnyValue) interface{} {
	if v == nil {
		return nil
	}
	if v.Value == nil {
		return nil
	}

	switch val := v.Value.(type) {
	case *commonv1.AnyValue_StringValue:
		return val.StringValue
	case *commonv1.AnyValue_BoolValue:
		return val.BoolValue
	case *commonv1.AnyValue_IntValue:
		return val.IntValue
	case *commonv1.AnyValue_DoubleValue:
		return val.DoubleValue
	case *commonv1.AnyValue_ArrayValue:
		var arr []interface{}
		for _, item := range val.ArrayValue.Values {
			arr = append(arr, parseAnyValue(item))
		}
		return arr
	case *commonv1.AnyValue_KvlistValue:
		m := make(map[string]interface{})
		for _, kv := range val.KvlistValue.Values {
			m[kv.Key] = parseAnyValue(kv.Value)
		}
		return m
	case *commonv1.AnyValue_BytesValue:
		return val.BytesValue
	}
	return nil
}

func extractAttributes(attrs []*commonv1.KeyValue) map[string]interface{} {
	m := make(map[string]interface{})
	for _, kv := range attrs {
		m[kv.Key] = parseAnyValue(kv.Value)
	}
	return m
}

func bytesToHex(b []byte) string {
	const hexDigits = "0123456789abcdef"
	res := make([]byte, len(b)*2)
	for i, v := range b {
		res[i*2] = hexDigits[v>>4]
		res[i*2+1] = hexDigits[v&0x0f]
	}
	return string(res)
}

func ReceiveOtelTraces(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(400, gin.H{"error": "failed to read body"})
		return
	}

	var req collectortracev1.ExportTraceServiceRequest
	if err := protojson.Unmarshal(body, &req); err != nil {
		if errProto := proto.Unmarshal(body, &req); errProto != nil {
			log.Printf("Failed to unmarshal trace payload (both JSON and Proto failed). JSON err: %v", err)
			c.JSON(400, gin.H{"error": "failed to decode OTLP payload"})
			return
		}
	}

	for _, resourceSpan := range req.ResourceSpans {
		resAttrs := extractAttributes(resourceSpan.Resource.Attributes)
		resAttrsJSON, _ := json.Marshal(resAttrs)

		for _, scopeSpan := range resourceSpan.ScopeSpans {
			for _, span := range scopeSpan.Spans {
				attrs := extractAttributes(span.Attributes)
				attrsJSON, _ := json.Marshal(attrs)

				otelSpan := &models.OtelSpan{
					TraceID:       bytesToHex(span.TraceId),
					SpanID:        bytesToHex(span.SpanId),
					ParentSpanID:  bytesToHex(span.ParentSpanId),
					Name:          span.Name,
					Kind:          int(span.Kind),
					StartTimeUnix: int64(span.StartTimeUnixNano),
					EndTimeUnix:   int64(span.EndTimeUnixNano),
					DurationNs:    int64(span.EndTimeUnixNano - span.StartTimeUnixNano),
					Attributes:    datatypes.JSON(attrsJSON),
					ResourceAttrs: datatypes.JSON(resAttrsJSON),
				}

				if span.Status != nil {
					otelSpan.StatusCode = int(span.Status.Code)
					otelSpan.StatusMessage = span.Status.Message
				}

				// Materialize OpenClaw specific fields
				if model, ok := attrs["model"].(string); ok {
					otelSpan.Model = model
				}
				if provider, ok := attrs["provider"].(string); ok {
					otelSpan.Provider = provider
				}
				if toolName, ok := attrs["tool_name"].(string); ok {
					otelSpan.ToolName = toolName
				}

				// Token parsing (handle both float64 and int depending on json unmarshaling / any value parsing)
				if prompt, ok := attrs["prompt_tokens"]; ok {
					switch v := prompt.(type) {
					case int64:
						otelSpan.PromptTokens = int(v)
					case float64:
						otelSpan.PromptTokens = int(v)
					}
				}
				if comp, ok := attrs["completion_tokens"]; ok {
					switch v := comp.(type) {
					case int64:
						otelSpan.CompletionTokens = int(v)
					case float64:
						otelSpan.CompletionTokens = int(v)
					}
				}
				if total, ok := attrs["total_tokens"]; ok {
					switch v := total.(type) {
					case int64:
						otelSpan.TotalTokens = int(v)
					case float64:
						otelSpan.TotalTokens = int(v)
					}
				}

				// Cost parsing
				if cost, ok := attrs["cost_usd"]; ok {
					switch v := cost.(type) {
					case float64:
						otelSpan.CostUsd = v
					case int64:
						otelSpan.CostUsd = float64(v)
					}
				}

				select {
				case OtelSpanQueue <- otelSpan:
				default:
					log.Printf("Warning: OtelSpanQueue full, dropping span %s", otelSpan.SpanID)
				}
			}
		}
	}

	// OTLP success response
	c.Data(200, "application/x-protobuf", nil)
}

func ReceiveOtelMetrics(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(400, gin.H{"error": "failed to read body"})
		return
	}

	var req collectormetricsv1.ExportMetricsServiceRequest
	// Try JSON unmarshal first, since OTLP/HTTP usually defaults to JSON
	if err := protojson.Unmarshal(body, &req); err != nil {
		// Fallback to proto
		if errProto := proto.Unmarshal(body, &req); errProto != nil {
			log.Printf("Failed to unmarshal metrics payload (both JSON and Proto failed). JSON err: %v", err)
			c.JSON(400, gin.H{"error": "failed to decode OTLP payload"})
			return
		}
	}

	for _, resourceMetric := range req.ResourceMetrics {
		resAttrs := extractAttributes(resourceMetric.Resource.Attributes)
		resAttrsJSON, _ := json.Marshal(resAttrs)

		for _, scopeMetric := range resourceMetric.ScopeMetrics {
			for _, metric := range scopeMetric.Metrics {

				var mType string
				var dataPoints interface{}

				// Extract datapoints based on metric type
				switch d := metric.Data.(type) {
				case *metricsv1.Metric_Gauge:
					mType = "Gauge"
					dataPoints = d.Gauge.DataPoints
				case *metricsv1.Metric_Sum:
					mType = "Sum"
					dataPoints = d.Sum.DataPoints
				case *metricsv1.Metric_Histogram:
					mType = "Histogram"
					dataPoints = d.Histogram.DataPoints
				case *metricsv1.Metric_ExponentialHistogram:
					mType = "ExponentialHistogram"
					dataPoints = d.ExponentialHistogram.DataPoints
				case *metricsv1.Metric_Summary:
					mType = "Summary"
					dataPoints = d.Summary.DataPoints
				}

				dataPointsJSON, _ := json.Marshal(dataPoints)

				otelMetric := &models.OtelMetric{
					Name:          metric.Name,
					Description:   metric.Description,
					Unit:          metric.Unit,
					Type:          mType,
					DataPoints:    datatypes.JSON(dataPointsJSON),
					ResourceAttrs: datatypes.JSON(resAttrsJSON),
				}

				select {
				case OtelMetricQueue <- otelMetric:
				default:
					log.Printf("Warning: OtelMetricQueue full, dropping metric %s", metric.Name)
				}
			}
		}
	}

	c.Data(200, "application/x-protobuf", nil)
}

func ReceiveOtelLogs(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(400, gin.H{"error": "failed to read body"})
		return
	}

	var req collectorlogsv1.ExportLogsServiceRequest
	if err := protojson.Unmarshal(body, &req); err != nil {
		if errProto := proto.Unmarshal(body, &req); errProto != nil {
			log.Printf("Failed to unmarshal log payload (both JSON and Proto failed). JSON err: %v", err)
			c.JSON(400, gin.H{"error": "failed to decode OTLP payload"})
			return
		}
	}

	for _, resourceLog := range req.ResourceLogs {
		resAttrs := extractAttributes(resourceLog.Resource.Attributes)
		resAttrsJSON, _ := json.Marshal(resAttrs)

		for _, scopeLog := range resourceLog.ScopeLogs {
			for _, logRecord := range scopeLog.LogRecords {
				attrs := extractAttributes(logRecord.Attributes)
				attrsJSON, _ := json.Marshal(attrs)

				var bodyStr string
				if logRecord.Body != nil {
					if strVal := logRecord.Body.GetStringValue(); strVal != "" {
						bodyStr = strVal
					} else {
						// fallback to JSON serialization for complex bodies
						bodyJSON, _ := json.Marshal(parseAnyValue(logRecord.Body))
						bodyStr = string(bodyJSON)
					}
				}

				otelLog := &models.OtelLog{
					TraceID:        bytesToHex(logRecord.TraceId),
					SpanID:         bytesToHex(logRecord.SpanId),
					TimestampUnix:  int64(logRecord.TimeUnixNano),
					SeverityText:   logRecord.SeverityText,
					SeverityNumber: int(logRecord.SeverityNumber),
					Body:           bodyStr,
					Attributes:     datatypes.JSON(attrsJSON),
					ResourceAttrs:  datatypes.JSON(resAttrsJSON),
				}

				select {
				case OtelLogQueue <- otelLog:
				default:
					log.Printf("Warning: OtelLogQueue full, dropping log")
				}
			}
		}
	}

	c.Data(200, "application/x-protobuf", nil)
}
