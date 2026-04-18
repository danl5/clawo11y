package api

import (
	"encoding/json"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/danl5/clawo11y/services/server/database"
	"github.com/danl5/clawo11y/services/server/models"
)

func parseJSONMap(raw []byte) map[string]interface{} {
	if len(raw) == 0 {
		return map[string]interface{}{}
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return map[string]interface{}{}
	}
	return parsed
}

func getStringAttr(attrs map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if value, ok := attrs[key]; ok {
			if str, ok := value.(string); ok && str != "" {
				return str
			}
		}
	}
	return ""
}

func getIntAttr(attrs map[string]interface{}, keys ...string) int {
	for _, key := range keys {
		if value, ok := attrs[key]; ok {
			switch v := value.(type) {
			case float64:
				return int(v)
			case int:
				return v
			case int64:
				return int(v)
			}
		}
	}
	return 0
}

func getFloatAttr(attrs map[string]interface{}, keys ...string) float64 {
	for _, key := range keys {
		if value, ok := attrs[key]; ok {
			switch v := value.(type) {
			case float64:
				return v
			case int:
				return float64(v)
			case int64:
				return float64(v)
			}
		}
	}
	return 0
}

func percentile(sortedValues []float64, p float64) float64 {
	if len(sortedValues) == 0 {
		return 0
	}
	if len(sortedValues) == 1 {
		return sortedValues[0]
	}
	if p <= 0 {
		return sortedValues[0]
	}
	if p >= 1 {
		return sortedValues[len(sortedValues)-1]
	}
	position := p * float64(len(sortedValues)-1)
	lower := int(math.Floor(position))
	upper := int(math.Ceil(position))
	if lower == upper {
		return sortedValues[lower]
	}
	weight := position - float64(lower)
	return sortedValues[lower] + (sortedValues[upper]-sortedValues[lower])*weight
}

