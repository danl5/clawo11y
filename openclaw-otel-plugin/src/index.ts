import { trace, context, SpanStatusCode, Span } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";

interface OpenClawPluginApi {
  registerHook(name: string, callback: (ctx: any) => Promise<any> | any): void;
  on(name: string, callback: (event: any, agentCtx?: any) => void): void;
  config: any;
  logger: { info(msg: string): void; error(msg: string): void };
}

interface SessionRunStats {
  startedAtMs: number;
  lastActivityMs: number;
  llmCalls: number;
  toolCalls: number;
  subagentCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  hadError: boolean;
  errorType?: string;
  errorMessage?: string;
  channel?: string;
  agentName?: string;
  lastModel?: string;
  lastProvider?: string;
  rootRecreateCount: number;
  highRiskToolCalls: number;
}

const activeSpans = new Map<string, Span>();
const activeTimers = new Map<string, number>();
const activeSubagentSpans = new Map<string, Span>();
const activeSubagentParents = new Map<string, string>();
const pendingSessionAttributes = new Map<string, Record<string, string | number | boolean>>();
const rootIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();
const sessionRunStats = new Map<string, SessionRunStats>();

// Default pricing per 1 million tokens if not configured
const DEFAULT_PRICING = {
  "gpt-4o": { prompt: 5.0, completion: 15.0 },
  "claude-3-5": { prompt: 3.0, completion: 15.0 },
  "gpt-4-turbo": { prompt: 10.0, completion: 30.0 },
  "gpt-3.5": { prompt: 0.5, completion: 1.5 },
  "haiku": { prompt: 0.25, completion: 1.25 }
};

// Basic PII Redaction and Payload Truncation for Enterprise Compliance
function sanitizePayload(data: any): string {
  if (data === undefined || data === null) return "";
  let str = typeof data === 'string' ? data : JSON.stringify(data);
  // Mask potential API keys, generic tokens, or PII
  str = str.replace(/(sk-[a-zA-Z0-9]{20,})/g, "sk-***REDACTED***");
  str = str.replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, "***@***.***");
  return str.substring(0, 2000);
}

function calculateCost(model: string | undefined, promptTokens: number, completionTokens: number, customPricing: any): number {
  let pRate = 0;
  let cRate = 0;
  const modelName = typeof model === "string" ? model : "";

  // Merge default pricing with user-configured pricing
  const pricingConfig = { ...DEFAULT_PRICING, ...(customPricing || {}) };

  // Find matching model pricing (using includes for partial matches like "gpt-4o-2024-05-13")
  for (const [key, rates] of Object.entries(pricingConfig)) {
    if (modelName.includes(key)) {
      pRate = (rates as any).prompt / 1000000;
      cRate = (rates as any).completion / 1000000;
      break;
    }
  }

  return (promptTokens * pRate) + (completionTokens * cRate);
}

