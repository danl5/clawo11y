package watcher

import (
	"testing"

	"github.com/danl5/clawo11y/services/agent/schemas"
)

func TestEnrichWithUsageReadsTopLevelFields(t *testing.T) {
	w := &SessionWatcher{}
	payload := &schemas.AgentEventPayload{}

	w.enrichWithUsage(map[string]any{
		"input_tokens":  float64(12),
		"output_tokens": float64(34),
		"cache_read":    float64(5),
		"cache_write":   float64(6),
		"cost_usd":      float64(0.123),
	}, payload)

	if payload.InputTokens != 12 || payload.OutputTokens != 34 {
		t.Fatalf("unexpected token counts: %+v", payload)
	}
	if payload.CacheRead != 5 || payload.CacheWrite != 6 {
		t.Fatalf("unexpected cache counts: %+v", payload)
	}
	if payload.CostUSD != 0.123 {
		t.Fatalf("unexpected cost: %+v", payload)
	}
}

func TestEnrichWithUsageFallsBackToNestedInputOutputShape(t *testing.T) {
	w := &SessionWatcher{}
	payload := &schemas.AgentEventPayload{}

	w.enrichWithUsage(map[string]any{
		"usage": map[string]any{
			"input":      float64(21),
			"output":     float64(8),
			"cacheRead":  float64(3),
			"cacheWrite": float64(4),
			"cost": map[string]any{
				"total": float64(1.75),
			},
		},
	}, payload)

	if payload.InputTokens != 21 || payload.OutputTokens != 8 {
		t.Fatalf("expected nested input/output usage to be parsed, got %+v", payload)
	}
	if payload.CacheRead != 3 || payload.CacheWrite != 4 {
		t.Fatalf("expected nested cache usage to be parsed, got %+v", payload)
	}
	if payload.CostUSD != 1.75 {
		t.Fatalf("expected nested cost total to be parsed, got %+v", payload)
	}
}

func TestEnrichWithUsageSupportsAnthropicStyleTokenNames(t *testing.T) {
	w := &SessionWatcher{}
	payload := &schemas.AgentEventPayload{}

	w.enrichWithUsage(map[string]any{
		"usage": map[string]any{
			"input_tokens":       float64(34),
			"output_tokens":      float64(46),
			"cache_read_tokens":  float64(7),
			"cache_write_tokens": float64(9),
			"cost_usd":           float64(2.5),
		},
	}, payload)

	if payload.InputTokens != 34 || payload.OutputTokens != 46 {
		t.Fatalf("expected anthropic-style tokens to be parsed, got %+v", payload)
	}
	if payload.CacheRead != 7 || payload.CacheWrite != 9 {
		t.Fatalf("expected anthropic-style cache values, got %+v", payload)
	}
	if payload.CostUSD != 2.5 {
		t.Fatalf("expected anthropic-style cost_usd, got %+v", payload)
	}
}

func TestEnrichWithUsageDoesNotOverrideNonZeroTopLevelValues(t *testing.T) {
	w := &SessionWatcher{}
	payload := &schemas.AgentEventPayload{}

	w.enrichWithUsage(map[string]any{
		"input_tokens":  float64(10),
		"output_tokens": float64(20),
		"cost_usd":      float64(0.5),
		"usage": map[string]any{
			"input_tokens":  float64(999),
			"output_tokens": float64(999),
			"cost_usd":      float64(9.99),
		},
	}, payload)

	if payload.InputTokens != 10 || payload.OutputTokens != 20 {
		t.Fatalf("expected top-level values to win, got %+v", payload)
	}
	if payload.CostUSD != 0.5 {
		t.Fatalf("expected top-level cost to win, got %+v", payload)
	}
}

func TestClassifyEvent(t *testing.T) {
	w := &SessionWatcher{}

	if got := w.classifyEvent(map[string]any{"type": "tool_call"}); got != "tool_call" {
		t.Fatalf("expected explicit type, got %q", got)
	}
	if got := w.classifyEvent(map[string]any{"role": "assistant"}); got != "message" {
		t.Fatalf("expected assistant role to map to message, got %q", got)
	}
	if got := w.classifyEvent(map[string]any{"role": "unknown"}); got != "custom" {
		t.Fatalf("expected unknown role to map to custom, got %q", got)
	}
}

func TestEnrichWithToolAndModel(t *testing.T) {
	w := &SessionWatcher{}
	payload := &schemas.AgentEventPayload{}

	w.enrichWithTool(map[string]any{
		"message": map[string]any{
			"content": []any{
				map[string]any{"type": "text", "text": "hello"},
				map[string]any{"type": "toolCall", "name": "web_search"},
				map[string]any{"type": "toolCall", "name": "read_file"},
			},
		},
	}, payload)
	w.enrichWithModel(map[string]any{
		"model":    "MiniMax-M2.7-highspeed",
		"provider": "minimax-portal",
	}, payload)

	if payload.ToolName != "web_search, read_file" {
		t.Fatalf("expected extracted tool list, got %q", payload.ToolName)
	}
	if payload.Model != "MiniMax-M2.7-highspeed" || payload.Provider != "minimax-portal" {
		t.Fatalf("expected model/provider to be set, got %+v", payload)
	}
}