// GetCostDashboard returns aggregate cost and token data
func GetCostDashboard(c *gin.Context) {
	cutoffDate := time.Now().AddDate(0, 0, -7)

	type CostSummary struct {
		WindowDays       int     `json:"window_days"`
		TotalCostUsd     float64 `json:"total_cost_usd"`
		TotalCalls       int     `json:"total_calls"`
		TotalTokens      int     `json:"total_tokens"`
		AvgCostPerCall   float64 `json:"avg_cost_per_call"`
		AvgTokensPerCall float64 `json:"avg_tokens_per_call"`
	}

	type ModelStats struct {
		Model          string  `json:"model"`
		Provider       string  `json:"provider"`
		TotalTokens    int     `json:"total_tokens"`
		PromptTokens   int     `json:"prompt_tokens"`
		CompTokens     int     `json:"completion_tokens"`
		TotalCost      float64 `json:"total_cost_usd"`
		Calls          int     `json:"calls"`
		AvgCostPerCall float64 `json:"avg_cost_per_call"`
	}

	type ProviderStats struct {
		Provider       string  `json:"provider"`
		TotalCostUsd   float64 `json:"total_cost_usd"`
		TotalTokens    int     `json:"total_tokens"`
		Calls          int     `json:"calls"`
		AvgCostPerCall float64 `json:"avg_cost_per_call"`
	}

	var stats []ModelStats
	err := database.DB.Model(&models.OtelSpan{}).
		Select("model, provider, sum(total_tokens) as total_tokens, sum(prompt_tokens) as prompt_tokens, sum(completion_tokens) as comp_tokens, sum(cost_usd) as total_cost, count(*) as calls").
		Where("model != '' AND created_at > ?", cutoffDate).
		Group("model, provider").
		Order("total_cost DESC").
		Scan(&stats).Error

	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to aggregate cost data"})
		return
	}

	summary := CostSummary{WindowDays: 7}
	for i := range stats {
		summary.TotalCostUsd += stats[i].TotalCost
		summary.TotalCalls += stats[i].Calls
		summary.TotalTokens += stats[i].TotalTokens
		if stats[i].Calls > 0 {
			stats[i].AvgCostPerCall = stats[i].TotalCost / float64(stats[i].Calls)
		}
	}
	if summary.TotalCalls > 0 {
		summary.AvgCostPerCall = summary.TotalCostUsd / float64(summary.TotalCalls)
		summary.AvgTokensPerCall = float64(summary.TotalTokens) / float64(summary.TotalCalls)
	}

	var providers []ProviderStats
	err = database.DB.Model(&models.OtelSpan{}).
		Select("provider, sum(total_tokens) as total_tokens, sum(cost_usd) as total_cost_usd, count(*) as calls").
		Where("provider != '' AND created_at > ?", cutoffDate).
		Group("provider").
		Order("total_cost_usd DESC").
		Scan(&providers).Error
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to aggregate provider cost data"})
		return
	}
	for i := range providers {
		if providers[i].Calls > 0 {
			providers[i].AvgCostPerCall = providers[i].TotalCostUsd / float64(providers[i].Calls)
		}
	}

	type DailyCost struct {
		Date string `json:"date"`
	}

	type DailyProviderCost struct {
		Date     string  `json:"date"`
		Provider string  `json:"provider"`
		Cost     float64 `json:"cost"`
	}

	var providerRows []DailyProviderCost
	err = database.DB.Model(&models.OtelSpan{}).
		Select("date(created_at) as date, provider, sum(cost_usd) as cost").
		Where("cost_usd > 0 AND created_at > ?", cutoffDate).
		Group("date(created_at), provider").
		Order("date ASC, provider ASC").
		Scan(&providerRows).Error

	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to aggregate provider cost trend"})
		return
	}

	providerKeysMap := map[string]bool{}
	trendRows := map[string]map[string]interface{}{}
	for _, row := range providerRows {
		if _, ok := trendRows[row.Date]; !ok {
			trendRows[row.Date] = map[string]interface{}{
				"date":  row.Date,
				"total": 0.0,
			}
		}
		trendRows[row.Date][row.Provider] = row.Cost
		trendRows[row.Date]["total"] = trendRows[row.Date]["total"].(float64) + row.Cost
		providerKeysMap[row.Provider] = true
	}
	providerKeys := make([]string, 0, len(providerKeysMap))
	for provider := range providerKeysMap {
		providerKeys = append(providerKeys, provider)
	}
	sort.Strings(providerKeys)

	dates := make([]string, 0, len(trendRows))
	for date := range trendRows {
		dates = append(dates, date)
	}
	sort.Strings(dates)
	daily := make([]map[string]interface{}, 0, len(dates))
	for _, date := range dates {
		row := trendRows[date]
		for _, provider := range providerKeys {
			if _, ok := row[provider]; !ok {
				row[provider] = 0.0
			}
		}
		daily = append(daily, row)
	}

	type TopRun struct {
		TraceID            string    `json:"trace_id"`
		SessionID          string    `json:"session_id"`
		RunLineageID       string    `json:"run_lineage_id"`
		ParentRunLineageID string    `json:"parent_run_lineage_id"`
		RootRunLineageID   string    `json:"root_run_lineage_id"`
		UserMessage        string    `json:"user_message"`
		Status             string    `json:"status"`
		DurationMs         float64   `json:"duration_ms"`
		TotalCostUsd       float64   `json:"total_cost_usd"`
		TotalTokens        int       `json:"total_tokens"`
		LLMCalls           int       `json:"llm_calls"`
		ToolCalls          int       `json:"tool_calls"`
		SubagentCalls      int       `json:"subagent_calls"`
		LastModel          string    `json:"last_model"`
		CreatedAt          time.Time `json:"created_at"`
	}

	var rootSpans []models.OtelSpan
	err = database.DB.Where("parent_span_id = '' AND created_at > ?", cutoffDate).
		Order("created_at DESC").
		Limit(300).
		Find(&rootSpans).Error
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to fetch expensive runs"})
		return
	}

	topRuns := make([]TopRun, 0, len(rootSpans))
	for _, span := range rootSpans {
		attrs := parseJSONMap(span.Attributes)
		run := TopRun{
			TraceID:            span.TraceID,
			SessionID:          getStringAttr(attrs, "session_id"),
			RunLineageID:       getStringAttr(attrs, "run_lineage_id"),
			ParentRunLineageID: getStringAttr(attrs, "parent_run_lineage_id"),
			RootRunLineageID:   getStringAttr(attrs, "root_run_lineage_id"),
			UserMessage:        getStringAttr(attrs, "user_message"),
			Status:             getStringAttr(attrs, "run_status"),
			DurationMs:         getFloatAttr(attrs, "duration_ms"),
			TotalCostUsd:       getFloatAttr(attrs, "total_cost_usd"),
			TotalTokens:        getIntAttr(attrs, "total_tokens"),
			LLMCalls:           getIntAttr(attrs, "run_llm_call_count"),
			ToolCalls:          getIntAttr(attrs, "run_tool_call_count"),
			SubagentCalls:      getIntAttr(attrs, "run_subagent_call_count"),
			LastModel:          getStringAttr(attrs, "last_model"),
			CreatedAt:          span.CreatedAt,
		}
		if run.Status == "" {
			if span.StatusCode == 2 {
				run.Status = "error"
			} else {
				run.Status = "ok"
			}
		}
		if run.DurationMs == 0 && span.DurationNs > 0 {
			run.DurationMs = float64(span.DurationNs) / 1e6
		}
		if run.TotalCostUsd == 0 && span.CostUsd > 0 {
			run.TotalCostUsd = span.CostUsd
		}
		if run.TotalTokens == 0 && span.TotalTokens > 0 {
			run.TotalTokens = span.TotalTokens
		}
		topRuns = append(topRuns, run)
	}
	sort.Slice(topRuns, func(i, j int) bool {
		if topRuns[i].TotalCostUsd == topRuns[j].TotalCostUsd {
			return topRuns[i].CreatedAt.After(topRuns[j].CreatedAt)
		}
		return topRuns[i].TotalCostUsd > topRuns[j].TotalCostUsd
	})
	if len(topRuns) > 12 {
		topRuns = topRuns[:12]
	}

	type ToolReliability struct {
		ToolName      string  `json:"tool_name"`
		Calls         int     `json:"calls"`
		Errors        int     `json:"errors"`
		ErrorRate     float64 `json:"error_rate"`
		AvgDurationMs float64 `json:"avg_duration_ms"`
		P95DurationMs float64 `json:"p95_duration_ms"`
		MaxDurationMs float64 `json:"max_duration_ms"`
	}

	var toolSpans []models.OtelSpan
	err = database.DB.Where("tool_name != '' AND created_at > ?", cutoffDate).
		Order("created_at DESC").
		Find(&toolSpans).Error
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to fetch tool spans"})
		return
	}

	type toolAccumulator struct {
		calls     int
		errors    int
		totalMs   float64
		maxMs     float64
		durations []float64
	}
	toolMap := map[string]*toolAccumulator{}
	for _, span := range toolSpans {
		if _, ok := toolMap[span.ToolName]; !ok {
			toolMap[span.ToolName] = &toolAccumulator{}
		}
		item := toolMap[span.ToolName]
		item.calls++
		if span.StatusCode == 2 {
			item.errors++
		}
		durationMs := float64(span.DurationNs) / 1e6
		item.totalMs += durationMs
		item.durations = append(item.durations, durationMs)
		if durationMs > item.maxMs {
			item.maxMs = durationMs
		}
	}

	toolReliability := make([]ToolReliability, 0, len(toolMap))
	for toolName, item := range toolMap {
		sort.Float64s(item.durations)
		reliability := ToolReliability{
			ToolName:      toolName,
			Calls:         item.calls,
			Errors:        item.errors,
			AvgDurationMs: 0,
			P95DurationMs: percentile(item.durations, 0.95),
			MaxDurationMs: item.maxMs,
		}
		if item.calls > 0 {
			reliability.AvgDurationMs = item.totalMs / float64(item.calls)
			reliability.ErrorRate = float64(item.errors) / float64(item.calls)
		}
		toolReliability = append(toolReliability, reliability)
	}
	sort.Slice(toolReliability, func(i, j int) bool {
		if toolReliability[i].ErrorRate == toolReliability[j].ErrorRate {
			return toolReliability[i].P95DurationMs > toolReliability[j].P95DurationMs
		}
		return toolReliability[i].ErrorRate > toolReliability[j].ErrorRate
	})
	if len(toolReliability) > 12 {
		toolReliability = toolReliability[:12]
	}

	c.JSON(200, gin.H{
		"summary":          summary,
		"models":           stats,
		"providers":        providers,
		"trend":            daily,
		"provider_keys":    providerKeys,
		"top_runs":         topRuns,
		"tool_reliability": toolReliability,
	})
}