export default function registerPlugin(api: OpenClawPluginApi) {
  // Helper to safely read configuration
  const getConfig = (key: string, defaultValue?: any) => {
    // OpenClaw passes the plugin-specific configuration via api.pluginConfig
    const source = (api as any).pluginConfig || (api as any).config || {};
    
    if (typeof source.get === 'function') {
      const val = source.get(key);
      return val !== undefined ? val : defaultValue;
    }
    
    const val = source[key];
    return val !== undefined ? val : defaultValue;
  };

  // Check if enabled (defaults to true)
  const isEnabled = getConfig("enabled", true) !== false;

  if (!isEnabled) {
    api.logger.info("[ClawO11y] OpenTelemetry plugin is disabled via configuration.");
    return;
  }

  const endpoint = getConfig("endpoint", "http://localhost:4318");
  const metricIntervalMs = getConfig("metric_interval_ms", 10000);
  const exportTimeoutMs = getConfig("export_timeout_ms", 5000);
  const rootIdleTimeoutMs = getConfig("root_idle_timeout_ms", 60000);
  
  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: "openclaw-agent",
    [SemanticResourceAttributes.SERVICE_VERSION]: "1.0.0",
  });

  // --- TRACES ---
  const traceProvider = new NodeTracerProvider({ resource });
  traceProvider.addSpanProcessor(new SimpleSpanProcessor(new OTLPTraceExporter({ 
    url: `${endpoint}/v1/traces`,
    timeoutMillis: exportTimeoutMs
  })));
  traceProvider.register();
  const tracer = trace.getTracer("clawo11y-plugin");

  // --- METRICS ---
  const metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ 
      url: `${endpoint}/v1/metrics`,
      timeoutMillis: exportTimeoutMs
    }),
    exportIntervalMillis: metricIntervalMs,
    exportTimeoutMillis: exportTimeoutMs
  });
  const meterProvider = new MeterProvider({ resource, readers: [metricReader] });
  const meter = meterProvider.getMeter("clawo11y-plugin");
  let metricFlushTimer: ReturnType<typeof setTimeout> | undefined;
  let metricFlushInFlight = false;

  // Define Metrics
  const runCounter = meter.createCounter("openclaw.run.count", { description: "Total OpenClaw runs observed" });
  const runDuration = meter.createHistogram("openclaw.run.duration", { description: "End-to-end run duration", unit: "ms" });
  const llmRequestCounter = meter.createCounter("openclaw.llm.requests", { description: "Total LLM requests" });
  const llmDuration = meter.createHistogram("openclaw.llm.duration", { description: "LLM request duration", unit: "ms" });
  const llmErrorCounter = meter.createCounter("openclaw.llm.errors", { description: "Total LLM errors" });
  const tokenCounter = meter.createCounter("openclaw.llm.tokens.total", { description: "Total tokens consumed by LLMs" });
  const costCounter = meter.createCounter("openclaw.llm.cost.usd", { description: "Total cost of LLM inference in USD" });
  const toolCallCounter = meter.createCounter("openclaw.tool.calls", { description: "Total tool calls" });
  const toolDuration = meter.createHistogram("openclaw.tool.duration", { description: "Tool execution duration", unit: "ms" });
  const toolErrorCounter = meter.createCounter("openclaw.tool.errors", { description: "Total tool errors" });
  const subagentCallCounter = meter.createCounter("openclaw.subagent.calls", { description: "Total subagent calls" });
  const subagentDuration = meter.createHistogram("openclaw.subagent.duration", { description: "Subagent duration", unit: "ms" });
  const subagentErrorCounter = meter.createCounter("openclaw.subagent.errors", { description: "Total subagent errors" });
  const errorCounter = meter.createCounter("openclaw.agent.errors", { description: "Total errors encountered by the agent" });
  const telemetryAnomalyCounter = meter.createCounter("openclaw.telemetry.anomalies", { description: "Observability lifecycle anomalies" });
  const securityHighRiskToolCounter = meter.createCounter("openclaw.security.high_risk_tool.calls", { description: "Total high-risk tool calls" });

  // --- LOGS ---
  const loggerProvider = new LoggerProvider({ resource });
  loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(new OTLPLogExporter({ 
    url: `${endpoint}/v1/logs`,
    timeoutMillis: exportTimeoutMs
  })));
  logs.setGlobalLoggerProvider(loggerProvider);
  const otelLogger = logs.getLogger("clawo11y-plugin");

  api.logger.info(`[ClawO11y] OpenTelemetry plugin registered. Exporting Traces, Metrics, Logs to ${endpoint}`);

  // --- HOOKS IMPLEMENTATION ---

  const resolveSessionKey = (...candidates: any[]): string | undefined => {
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.length > 0) return candidate;
    }
    return undefined;
  };

  const resolveString = (...candidates: any[]): string | undefined => {
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
    }
    return undefined;
  };

  const coerceLogAttributes = (attributes: Record<string, unknown>) => {
    const normalized: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(attributes)) {
      if (value === undefined || value === null || value === "") continue;
      if (typeof value === "string") normalized[key] = sanitizePayload(value);
      else if (typeof value === "number" || typeof value === "boolean") normalized[key] = value;
      else normalized[key] = sanitizePayload(value);
    }
    return normalized;
  };

  const emitLog = (
    severityNumber: SeverityNumber,
    severityText: string,
    eventName: string,
    body: string,
    attributes: Record<string, unknown> = {},
    span?: Span,
  ) => {
    const payload = {
      severityNumber,
      severityText,
      body: sanitizePayload(body),
      attributes: coerceLogAttributes({
        event_name: eventName,
        ...attributes,
      }),
    };

    if (span) {
      context.with(trace.setSpan(context.active(), span), () => otelLogger.emit(payload));
      return;
    }

    otelLogger.emit(payload);
  };

  const recordTelemetryAnomaly = (
    anomalyType: string,
    body: string,
    attributes: Record<string, unknown> = {},
    severityNumber: SeverityNumber = SeverityNumber.WARN,
    severityText: string = "WARN",
    span?: Span,
  ) => {
    telemetryAnomalyCounter.add(1, { anomaly_type: anomalyType });
    flushMetricsSoon();
    emitLog(severityNumber, severityText, anomalyType, body, {
      anomaly_type: anomalyType,
      ...attributes,
    }, span);
  };

  const resolveToolKey = (event: any, toolCtx?: any): string | undefined => {
    const toolCallId =
      event?.toolCallId ||
      event?.tool_call_id ||
      toolCtx?.toolCallId ||
      toolCtx?.tool_call_id;
    if (typeof toolCallId === "string" && toolCallId.length > 0) return toolCallId;
    const toolName = event?.toolName || toolCtx?.toolName;
    if (typeof toolName === "string" && toolName.length > 0) return toolName;
    return undefined;
  };

  const resolveSubagentLabel = (event: any) => {
    return resolveString(
      event?.label,
      event?.agentId ? String(event.agentId) : undefined,
      event?.agent_id ? String(event.agent_id) : undefined,
    ) || "unknown";
  };

  const classifyToolRisk = (toolName?: string, params?: any) => {
    const normalizedName = (toolName || "").toLowerCase();
    const paramsPreview = sanitizePayload(params).toLowerCase();

    const hasAny = (values: string[]) => values.some((value) => normalizedName.includes(value) || paramsPreview.includes(value));

    if (hasAny(["bash", "shell", "exec", "terminal", "command"])) {
      return {
        toolCategory: "shell",
        toolRiskClass: "high",
        riskReason: "executes shell or command-line operations",
      };
    }
    if (hasAny(["python", "node", "javascript", "code"])) {
      return {
        toolCategory: "code_exec",
        toolRiskClass: "high",
        riskReason: "executes dynamic code",
      };
    }
    if (hasAny(["delete", "remove", "rm ", "unlink", "rmdir"])) {
      return {
        toolCategory: "filesystem",
        toolRiskClass: "high",
        riskReason: "can delete filesystem data",
      };
    }
    if (hasAny(["write_file", "file_write", "edit_file", "overwrite", "append_file", "mv ", "cp "])) {
      return {
        toolCategory: "filesystem",
        toolRiskClass: "medium",
        riskReason: "modifies filesystem state",
      };
    }
    if (hasAny(["curl", "wget", "http://", "https://", "fetch", "web_search", "browser", "request"])) {
      return {
        toolCategory: "network",
        toolRiskClass: "medium",
        riskReason: "performs external network access",
      };
    }
    return {
      toolCategory: "general",
      toolRiskClass: "low",
      riskReason: "general tool invocation",
    };
  };

  const setSpanAttributes = (span: Span, attributes: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(attributes)) {
      if (value === undefined || value === null || value === "") continue;
      span.setAttribute(key, value as string | number | boolean);
    }
  };

  const rememberSessionAttributes = (sessionKey: string, attributes: Record<string, unknown>) => {
    const existing = pendingSessionAttributes.get(sessionKey) || {};
    for (const [key, value] of Object.entries(attributes)) {
      if (value === undefined || value === null || value === "") continue;
      existing[key] = value as string | number | boolean;
    }
    pendingSessionAttributes.set(sessionKey, existing);
  };

  const flushMetricsSoon = (delayMs: number = 250) => {
    if (metricFlushTimer) clearTimeout(metricFlushTimer);
    metricFlushTimer = setTimeout(async () => {
      if (metricFlushInFlight) return;
      metricFlushInFlight = true;
      try {
        await meterProvider.forceFlush();
      } catch (err) {
        api.logger.error(`[ClawO11y] Failed to flush metrics: ${String(err)}`);
      } finally {
        metricFlushInFlight = false;
      }
    }, delayMs);
  };

  const getOrCreateSessionStats = (sessionKey: string) => {
    const existing = sessionRunStats.get(sessionKey);
    if (existing) return existing;
    const stats: SessionRunStats = {
      startedAtMs: Date.now(),
      lastActivityMs: Date.now(),
      llmCalls: 0,
      toolCalls: 0,
      subagentCalls: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      hadError: false,
      rootRecreateCount: 0,
      highRiskToolCalls: 0,
    };
    sessionRunStats.set(sessionKey, stats);
    return stats;
  };

  const updateSessionStats = (sessionKey: string, patch: Partial<SessionRunStats>) => {
    const stats = getOrCreateSessionStats(sessionKey);
    Object.assign(stats, patch);
    stats.lastActivityMs = Date.now();
    return stats;
  };

  const markSessionError = (sessionKey: string, errorType: string, errorMessage: string) => {
    return updateSessionStats(sessionKey, {
      hadError: true,
      errorType,
      errorMessage: sanitizePayload(errorMessage),
    });
  };

  const syncRootSummary = (sessionKey: string) => {
    const span = activeSpans.get(`root_${sessionKey}`);
    const stats = sessionRunStats.get(sessionKey);
    if (!span || !stats) return;
    setSpanAttributes(span, {
      agent_name: stats.agentName,
      channel: stats.channel,
      llm_call_count: stats.llmCalls,
      tool_call_count: stats.toolCalls,
      subagent_call_count: stats.subagentCalls,
      total_tokens: stats.totalTokens,
      total_cost_usd: Number(stats.totalCostUsd.toFixed(6)),
      run_status: stats.hadError ? "error" : "ok",
      error_type: stats.errorType,
      error: stats.errorMessage,
      last_model: stats.lastModel,
      last_provider: stats.lastProvider,
      root_recreate_count: stats.rootRecreateCount,
      high_risk_tool_calls: stats.highRiskToolCalls,
    });
  };

  const attachSessionAttributes = (sessionKey: string, attributes: Record<string, unknown>) => {
    const rootSpan = activeSpans.get(`root_${sessionKey}`);
    if (rootSpan) {
      setSpanAttributes(rootSpan, attributes);
      return;
    }
    rememberSessionAttributes(sessionKey, attributes);
  };

  const closeRootSpan = (sessionKey: string, reason: string) => {
    const timer = rootIdleTimers.get(sessionKey);
    if (timer) {
      clearTimeout(timer);
      rootIdleTimers.delete(sessionKey);
    }
    const span = activeSpans.get(`root_${sessionKey}`);
    const stats = sessionRunStats.get(sessionKey);
    if (!span) {
      recordTelemetryAnomaly("run.close_without_root", `Attempted to close missing root span for session ${sessionKey}`, {
        session_id: sessionKey,
        close_reason: reason,
      });
      pendingSessionAttributes.delete(sessionKey);
      sessionRunStats.delete(sessionKey);
      return;
    }
    const durationMs = stats ? Math.max(0, Date.now() - stats.startedAtMs) : 0;
    if (stats) {
      setSpanAttributes(span, {
        run_status: stats.hadError ? "error" : "ok",
        error_type: stats.errorType,
        error: stats.errorMessage,
        total_tokens: stats.totalTokens,
        total_cost_usd: Number(stats.totalCostUsd.toFixed(6)),
        llm_call_count: stats.llmCalls,
        tool_call_count: stats.toolCalls,
        subagent_call_count: stats.subagentCalls,
        high_risk_tool_calls: stats.highRiskToolCalls,
        duration_ms: durationMs,
        channel: stats.channel,
        agent_name: stats.agentName,
      });
    }
    span.setAttribute("root_close_reason", reason);
    if (reason === "idle_timeout") {
      recordTelemetryAnomaly("trace.root.closed_idle_timeout", `Root span closed by idle timeout for session ${sessionKey}`, {
        session_id: sessionKey,
        duration_ms: durationMs,
        llm_calls: stats?.llmCalls ?? 0,
        tool_calls: stats?.toolCalls ?? 0,
        subagent_calls: stats?.subagentCalls ?? 0,
      }, SeverityNumber.WARN, "WARN", span);
    }
    emitLog(
      stats?.hadError ? SeverityNumber.ERROR : SeverityNumber.INFO,
      stats?.hadError ? "ERROR" : "INFO",
      "run.finished",
      `Run finished for session ${sessionKey} (${stats?.hadError ? "error" : "ok"})`,
      {
        session_id: sessionKey,
        duration_ms: durationMs,
        result: stats?.hadError ? "error" : "ok",
        close_reason: reason,
        llm_calls: stats?.llmCalls ?? 0,
        tool_calls: stats?.toolCalls ?? 0,
        subagent_calls: stats?.subagentCalls ?? 0,
        high_risk_tool_calls: stats?.highRiskToolCalls ?? 0,
        total_tokens: stats?.totalTokens ?? 0,
        total_cost_usd: Number((stats?.totalCostUsd ?? 0).toFixed(6)),
        error_type: stats?.errorType,
        error: stats?.errorMessage,
        channel: stats?.channel,
        agent_name: stats?.agentName,
      },
      span,
    );
    if (stats) {
      const runMetricAttrs = {
        agent_name: stats.agentName || "unknown",
        channel: stats.channel || "unknown",
        result: stats.hadError ? "error" : "ok",
      };
      runCounter.add(1, runMetricAttrs);
      runDuration.record(durationMs, runMetricAttrs);
      flushMetricsSoon();
    }
    span.end();
    activeSpans.delete(`root_${sessionKey}`);
    activeTimers.delete(`root_${sessionKey}`);
    pendingSessionAttributes.delete(sessionKey);
    sessionRunStats.delete(sessionKey);
  };

  const touchRootSpan = (sessionKey?: string) => {
    if (!sessionKey || rootIdleTimeoutMs <= 0) return;
    const stats = sessionRunStats.get(sessionKey);
    if (stats) stats.lastActivityMs = Date.now();
    const existingTimer = rootIdleTimers.get(sessionKey);
    if (existingTimer) clearTimeout(existingTimer);
    rootIdleTimers.set(sessionKey, setTimeout(() => {
      closeRootSpan(sessionKey, "idle_timeout");
    }, rootIdleTimeoutMs));
  };
  
  // Helper to ensure a root span exists or get the active context
  const getTraceContext = (sessionKey: string, createIfMissing: string = "") => {
    const stats = getOrCreateSessionStats(sessionKey);
    let rootSpan = activeSpans.get(`root_${sessionKey}`);
    if (!rootSpan && createIfMissing) {
      if (createIfMissing !== "inbound_claim" && stats.startedAtMs !== stats.lastActivityMs) {
        stats.rootRecreateCount += 1;
        recordTelemetryAnomaly("trace.root.recreated", `Root span recreated for session ${sessionKey} from ${createIfMissing}`, {
          session_id: sessionKey,
          trigger: createIfMissing,
          root_recreate_count: stats.rootRecreateCount,
        });
      }
      rootSpan = tracer.startSpan(`command.process`);
      setSpanAttributes(rootSpan, {
        session_id: sessionKey,
        command_trigger: createIfMissing,
        channel: stats.channel,
        agent_name: stats.agentName,
        root_recreate_count: stats.rootRecreateCount,
      });
      const pendingAttrs = pendingSessionAttributes.get(sessionKey);
      if (pendingAttrs) {
        setSpanAttributes(rootSpan, pendingAttrs);
        pendingSessionAttributes.delete(sessionKey);
      }
      activeSpans.set(`root_${sessionKey}`, rootSpan);
    }
    syncRootSummary(sessionKey);
    if (rootSpan) touchRootSpan(sessionKey);
    if (rootSpan) {
      return trace.setSpan(context.active(), rootSpan);
    }
    return context.active();
  };

  api.registerHook("inbound_claim", async (ctx: any) => {
     const sessionKey = resolveSessionKey(ctx.sessionKey, ctx.sessionId);
     const stats = sessionKey ? updateSessionStats(sessionKey, {
       agentName: resolveString(ctx.agentName, ctx.agent_name),
       channel: resolveString(ctx.channel),
     }) : undefined;
     getTraceContext(ctx.sessionKey, "inbound_claim");
     // Register active timer for the root process to ensure it gets closed if agent_end doesn't fire
     activeTimers.set(`root_${ctx.sessionKey}`, Date.now());
     
     // Emit a Log event
     emitLog(SeverityNumber.INFO, "INFO", "run.started", `Starting new command process for session: ${ctx.sessionKey}`, {
       session_id: ctx.sessionKey,
       agent_name: stats?.agentName,
       channel: stats?.channel,
       user_message: pendingSessionAttributes.get(ctx.sessionKey)?.user_message,
       user_message_len: pendingSessionAttributes.get(ctx.sessionKey)?.user_message_len,
     }, activeSpans.get(`root_${ctx.sessionKey}`));

     return ctx;
  });

  api.on("agent_end", (event: any, agentCtx?: any) => {
     const sessionKey = event.sessionId || agentCtx?.sessionId;
     if (sessionKey && !activeSpans.get(`root_${sessionKey}`)) {
       recordTelemetryAnomaly("run.agent_end_without_root", `agent_end received without active root span for session ${sessionKey}`, {
         session_id: sessionKey,
       });
     }
     if (sessionKey) closeRootSpan(sessionKey, "agent_end");
     flushMetricsSoon(0);
  });

  api.on("llm_input", (event: any, agentCtx?: any) => {
    const sessionKey = event.sessionId || agentCtx?.sessionId || "unknown_session";
    const stats = updateSessionStats(sessionKey, {
      channel: resolveString(event.channel, agentCtx?.channel),
      agentName: resolveString(event.agentName, event.agent_name, agentCtx?.agentName, agentCtx?.agent_name),
      lastModel: resolveString(event.model),
      lastProvider: resolveString(event.provider),
    });
    const ctx = getTraceContext(sessionKey, "llm_input");
    const span = tracer.startSpan(`llm.completion: ${event.model || 'unknown'}`, undefined, ctx);
    setSpanAttributes(span, {
      session_id: sessionKey,
      model: event.model,
      provider: event.provider,
      channel: stats.channel,
      agent_name: stats.agentName,
    });
    if (event.systemPrompt) span.setAttribute("llm.system_prompt", sanitizePayload(event.systemPrompt));
    if (activeSpans.has(`llm_${sessionKey}`)) {
      recordTelemetryAnomaly("llm.duplicate_start", `Duplicate llm_input while prior LLM span is still active for session ${sessionKey}`, {
        session_id: sessionKey,
        model: event.model,
        provider: event.provider,
      });
    }
    activeSpans.set(`llm_${sessionKey}`, span);
    activeTimers.set(`llm_${sessionKey}`, Date.now());
    llmRequestCounter.add(1, {
      model: event.model || "unknown",
      provider: event.provider || "unknown",
    });
    stats.llmCalls += 1;
    span.setAttribute("llm_turn_index", stats.llmCalls);
    syncRootSummary(sessionKey);
    emitLog(SeverityNumber.INFO, "INFO", "llm.started", `LLM request started: ${event.model || "unknown"}`, {
      session_id: sessionKey,
      model: event.model,
      provider: event.provider,
      agent_name: stats.agentName,
      channel: stats.channel,
    }, span);
  });

  api.on("llm_output", (event: any, agentCtx?: any) => {
    const sessionKey = event.sessionId || agentCtx?.sessionId || "unknown_session";
    touchRootSpan(sessionKey);
    const span = activeSpans.get(`llm_${sessionKey}`);
    const startedAt = activeTimers.get(`llm_${sessionKey}`);
    const durationMs = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
    if (startedAt) activeTimers.delete(`llm_${sessionKey}`);
    const stats = updateSessionStats(sessionKey, {
      channel: resolveString(event.channel, agentCtx?.channel),
      agentName: resolveString(event.agentName, event.agent_name, agentCtx?.agentName, agentCtx?.agent_name),
      lastModel: resolveString(event.model),
      lastProvider: resolveString(event.provider),
    });
    
    if (!span) {
      recordTelemetryAnomaly("llm.orphaned_output", `llm_output received without active llm span for session ${sessionKey}`, {
        session_id: sessionKey,
        model: event.model,
        provider: event.provider,
      });
      return;
    }

    if (span) {
      if (durationMs > 0) span.setAttribute("duration_ms", durationMs);
      if (event.usage) {
        const pTokens = event.usage.prompt_tokens || 0;
        const cTokens = event.usage.completion_tokens || 0;
        const total = pTokens + cTokens;
        
        // Fetch user-defined pricing config from OpenClaw
        const customPricing = getConfig("pricing", {});
        const cost = calculateCost(event.model, pTokens, cTokens, customPricing);
        
        // Trace Attributes
        span.setAttribute("prompt_tokens", pTokens);
        span.setAttribute("completion_tokens", cTokens);
        span.setAttribute("total_tokens", total);
        span.setAttribute("cost_usd", cost);
        span.setAttribute("usage.has_tokens", total > 0);
        if (durationMs > 0) span.setAttribute("duration_ms", durationMs);

        // Record Metrics
        const metricAttrs = { model: event.model, provider: event.provider };
        tokenCounter.add(total, metricAttrs);
        costCounter.add(cost, metricAttrs);
        if (durationMs > 0) {
          llmDuration.record(durationMs, {
            model: event.model || "unknown",
            provider: event.provider || "unknown",
          });
        }
        stats.totalTokens += total;
        stats.totalCostUsd += cost;
        flushMetricsSoon();
      }
      if (event?.error) {
        const errMsg = event.error.message || String(event.error);
        setSpanAttributes(span, {
          error: sanitizePayload(errMsg),
          error_type: event.error?.name || "llm_error",
        });
        span.setStatus({ code: SpanStatusCode.ERROR, message: errMsg });
        llmErrorCounter.add(1, {
          model: event.model || "unknown",
          provider: event.provider || "unknown",
          error_type: event.error?.name || "llm_error",
        });
        errorCounter.add(1, {
          error_type: event.error?.name || "llm_error",
          tool_name: "llm",
        });
        flushMetricsSoon();
        markSessionError(sessionKey, event.error?.name || "llm_error", errMsg);
        emitLog(SeverityNumber.ERROR, "ERROR", "llm.failed", `LLM request failed: ${event.model || "unknown"} - ${errMsg}`, {
          session_id: sessionKey,
          model: event.model,
          provider: event.provider,
          duration_ms: durationMs,
          error_type: event.error?.name || "llm_error",
          error: errMsg,
          agent_name: stats.agentName,
          channel: stats.channel,
        }, span);
      } else {
        emitLog(SeverityNumber.INFO, "INFO", "llm.finished", `LLM request finished: ${event.model || "unknown"}`, {
          session_id: sessionKey,
          model: event.model,
          provider: event.provider,
          duration_ms: durationMs,
          prompt_tokens: event.usage?.prompt_tokens || 0,
          completion_tokens: event.usage?.completion_tokens || 0,
          total_tokens: event.usage ? (event.usage.prompt_tokens || 0) + (event.usage.completion_tokens || 0) : 0,
          cost_usd: event.usage ? Number(calculateCost(event.model, event.usage.prompt_tokens || 0, event.usage.completion_tokens || 0, getConfig("pricing", {})).toFixed(6)) : undefined,
          agent_name: stats.agentName,
          channel: stats.channel,
        }, span);
      }
      syncRootSummary(sessionKey);
      span.end();
      activeSpans.delete(`llm_${sessionKey}`);
    }

  });

  api.on("before_tool_call", (event: any, toolCtx?: any) => {
    const sessionKey = resolveSessionKey(
      toolCtx?.sessionKey,
      event?.sessionKey,
      toolCtx?.sessionId,
      event?.sessionId,
    );
    const toolName = event?.toolName || toolCtx?.toolName;
    const toolKey = resolveToolKey(event, toolCtx);
    if (!sessionKey || !toolName || !toolKey) return;
    const toolRisk = classifyToolRisk(toolName, event?.params);
    const stats = updateSessionStats(sessionKey, {
      channel: resolveString(event?.channel, toolCtx?.channel),
      agentName: resolveString(event?.agentName, event?.agent_name, toolCtx?.agentName, toolCtx?.agent_name),
    });
    touchRootSpan(sessionKey);

    // Try to attach tool to the current LLM span if available, otherwise fallback to root span
    const llmSpan = activeSpans.get(`llm_${sessionKey}`);
    let parentCtx = context.active();
    if (llmSpan) {
      parentCtx = trace.setSpan(parentCtx, llmSpan);
    } else {
      parentCtx = getTraceContext(sessionKey, "before_tool_call");
    }

    const span = tracer.startSpan(`tool.call: ${toolName}`, undefined, parentCtx);
    if (activeSpans.has(`tool_${sessionKey}_${toolKey}`)) {
      recordTelemetryAnomaly("tool.duplicate_start", `Duplicate before_tool_call while prior tool span is still active for ${toolName}`, {
        session_id: sessionKey,
        tool_name: toolName,
        tool_call_id: toolKey,
      });
    }
    setSpanAttributes(span, {
      session_id: sessionKey,
      tool_name: toolName,
      tool_call_id: toolKey,
      channel: stats.channel,
      agent_name: stats.agentName,
      tool_category: toolRisk.toolCategory,
      tool_risk_class: toolRisk.toolRiskClass,
      tool_risk_reason: toolRisk.riskReason,
      high_risk_operation: toolRisk.toolRiskClass === "high" || toolRisk.toolRiskClass === "medium",
    });
    span.setAttribute("tool_params", sanitizePayload(event?.params));
    span.setAttribute("tool_params_preview", sanitizePayload(event?.params).slice(0, 400));
    
    activeSpans.set(`tool_${sessionKey}_${toolKey}`, span);
    activeTimers.set(`tool_${sessionKey}_${toolKey}`, Date.now());
    toolCallCounter.add(1, {
      tool_name: toolName,
    });
    if (toolRisk.toolRiskClass === "high" || toolRisk.toolRiskClass === "medium") {
      stats.highRiskToolCalls += 1;
      securityHighRiskToolCounter.add(1, {
        tool_category: toolRisk.toolCategory,
        risk_class: toolRisk.toolRiskClass,
      });
      flushMetricsSoon();
      emitLog(SeverityNumber.WARN, "WARN", "security.high_risk_tool", `High-risk tool invoked: ${toolName}`, {
        session_id: sessionKey,
        tool_name: toolName,
        tool_call_id: toolKey,
        tool_category: toolRisk.toolCategory,
        tool_risk_class: toolRisk.toolRiskClass,
        tool_risk_reason: toolRisk.riskReason,
        params_preview: sanitizePayload(event?.params).slice(0, 400),
        agent_name: stats.agentName,
        channel: stats.channel,
      }, span);
    }
    stats.toolCalls += 1;
    syncRootSummary(sessionKey);

    // Emit a Log
    emitLog(SeverityNumber.INFO, "INFO", "tool.started", `Tool called: ${toolName}`, {
      session_id: sessionKey,
      tool_name: toolName,
      tool_call_id: toolKey,
      params: sanitizePayload(event?.params),
      agent_name: stats.agentName,
      channel: stats.channel,
    }, span);
  });

  api.on("after_tool_call", (event: any, toolCtx?: any) => {
    const sessionKey = resolveSessionKey(
      toolCtx?.sessionKey,
      event?.sessionKey,
      toolCtx?.sessionId,
      event?.sessionId,
    );
    const toolName = event?.toolName || toolCtx?.toolName;
    const toolKey = resolveToolKey(event, toolCtx);
    if (!sessionKey || !toolName || !toolKey) return;
    const stats = updateSessionStats(sessionKey, {
      channel: resolveString(event?.channel, toolCtx?.channel),
      agentName: resolveString(event?.agentName, event?.agent_name, toolCtx?.agentName, toolCtx?.agent_name),
    });
    touchRootSpan(sessionKey);

    const span = activeSpans.get(`tool_${sessionKey}_${toolKey}`);
    const startTime = activeTimers.get(`tool_${sessionKey}_${toolKey}`);
    let durationMs = 0;

    if (!span) {
      recordTelemetryAnomaly("tool.orphaned_end", `after_tool_call received without matching tool span for ${toolName}`, {
        session_id: sessionKey,
        tool_name: toolName,
        tool_call_id: toolKey,
      });
      return;
    }
    
    if (startTime) {
      durationMs = Date.now() - startTime;
      // Record Metric: Tool execution duration
      toolDuration.record(durationMs, { tool_name: toolName });
      flushMetricsSoon();
      activeTimers.delete(`tool_${sessionKey}_${toolKey}`);
    }

    if (span) {
      if (durationMs > 0) span.setAttribute("duration_ms", durationMs);
      if (event?.error) {
        const errMsg = event.error.message || String(event.error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: errMsg });
        setSpanAttributes(span, {
          error: sanitizePayload(errMsg),
          error_type: event.error?.name || "tool_error"
        });
        
        // Record Metric: Error count
        errorCounter.add(1, { error_type: "tool_error", tool_name: toolName });
        toolErrorCounter.add(1, { tool_name: toolName, error_type: event.error?.name || "tool_error" });
        flushMetricsSoon();
        markSessionError(sessionKey, event.error?.name || "tool_error", errMsg);

        // Emit Log: Error
        emitLog(SeverityNumber.ERROR, "ERROR", "tool.failed", `Tool execution failed: ${toolName} - ${errMsg}`, {
          session_id: sessionKey,
          tool_name: toolName,
          tool_call_id: toolKey,
          duration_ms: durationMs,
          error_type: event.error?.name || "tool_error",
          error: errMsg,
          agent_name: stats.agentName,
          channel: stats.channel,
        }, span);

      } else {
        span.setStatus({ code: SpanStatusCode.OK });
        span.setAttribute("tool_result", sanitizePayload(event?.result));
        if (event?.result !== undefined && event?.result !== null) {
          span.setAttribute("tool_result_size", sanitizePayload(event.result).length);
        }
        emitLog(SeverityNumber.INFO, "INFO", "tool.succeeded", `Tool execution succeeded: ${toolName}`, {
          session_id: sessionKey,
          tool_name: toolName,
          tool_call_id: toolKey,
          duration_ms: durationMs,
          result_size: event?.result !== undefined && event?.result !== null ? sanitizePayload(event.result).length : 0,
          agent_name: stats.agentName,
          channel: stats.channel,
        }, span);
      }
      syncRootSummary(sessionKey);
      span.end();
      activeSpans.delete(`tool_${sessionKey}_${toolKey}`);
    }

  });

  api.on("subagent_spawning", (event: any, subagentCtx?: any) => {
    const requesterSessionKey = resolveSessionKey(
      subagentCtx?.requesterSessionKey,
      event?.requesterSessionKey,
      subagentCtx?.sessionKey,
      event?.sessionKey,
    );
    const childSessionKey = resolveSessionKey(event?.childSessionKey, subagentCtx?.childSessionKey);
    if (!requesterSessionKey || !childSessionKey) return;
    const stats = updateSessionStats(requesterSessionKey, {
      channel: resolveString(event?.channel, subagentCtx?.channel),
      agentName: resolveString(event?.agentName, event?.agent_name, subagentCtx?.agentName, subagentCtx?.agent_name),
    });
    touchRootSpan(requesterSessionKey);

    const parentCtx = getTraceContext(requesterSessionKey, "subagent_spawning");
    const span = tracer.startSpan(
      `subagent:${event?.agentId || event?.label || "unknown"}`,
      undefined,
      parentCtx,
    );
    setSpanAttributes(span, {
      session_id: requesterSessionKey,
      "subagent.child_session_key": childSessionKey,
      "subagent.agent_id": event?.agentId ? String(event.agentId) : undefined,
      "subagent.label": event?.label ? String(event.label) : undefined,
      "subagent.mode": event?.mode ? String(event.mode) : undefined,
      channel: stats.channel,
      agent_name: stats.agentName,
    });
    activeSubagentSpans.set(childSessionKey, span);
    activeSubagentParents.set(childSessionKey, requesterSessionKey);
    activeTimers.set(`subagent_${childSessionKey}`, Date.now());
    subagentCallCounter.add(1, {
      subagent_label: resolveSubagentLabel(event),
      mode: event?.mode || "unknown",
    });
    stats.subagentCalls += 1;
    syncRootSummary(requesterSessionKey);
    emitLog(SeverityNumber.INFO, "INFO", "subagent.started", `Subagent started: ${event?.label || event?.agentId || "unknown"}`, {
      session_id: requesterSessionKey,
      child_session_id: childSessionKey,
      subagent_label: event?.label || event?.agentId || "unknown",
      mode: event?.mode,
      agent_name: stats.agentName,
      channel: stats.channel,
    }, span);
  });

  api.on("subagent_spawned", (event: any, subagentCtx?: any) => {
    const childSessionKey = resolveSessionKey(event?.childSessionKey, subagentCtx?.childSessionKey);
    if (!childSessionKey) return;
    const parentSessionKey = activeSubagentParents.get(childSessionKey);
    touchRootSpan(parentSessionKey);
    const span = activeSubagentSpans.get(childSessionKey);
    if (!span) {
      recordTelemetryAnomaly("subagent.orphaned_spawned", `subagent_spawned received without active subagent span for child session ${childSessionKey}`, {
        child_session_id: childSessionKey,
        session_id: parentSessionKey,
      });
      return;
    }
    if (event?.runId) span.setAttribute("subagent.run_id", String(event.runId));
    if (event?.threadRequested !== undefined) {
      span.setAttribute("subagent.thread_requested", Boolean(event.threadRequested));
    }
  });

  api.on("subagent_ended", (event: any, subagentCtx?: any) => {
    const childSessionKey = resolveSessionKey(
      event?.targetSessionKey,
      event?.childSessionKey,
      subagentCtx?.childSessionKey,
      subagentCtx?.targetSessionKey,
    );
    if (!childSessionKey) return;
    const parentSessionKey = activeSubagentParents.get(childSessionKey);
    touchRootSpan(parentSessionKey);
    const span = activeSubagentSpans.get(childSessionKey);
    if (!span) {
      recordTelemetryAnomaly("subagent.orphaned_end", `subagent_ended received without active subagent span for child session ${childSessionKey}`, {
        child_session_id: childSessionKey,
        session_id: parentSessionKey,
      });
      return;
    }
    const startedAt = activeTimers.get(`subagent_${childSessionKey}`);
    const durationMs = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
    if (startedAt) activeTimers.delete(`subagent_${childSessionKey}`);
    const stats = parentSessionKey ? updateSessionStats(parentSessionKey, {}) : undefined;
    if (event?.error) {
      const errMsg = event.error.message || String(event.error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: errMsg });
      setSpanAttributes(span, {
        "subagent.error": sanitizePayload(errMsg),
        "subagent.error_type": event.error?.name || "subagent_error"
      });
      if (durationMs > 0) span.setAttribute("duration_ms", durationMs);
      subagentErrorCounter.add(1, {
        subagent_label: resolveSubagentLabel(event),
        error_type: event.error?.name || "subagent_error",
      });
      errorCounter.add(1, {
        error_type: event.error?.name || "subagent_error",
        tool_name: "subagent",
      });
      flushMetricsSoon();
      if (parentSessionKey) markSessionError(parentSessionKey, event.error?.name || "subagent_error", errMsg);
      emitLog(SeverityNumber.ERROR, "ERROR", "subagent.failed", `Subagent failed: ${resolveSubagentLabel(event)} - ${errMsg}`, {
        session_id: parentSessionKey,
        child_session_id: childSessionKey,
        subagent_label: resolveSubagentLabel(event),
        duration_ms: durationMs,
        error_type: event.error?.name || "subagent_error",
        error: errMsg,
        agent_name: stats?.agentName,
        channel: stats?.channel,
      }, span);
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
      if (event?.result !== undefined) {
        span.setAttribute("subagent.result", sanitizePayload(event.result));
      }
      if (durationMs > 0) span.setAttribute("duration_ms", durationMs);
      emitLog(SeverityNumber.INFO, "INFO", "subagent.finished", `Subagent finished: ${resolveSubagentLabel(event)}`, {
        session_id: parentSessionKey,
        child_session_id: childSessionKey,
        subagent_label: resolveSubagentLabel(event),
        duration_ms: durationMs,
        result_size: event?.result !== undefined ? sanitizePayload(event.result).length : 0,
        agent_name: stats?.agentName,
        channel: stats?.channel,
      }, span);
    }
    subagentDuration.record(durationMs, {
      subagent_label: resolveSubagentLabel(event),
      mode: resolveString(event?.mode) || "unknown",
    });
    if (parentSessionKey) syncRootSummary(parentSessionKey);
    span.end();
    activeSubagentSpans.delete(childSessionKey);
    activeSubagentParents.delete(childSessionKey);
  });

  api.on("message_received", (event, agentCtx) => {
     const sessionKey = agentCtx?.sessionId || event.sessionId;
     if (sessionKey) {
       updateSessionStats(sessionKey, {
         channel: resolveString(event?.channel, agentCtx?.channel),
         agentName: resolveString(event?.agentName, event?.agent_name, agentCtx?.agentName, agentCtx?.agent_name),
       });
       touchRootSpan(sessionKey);
       attachSessionAttributes(sessionKey, {
         user_message: sanitizePayload(event.message),
         user_message_len: typeof event.message === "string" ? event.message.length : 0
       });
     }
     emitLog(SeverityNumber.DEBUG, "DEBUG", "message.received", `User message received: ${event.message}`, {
       session_id: sessionKey,
       channel: resolveString(event?.channel, agentCtx?.channel),
       agent_name: resolveString(event?.agentName, event?.agent_name, agentCtx?.agentName, agentCtx?.agent_name),
     });
  });
}
