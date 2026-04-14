import { describe, it, expect, vi, beforeEach } from 'vitest';
import registerPlugin from './index.js';

// Mock OpenTelemetry to prevent real network requests during testing
vi.mock('@opentelemetry/sdk-trace-node', () => ({
  NodeTracerProvider: class {
    addSpanProcessor = vi.fn();
    register = vi.fn();
  },
  SimpleSpanProcessor: class {},
}));

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: class {},
}));

vi.mock('@opentelemetry/exporter-metrics-otlp-http', () => ({
  OTLPMetricExporter: class {},
}));

vi.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
  OTLPLogExporter: class {},
}));

vi.mock('@opentelemetry/sdk-metrics', () => ({
  MeterProvider: class {
    getMeter() {
      return {
        createCounter: () => ({ add: vi.fn() }),
        createHistogram: () => ({ record: vi.fn() }),
        createUpDownCounter: () => ({ add: vi.fn() }),
      };
    }
    async forceFlush() {}
  },
  PeriodicExportingMetricReader: class {},
}));

vi.mock('@opentelemetry/sdk-logs', () => ({
  LoggerProvider: class {
    addLogRecordProcessor = vi.fn();
  },
  BatchLogRecordProcessor: class {},
  SimpleLogRecordProcessor: class {},
}));

vi.mock('@opentelemetry/api-logs', () => ({
  logs: {
    setGlobalLoggerProvider: vi.fn(),
    getLogger: vi.fn().mockReturnValue({
      emit: vi.fn(),
    }),
  },
  SeverityNumber: {
    INFO: 9,
    WARN: 13,
    ERROR: 17,
  }
}));

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: vi.fn().mockReturnValue({
      startSpan: vi.fn().mockReturnValue({
        setAttribute: vi.fn(),
        setAttributes: vi.fn(),
        setStatus: vi.fn(),
        recordException: vi.fn(),
        end: vi.fn(),
      }),
    }),
    setSpan: vi.fn().mockReturnValue({}),
  },
  context: {
    active: vi.fn().mockReturnValue({}),
    with: vi.fn((_ctx, fn) => fn()),
  },
  SpanStatusCode: {
    UNSET: 0,
    OK: 1,
    ERROR: 2,
  },
}));

describe('OpenClaw OTEL Plugin Flow', () => {
  let mockApi: any;
  let hooks: Record<string, Function>;
  let events: Record<string, Function>;

  beforeEach(() => {
    hooks = {};
    events = {};

    mockApi = {
      config: {
        enabled: true,
        endpoint: 'http://localhost:4318',
        root_idle_timeout_ms: 1000,
      },
      logger: {
        info: vi.fn(),
        error: vi.fn(),
      },
      registerHook: vi.fn((name, fn) => {
        hooks[name] = fn;
      }),
      on: vi.fn((name, fn) => {
        events[name] = fn;
      }),
    };
  });

  it('registers hooks and events when enabled', () => {
    registerPlugin(mockApi);

    expect(mockApi.registerHook).toHaveBeenCalledWith('inbound_claim', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('agent_end', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('llm_input', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('llm_output', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('before_tool_call', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('after_tool_call', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('subagent_spawning', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('subagent_spawned', expect.any(Function));
    expect(mockApi.on).toHaveBeenCalledWith('subagent_ended', expect.any(Function));
  });

  it('skips registration if disabled in config', () => {
    mockApi.config.enabled = false;
    registerPlugin(mockApi);

    expect(mockApi.registerHook).not.toHaveBeenCalled();
    expect(mockApi.on).not.toHaveBeenCalled();
    expect(mockApi.logger.info).toHaveBeenCalledWith(expect.stringContaining('disabled'));
  });

  it('simulates a complete run flow (inbound_claim -> llm -> agent_end)', async () => {
    registerPlugin(mockApi);

    const sessionId = 'test-session-1';

    // 1. Inbound claim
    await hooks['inbound_claim']({ sessionKey: sessionId, agentName: 'test-agent' });

    // 2. LLM input
    events['llm_input']({
      sessionId,
      model: 'gpt-4',
      provider: 'openai',
      systemPrompt: 'You are a helpful assistant',
    });

    // 3. LLM output
    events['llm_output']({
      sessionId,
      model: 'gpt-4',
      provider: 'openai',
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
      },
      durationMs: 1500,
      content: 'Hello world',
    });

    // 4. Agent end
    events['agent_end']({ sessionId });

    // Since we mocked OTEL, we are mostly verifying it doesn't crash 
    // and internal state transitions correctly without throwing.
    // If it reached here, the flow is structurally sound.
    expect(mockApi.logger.error).not.toHaveBeenCalled();
  });

  it('handles tool calls correctly', async () => {
    registerPlugin(mockApi);
    const sessionId = 'test-session-2';
    
    // Simulate flow with tool call
    await hooks['inbound_claim']({ sessionKey: sessionId });

    events['before_tool_call']({
      sessionId,
      toolCallId: 'call_1',
      toolName: 'web_search',
      params: { q: 'openclaw' },
    });

    events['after_tool_call']({
      sessionId,
      toolCallId: 'call_1',
      toolName: 'web_search',
      result: 'search results...',
      durationMs: 500,
    });

    events['agent_end']({ sessionId });

    expect(mockApi.logger.error).not.toHaveBeenCalled();
  });

  it('handles subagent calls correctly', async () => {
    registerPlugin(mockApi);
    const sessionId = 'test-session-3';
    
    await hooks['inbound_claim']({ sessionKey: sessionId });

    events['subagent_spawning']({
      sessionId,
      runId: 'sub-run-1',
      agentId: 'researcher',
      mode: 'delegation',
      prompt: 'do research',
    });

    events['subagent_spawned']({
      sessionId,
      runId: 'sub-run-1',
      agentId: 'researcher',
    });

    events['subagent_ended']({
      sessionId,
      runId: 'sub-run-1',
      result: 'research done',
      durationMs: 2000,
      tokens: { prompt: 5, completion: 15 },
    });

    events['agent_end']({ sessionId });

    expect(mockApi.logger.error).not.toHaveBeenCalled();
  });
});