// GetTraceTree returns a nested span tree for a given trace_id
func GetTraceTree(c *gin.Context) {
	traceID := c.Param("trace_id")

	var spans []models.OtelSpan
	if err := database.DB.Where("trace_id = ?", traceID).Order("start_time_unix ASC").Find(&spans).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to fetch trace spans"})
		return
	}

	if len(spans) == 0 {
		c.JSON(404, gin.H{"error": "Trace not found"})
		return
	}

	// Build the tree
	type SpanNode struct {
		models.OtelSpan
		Children []*SpanNode `json:"children"`
	}

	nodes := make(map[string]*SpanNode)
	for i := range spans {
		nodes[spans[i].SpanID] = &SpanNode{OtelSpan: spans[i], Children: make([]*SpanNode, 0)}
	}

	var rootNodes []*SpanNode

	for _, span := range spans {
		node := nodes[span.SpanID]
		if span.ParentSpanID == "" {
			rootNodes = append(rootNodes, node)
		} else {
			if parent, ok := nodes[span.ParentSpanID]; ok {
				parent.Children = append(parent.Children, node)
			} else {
				// Fallback if parent is missing in DB
				rootNodes = append(rootNodes, node)
			}
		}
	}

	c.JSON(200, rootNodes)
}

// GetRecentTraces returns a list of recent root traces
func GetRecentTraces(c *gin.Context) {
	var spans []models.OtelSpan

	// We consider spans without a parent as "root" traces, which represent a session/request
	err := database.DB.Where("parent_span_id = ''").
		Order("created_at DESC").
		Limit(50).
		Find(&spans).Error

	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to fetch recent traces"})
		return
	}

	c.JSON(200, spans)
}

// GetRelatedRuns returns root traces that belong to the same lineage root.
func GetRelatedRuns(c *gin.Context) {
	rootRunLineageID := strings.TrimSpace(c.Param("root_run_lineage_id"))
	if rootRunLineageID == "" {
		c.JSON(400, gin.H{"error": "root_run_lineage_id is required"})
		return
	}

	var spans []models.OtelSpan
	err := database.DB.Where("parent_span_id = ''").
		Order("created_at ASC").
		Find(&spans).Error
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to fetch related runs"})
		return
	}

	relatedRuns := make([]models.OtelSpan, 0)
	for _, span := range spans {
		attrs := parseJSONMap(span.Attributes)
		spanRootRunLineageID := getStringAttr(attrs, "root_run_lineage_id")
		spanRunLineageID := getStringAttr(attrs, "run_lineage_id")
		if spanRootRunLineageID == rootRunLineageID || (spanRootRunLineageID == "" && spanRunLineageID == rootRunLineageID) {
			relatedRuns = append(relatedRuns, span)
		}
	}

	if len(relatedRuns) == 0 {
		c.JSON(404, gin.H{"error": "Related runs not found"})
		return
	}

	c.JSON(200, relatedRuns)
}

// GetMetricsDashboard returns recent metric data points grouped by metric name
func GetMetricsDashboard(c *gin.Context) {
	cutoffDate := time.Now().Add(-1 * time.Hour) // Last 1 hour of metrics

	var metrics []models.OtelMetric
	err := database.DB.Where("created_at > ?", cutoffDate).
		Order("created_at ASC").
		Find(&metrics).Error

	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to fetch metrics"})
		return
	}

	// Group by metric name
	type MetricSeries struct {
		Name        string                   `json:"name"`
		Description string                   `json:"description"`
		Unit        string                   `json:"unit"`
		Type        string                   `json:"type"`
		Data        []map[string]interface{} `json:"data"`
	}

	seriesMap := make(map[string]*MetricSeries)

	for _, m := range metrics {
		if _, ok := seriesMap[m.Name]; !ok {
			seriesMap[m.Name] = &MetricSeries{
				Name:        m.Name,
				Description: m.Description,
				Unit:        m.Unit,
				Type:        m.Type,
				Data:        make([]map[string]interface{}, 0),
			}
		}

		seriesMap[m.Name].Data = append(seriesMap[m.Name].Data, map[string]interface{}{
			"id":             m.ID,
			"created_at":     m.CreatedAt,
			"data_points":    m.DataPoints,
			"resource_attrs": m.ResourceAttrs,
		})
	}

	var result []MetricSeries
	for _, v := range seriesMap {
		result = append(result, *v)
	}

	c.JSON(200, result)
}

// GetRecentLogs returns a list of recent OTel logs
func GetRecentLogs(c *gin.Context) {
	var logs []models.OtelLog

	err := database.DB.Order("timestamp_unix DESC").
		Limit(200).
		Find(&logs).Error

	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to fetch recent logs"})
		return
	}

	c.JSON(200, logs)
}

// GetOtelOverview returns business-oriented aggregates for turns, models, tools, subagents, and logs.
func GetOtelOverview(c *gin.Context) {
	cutoffDate := time.Now().Add(-24 * time.Hour)

	type OverviewSummary struct {
		WindowHours      int     `json:"window_hours"`
		TotalRuns        int     `json:"total_runs"`
		ErroredRuns      int     `json:"errored_runs"`
		AvgRunDurationMs float64 `json:"avg_run_duration_ms"`
		TotalTokens      int     `json:"total_tokens"`
		TotalCostUsd     float64 `json:"total_cost_usd"`
	}

	type RecentRun struct {
		TraceID            string    `json:"trace_id"`
		SessionID          string    `json:"session_id"`
		RunLineageID       string    `json:"run_lineage_id"`
		ParentRunLineageID string    `json:"parent_run_lineage_id"`
		RootRunLineageID   string    `json:"root_run_lineage_id"`
		Name               string    `json:"name"`
		UserMessage        string    `json:"user_message"`
		Status             string    `json:"status"`
		CloseReason        string    `json:"close_reason"`
		DurationMs         float64   `json:"duration_ms"`
		TotalCostUsd       float64   `json:"total_cost_usd"`
		TotalTokens        int       `json:"total_tokens"`
		LLMCalls           int       `json:"llm_calls"`
		ToolCalls          int       `json:"tool_calls"`
		SubagentCalls      int       `json:"subagent_calls"`
		LastModel          string    `json:"last_model"`
		LastProvider       string    `json:"last_provider"`
		ErrorType          string    `json:"error_type"`
		ErrorMessage       string    `json:"error_message"`
		CreatedAt          time.Time `json:"created_at"`
	}

	type ModelBreakdown struct {
		Model         string  `json:"model"`
		Provider      string  `json:"provider"`
		Calls         int     `json:"calls"`
		Errors        int     `json:"errors"`
		TotalTokens   int     `json:"total_tokens"`
		TotalCostUsd  float64 `json:"total_cost_usd"`
		AvgDurationMs float64 `json:"avg_duration_ms"`
	}

	type ToolBreakdown struct {
		ToolName      string  `json:"tool_name"`
		Calls         int     `json:"calls"`
		Errors        int     `json:"errors"`
		AvgDurationMs float64 `json:"avg_duration_ms"`
		MaxDurationMs float64 `json:"max_duration_ms"`
	}

	type SubagentBreakdown struct {
		Label         string  `json:"label"`
		Mode          string  `json:"mode"`
		Calls         int     `json:"calls"`
		Errors        int     `json:"errors"`
		AvgDurationMs float64 `json:"avg_duration_ms"`
	}

	type LogEventBreakdown struct {
		EventName string `json:"event_name"`
		Count     int    `json:"count"`
	}

	var rootSpans []models.OtelSpan
	if err := database.DB.Where("parent_span_id = '' AND created_at > ?", cutoffDate).
		Order("created_at DESC").
		Limit(100).
		Find(&rootSpans).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to fetch recent runs"})
		return
	}

	summary := OverviewSummary{WindowHours: 24}
	recentRuns := make([]RecentRun, 0, len(rootSpans))
	totalDurationMs := 0.0

	for _, span := range rootSpans {
		attrs := parseJSONMap(span.Attributes)
		status := getStringAttr(attrs, "run_status")
		if status == "" {
			if span.StatusCode == 2 {
				status = "error"
			} else {
				status = "ok"
			}
		}
		durationMs := getFloatAttr(attrs, "duration_ms")
		if durationMs == 0 && span.DurationNs > 0 {
			durationMs = float64(span.DurationNs) / 1e6
		}
		totalCostUsd := getFloatAttr(attrs, "total_cost_usd")
		if totalCostUsd == 0 && span.CostUsd > 0 {
			totalCostUsd = span.CostUsd
		}
		totalTokens := getIntAttr(attrs, "total_tokens")
		if totalTokens == 0 && span.TotalTokens > 0 {
			totalTokens = span.TotalTokens
		}

		run := RecentRun{
			TraceID:            span.TraceID,
			SessionID:          getStringAttr(attrs, "session_id"),
			RunLineageID:       getStringAttr(attrs, "run_lineage_id"),
			ParentRunLineageID: getStringAttr(attrs, "parent_run_lineage_id"),
			RootRunLineageID:   getStringAttr(attrs, "root_run_lineage_id"),
			Name:               span.Name,
			UserMessage:        getStringAttr(attrs, "user_message"),
			Status:             status,
			CloseReason:        getStringAttr(attrs, "run_close_reason"),
			DurationMs:         durationMs,
			TotalCostUsd:       totalCostUsd,
			TotalTokens:        totalTokens,
			LLMCalls:           getIntAttr(attrs, "run_llm_call_count"),
			ToolCalls:          getIntAttr(attrs, "run_tool_call_count"),
			SubagentCalls:      getIntAttr(attrs, "run_subagent_call_count"),
			LastModel:          getStringAttr(attrs, "last_model"),
			LastProvider:       getStringAttr(attrs, "last_provider"),
			ErrorType:          getStringAttr(attrs, "error_type"),
			ErrorMessage:       getStringAttr(attrs, "error"),
			CreatedAt:          span.CreatedAt,
		}
		recentRuns = append(recentRuns, run)

		summary.TotalRuns++
		if status == "error" {
			summary.ErroredRuns++
		}
		summary.TotalTokens += totalTokens
		summary.TotalCostUsd += totalCostUsd
		totalDurationMs += durationMs
	}

	if summary.TotalRuns > 0 {
		summary.AvgRunDurationMs = totalDurationMs / float64(summary.TotalRuns)
	}

	var modelsData []ModelBreakdown
	if err := database.DB.Model(&models.OtelSpan{}).
		Select(`
			model,
			provider,
			count(*) as calls,
			sum(case when status_code = 2 then 1 else 0 end) as errors,
			sum(total_tokens) as total_tokens,
			sum(cost_usd) as total_cost_usd,
			avg(duration_ns) / 1000000.0 as avg_duration_ms
		`).
		Where("model != '' AND created_at > ?", cutoffDate).
		Group("model, provider").
		Order("total_cost_usd DESC").
		Limit(8).
		Scan(&modelsData).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to aggregate model data"})
		return
	}

	var toolsData []ToolBreakdown
	if err := database.DB.Model(&models.OtelSpan{}).
		Select(`
			tool_name,
			count(*) as calls,
			sum(case when status_code = 2 then 1 else 0 end) as errors,
			avg(duration_ns) / 1000000.0 as avg_duration_ms,
			max(duration_ns) / 1000000.0 as max_duration_ms
		`).
		Where("tool_name != '' AND created_at > ?", cutoffDate).
		Group("tool_name").
		Order("calls DESC").
		Limit(8).
		Scan(&toolsData).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to aggregate tool data"})
		return
	}

	var subagentSpans []models.OtelSpan
	if err := database.DB.Where("name LIKE ? AND created_at > ?", "subagent:%", cutoffDate).
		Order("created_at DESC").
		Limit(200).
		Find(&subagentSpans).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to fetch subagent spans"})
		return
	}

	subagentMap := make(map[string]*SubagentBreakdown)
	for _, span := range subagentSpans {
		attrs := parseJSONMap(span.Attributes)
		label := getStringAttr(attrs, "subagent.label", "subagent.agent_id")
		if label == "" {
			label = strings.TrimPrefix(span.Name, "subagent:")
		}
		mode := getStringAttr(attrs, "subagent.mode")
		if mode == "" {
			mode = "unknown"
		}
		key := label + "::" + mode
		if _, ok := subagentMap[key]; !ok {
			subagentMap[key] = &SubagentBreakdown{
				Label: label,
				Mode:  mode,
			}
		}
		item := subagentMap[key]
		item.Calls++
		if span.StatusCode == 2 || getStringAttr(attrs, "subagent.error_type") != "" {
			item.Errors++
		}
		item.AvgDurationMs += float64(span.DurationNs) / 1e6
	}

	subagents := make([]SubagentBreakdown, 0, len(subagentMap))
	for _, item := range subagentMap {
		if item.Calls > 0 {
			item.AvgDurationMs = item.AvgDurationMs / float64(item.Calls)
		}
		subagents = append(subagents, *item)
	}
	sort.Slice(subagents, func(i, j int) bool {
		if subagents[i].Calls == subagents[j].Calls {
			return subagents[i].AvgDurationMs > subagents[j].AvgDurationMs
		}
		return subagents[i].Calls > subagents[j].Calls
	})
	if len(subagents) > 8 {
		subagents = subagents[:8]
	}

	var recentLogs []models.OtelLog
	if err := database.DB.Where("created_at > ?", cutoffDate).
		Order("created_at DESC").
		Limit(300).
		Find(&recentLogs).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to fetch recent otel logs"})
		return
	}

	logEventMap := map[string]int{}
	for _, logItem := range recentLogs {
		attrs := parseJSONMap(logItem.Attributes)
		eventName := getStringAttr(attrs, "event_name")
		if eventName == "" {
			eventName = "unknown"
		}
		logEventMap[eventName]++
	}
	logEvents := make([]LogEventBreakdown, 0, len(logEventMap))
	for name, count := range logEventMap {
		logEvents = append(logEvents, LogEventBreakdown{EventName: name, Count: count})
	}
	sort.Slice(logEvents, func(i, j int) bool {
		if logEvents[i].Count == logEvents[j].Count {
			return logEvents[i].EventName < logEvents[j].EventName
		}
		return logEvents[i].Count > logEvents[j].Count
	})

	c.JSON(200, gin.H{
		"summary":     summary,
		"recent_runs": recentRuns,
		"models":      modelsData,
		"tools":       toolsData,
		"subagents":   subagents,
		"log_events":  logEvents,
	})
}

// GetOtelHealth returns observability-integrity signals derived from OTEL logs and root spans.
func GetOtelHealth(c *gin.Context) {
	cutoffDate := time.Now().Add(-24 * time.Hour)

	type HealthSummary struct {
		WindowHours         int `json:"window_hours"`
		AnomalyCount        int `json:"anomaly_count"`
		IdleTimeoutClosures int `json:"idle_timeout_closures"`
		RootRecreatedCount  int `json:"root_recreated_count"`
		OrphanEventCount    int `json:"orphan_event_count"`
		AgentEndWithoutRoot int `json:"agent_end_without_root"`
	}

	type BreakdownItem struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
	}

	type RecentAnomaly struct {
		Timestamp   time.Time `json:"timestamp"`
		Severity    string    `json:"severity"`
		EventName   string    `json:"event_name"`
		AnomalyType string    `json:"anomaly_type"`
		SessionID   string    `json:"session_id"`
		TraceID     string    `json:"trace_id"`
		Body        string    `json:"body"`
	}

	var logsData []models.OtelLog
	if err := database.DB.Where("created_at > ?", cutoffDate).
		Order("created_at DESC").
		Limit(500).
		Find(&logsData).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to fetch otel health logs"})
		return
	}

	summary := HealthSummary{WindowHours: 24}
	anomalyMap := map[string]int{}
	closeReasonMap := map[string]int{}
	recentAnomalies := make([]RecentAnomaly, 0, 20)

	for _, item := range logsData {
		attrs := parseJSONMap(item.Attributes)
		eventName := getStringAttr(attrs, "event_name")
		anomalyType := getStringAttr(attrs, "anomaly_type")
		if anomalyType == "" && strings.Contains(eventName, ".orphaned_") {
			anomalyType = eventName
		}
		if anomalyType == "" && !strings.HasPrefix(eventName, "trace.root.") && !strings.HasPrefix(eventName, "run.") {
			continue
		}

		if anomalyType != "" {
			summary.AnomalyCount++
			anomalyMap[anomalyType]++
			if strings.Contains(anomalyType, "orphaned") {
				summary.OrphanEventCount++
			}
			if anomalyType == "trace.root.recreated" {
				summary.RootRecreatedCount++
			}
			if anomalyType == "run.agent_end_without_root" {
				summary.AgentEndWithoutRoot++
			}
		}
		if eventName == "trace.root.closed_idle_timeout" {
			summary.IdleTimeoutClosures++
		}
		if closeReason := getStringAttr(attrs, "close_reason"); closeReason != "" {
			closeReasonMap[closeReason]++
		}

		if anomalyType != "" || eventName == "trace.root.closed_idle_timeout" {
			recentAnomalies = append(recentAnomalies, RecentAnomaly{
				Timestamp:   item.CreatedAt,
				Severity:    item.SeverityText,
				EventName:   eventName,
				AnomalyType: anomalyType,
				SessionID:   getStringAttr(attrs, "session_id"),
				TraceID:     item.TraceID,
				Body:        item.Body,
			})
			if len(recentAnomalies) >= 20 {
				break
			}
		}
	}

	anomalies := make([]BreakdownItem, 0, len(anomalyMap))
	for name, count := range anomalyMap {
		anomalies = append(anomalies, BreakdownItem{Name: name, Count: count})
	}
	sort.Slice(anomalies, func(i, j int) bool {
		if anomalies[i].Count == anomalies[j].Count {
			return anomalies[i].Name < anomalies[j].Name
		}
		return anomalies[i].Count > anomalies[j].Count
	})

	closeReasons := make([]BreakdownItem, 0, len(closeReasonMap))
	for name, count := range closeReasonMap {
		closeReasons = append(closeReasons, BreakdownItem{Name: name, Count: count})
	}
	sort.Slice(closeReasons, func(i, j int) bool {
		if closeReasons[i].Count == closeReasons[j].Count {
			return closeReasons[i].Name < closeReasons[j].Name
		}
		return closeReasons[i].Count > closeReasons[j].Count
	})

	c.JSON(200, gin.H{
		"summary":          summary,
		"anomaly_types":    anomalies,
		"close_reasons":    closeReasons,
		"recent_anomalies": recentAnomalies,
	})
}

// GetOtelSecurityTimeline returns high-risk tool operations for audit and compliance workflows.
func GetOtelSecurityTimeline(c *gin.Context) {
	cutoffDate := time.Now().AddDate(0, 0, -7)

	type SecuritySummary struct {
		WindowDays       int `json:"window_days"`
		HighRiskCount    int `json:"high_risk_count"`
		MediumRiskCount  int `json:"medium_risk_count"`
		ErroredRiskCount int `json:"errored_risk_count"`
		AffectedSessions int `json:"affected_sessions"`
	}

	type BreakdownItem struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
	}

	type RiskTimelineItem struct {
		CreatedAt      time.Time `json:"created_at"`
		TraceID        string    `json:"trace_id"`
		SpanID         string    `json:"span_id"`
		SessionID      string    `json:"session_id"`
		ToolName       string    `json:"tool_name"`
		ToolCategory   string    `json:"tool_category"`
		ToolRiskClass  string    `json:"tool_risk_class"`
		ToolRiskReason string    `json:"tool_risk_reason"`
		ParamsPreview  string    `json:"params_preview"`
		DurationMs     float64   `json:"duration_ms"`
		Status         string    `json:"status"`
		ErrorType      string    `json:"error_type"`
		ErrorMessage   string    `json:"error_message"`
	}

	var toolSpans []models.OtelSpan
	if err := database.DB.Where("tool_name != '' AND created_at > ?", cutoffDate).
		Order("created_at DESC").
		Limit(500).
		Find(&toolSpans).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to fetch security tool spans"})
		return
	}

	summary := SecuritySummary{WindowDays: 7}
	sessionsSeen := map[string]bool{}
	riskClassMap := map[string]int{}
	categoryMap := map[string]int{}
	timeline := make([]RiskTimelineItem, 0, len(toolSpans))

	for _, span := range toolSpans {
		attrs := parseJSONMap(span.Attributes)
		riskClass := getStringAttr(attrs, "tool_risk_class")
		if riskClass != "high" && riskClass != "medium" {
			continue
		}

		category := getStringAttr(attrs, "tool_category")
		if category == "" {
			category = "unknown"
		}
		status := "ok"
		if span.StatusCode == 2 {
			status = "error"
		}
		durationMs := getFloatAttr(attrs, "duration_ms")
		if durationMs == 0 && span.DurationNs > 0 {
			durationMs = float64(span.DurationNs) / 1e6
		}

		item := RiskTimelineItem{
			CreatedAt:      span.CreatedAt,
			TraceID:        span.TraceID,
			SpanID:         span.SpanID,
			SessionID:      getStringAttr(attrs, "session_id"),
			ToolName:       span.ToolName,
			ToolCategory:   category,
			ToolRiskClass:  riskClass,
			ToolRiskReason: getStringAttr(attrs, "tool_risk_reason"),
			ParamsPreview:  getStringAttr(attrs, "tool_params_preview", "tool_params"),
			DurationMs:     durationMs,
			Status:         status,
			ErrorType:      getStringAttr(attrs, "error_type"),
			ErrorMessage:   getStringAttr(attrs, "error"),
		}
		timeline = append(timeline, item)

		riskClassMap[riskClass]++
		categoryMap[category]++
		if riskClass == "high" {
			summary.HighRiskCount++
		} else if riskClass == "medium" {
			summary.MediumRiskCount++
		}
		if status == "error" {
			summary.ErroredRiskCount++
		}
		if item.SessionID != "" {
			sessionsSeen[item.SessionID] = true
		}
	}
	summary.AffectedSessions = len(sessionsSeen)

	riskClasses := make([]BreakdownItem, 0, len(riskClassMap))
	for name, count := range riskClassMap {
		riskClasses = append(riskClasses, BreakdownItem{Name: name, Count: count})
	}
	sort.Slice(riskClasses, func(i, j int) bool {
		if riskClasses[i].Count == riskClasses[j].Count {
			return riskClasses[i].Name < riskClasses[j].Name
		}
		return riskClasses[i].Count > riskClasses[j].Count
	})

	categories := make([]BreakdownItem, 0, len(categoryMap))
	for name, count := range categoryMap {
		categories = append(categories, BreakdownItem{Name: name, Count: count})
	}
	sort.Slice(categories, func(i, j int) bool {
		if categories[i].Count == categories[j].Count {
			return categories[i].Name < categories[j].Name
		}
		return categories[i].Count > categories[j].Count
	})

	c.JSON(200, gin.H{
		"summary":      summary,
		"risk_classes": riskClasses,
		"categories":   categories,
		"timeline":     timeline,
	})
}

// GetOtelContextBloat returns candidate sessions whose prompt token growth suggests runaway context expansion.
func GetOtelContextBloat(c *gin.Context) {
	cutoffDate := time.Now().AddDate(0, 0, -7)

	type BloatSummary struct {
		WindowDays          int `json:"window_days"`
		SessionsEvaluated   int `json:"sessions_evaluated"`
		AlertCandidates     int `json:"alert_candidates"`
		SevereCandidates    int `json:"severe_candidates"`
		MaxPromptTokensSeen int `json:"max_prompt_tokens_seen"`
	}

	type SessionPoint struct {
		TurnIndex        int       `json:"turn_index"`
		PromptTokens     int       `json:"prompt_tokens"`
		CompletionTokens int       `json:"completion_tokens"`
		TotalTokens      int       `json:"total_tokens"`
		Model            string    `json:"model"`
		Provider         string    `json:"provider"`
		CreatedAt        time.Time `json:"created_at"`
		TraceID          string    `json:"trace_id"`
	}

	type BloatCandidate struct {
		SessionID          string         `json:"session_id"`
		TraceID            string         `json:"trace_id"`
		AgentName          string         `json:"agent_name"`
		LastModel          string         `json:"last_model"`
		RunStatus          string         `json:"run_status"`
		UserMessage        string         `json:"user_message"`
		Points             []SessionPoint `json:"points"`
		RunsObserved       int            `json:"runs_observed"`
		MaxPromptTokens    int            `json:"max_prompt_tokens"`
		LatestPromptTokens int            `json:"latest_prompt_tokens"`
		GrowthRatio        float64        `json:"growth_ratio"`
		GrowthSlope        float64        `json:"growth_slope"`
		AlertLevel         string         `json:"alert_level"`
		CreatedAt          time.Time      `json:"created_at"`
	}

	var llmSpans []models.OtelSpan
	if err := database.DB.Where("model != '' AND created_at > ?", cutoffDate).
		Order("created_at ASC").
		Find(&llmSpans).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to fetch llm spans for context bloat"})
		return
	}

	sessionPoints := map[string][]SessionPoint{}
	maxPromptTokensSeen := 0
	for _, span := range llmSpans {
		attrs := parseJSONMap(span.Attributes)
		sessionID := getStringAttr(attrs, "session_id")
		turnIndex := getIntAttr(attrs, "llm_turn_index")
		promptTokens := getIntAttr(attrs, "prompt_tokens")
		if sessionID == "" || turnIndex == 0 || promptTokens == 0 {
			continue
		}
		point := SessionPoint{
			TurnIndex:        turnIndex,
			PromptTokens:     promptTokens,
			CompletionTokens: getIntAttr(attrs, "completion_tokens"),
			TotalTokens:      getIntAttr(attrs, "total_tokens"),
			Model:            span.Model,
			Provider:         span.Provider,
			CreatedAt:        span.CreatedAt,
			TraceID:          span.TraceID,
		}
		sessionPoints[sessionID] = append(sessionPoints[sessionID], point)
		if promptTokens > maxPromptTokensSeen {
			maxPromptTokensSeen = promptTokens
		}
	}

	var rootSpans []models.OtelSpan
	if err := database.DB.Where("parent_span_id = '' AND created_at > ?", cutoffDate).
		Find(&rootSpans).Error; err != nil {
		c.JSON(500, gin.H{"error": "Failed to fetch root spans for context bloat"})
		return
	}

	rootBySession := map[string]models.OtelSpan{}
	for _, span := range rootSpans {
		attrs := parseJSONMap(span.Attributes)
		sessionID := getStringAttr(attrs, "session_id")
		if sessionID != "" {
			rootBySession[sessionID] = span
		}
	}

	summary := BloatSummary{
		WindowDays:          7,
		MaxPromptTokensSeen: maxPromptTokensSeen,
	}
	candidates := make([]BloatCandidate, 0)

	for sessionID, points := range sessionPoints {
		if len(points) < 3 {
			continue
		}
		sort.Slice(points, func(i, j int) bool {
			return points[i].TurnIndex < points[j].TurnIndex
		})
		summary.SessionsEvaluated++

		first := points[0]
		last := points[len(points)-1]
		if first.PromptTokens <= 0 {
			continue
		}

		growthRatio := float64(last.PromptTokens) / float64(first.PromptTokens)
		growthSlope := float64(last.PromptTokens-first.PromptTokens) / float64(max(1, last.TurnIndex-first.TurnIndex))
		maxPrompt := 0
		for _, point := range points {
			if point.PromptTokens > maxPrompt {
				maxPrompt = point.PromptTokens
			}
		}

		alertLevel := ""
		switch {
		case len(points) >= 4 && growthRatio >= 3 && maxPrompt >= 12000:
			alertLevel = "severe"
			summary.SevereCandidates++
		case len(points) >= 3 && growthRatio >= 2 && maxPrompt >= 6000:
			alertLevel = "warning"
		default:
			continue
		}
		summary.AlertCandidates++

		root := rootBySession[sessionID]
		rootAttrs := parseJSONMap(root.Attributes)
		candidates = append(candidates, BloatCandidate{
			SessionID:          sessionID,
			TraceID:            last.TraceID,
			AgentName:          getStringAttr(rootAttrs, "agent_name"),
			LastModel:          getStringAttr(rootAttrs, "last_model"),
			RunStatus:          getStringAttr(rootAttrs, "run_status"),
			UserMessage:        getStringAttr(rootAttrs, "user_message"),
			Points:             points,
			RunsObserved:       len(points),
			MaxPromptTokens:    maxPrompt,
			LatestPromptTokens: last.PromptTokens,
			GrowthRatio:        growthRatio,
			GrowthSlope:        growthSlope,
			AlertLevel:         alertLevel,
			CreatedAt:          last.CreatedAt,
		})
	}

	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].AlertLevel == candidates[j].AlertLevel {
			if candidates[i].GrowthRatio == candidates[j].GrowthRatio {
				return candidates[i].CreatedAt.After(candidates[j].CreatedAt)
			}
			return candidates[i].GrowthRatio > candidates[j].GrowthRatio
		}
		return candidates[i].AlertLevel == "severe"
	})
	if len(candidates) > 12 {
		candidates = candidates[:12]
	}

	c.JSON(200, gin.H{
		"summary":    summary,
		"candidates": candidates,
	})
}
