import { describe, it, expect, vi, beforeEach } from 'vitest';
import registerPlugin from './index.js';

const otelApiState = vi.hoisted(() => {
  let spanCounter = 0;
  const spans: Array<{ name: string; span: any; parentCtx: any }> = [];

  const createSpan = (name: string) => ({
    id: `${name}-${spanCounter++}`,
    setAttribute: vi.fn(),
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
  });

  const startSpan = vi.fn((name: string, _options?: unknown, parentCtx?: unknown) => {
    const span = createSpan(name);
    spans.push({ name, span, parentCtx });
    return span;
  });

  const setSpan = vi.fn((ctx: any, span: any) => ({ ...(ctx || {}), __span: span }));
  const active = vi.fn(() => ({}));
  const withFn = vi.fn((_ctx: any, fn: () => unknown) => fn());
  const reset = () => {
    spanCounter = 0;
    spans.length = 0;
    startSpan.mockClear();
    setSpan.mockClear();
    active.mockReset();
    active.mockReturnValue({});
    withFn.mockClear();
  };

  return { spans, startSpan, setSpan, active, withFn, reset };
});

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
      startSpan: otelApiState.startSpan,
    }),
    setSpan: otelApiState.setSpan,
  },
  context: {
    active: otelApiState.active,
    with: otelApiState.withFn,
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
    otelApiState.reset();
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

  it('uses resolved sessionId during inbound_claim and closes on agent_end', async () => {
    registerPlugin(mockApi);
    const sessionId = 'agent:main:demo:123';

    await hooks['inbound_claim']({ sessionId, agentName: 'demo-agent' });

    expect(otelApiState.spans).toHaveLength(1);
    expect(otelApiState.spans[0].name).toBe('command.process');
    expect(otelApiState.spans[0].span.setAttribute).toHaveBeenCalledWith('session_id', sessionId);

    events['agent_end']({ sessionId });

    expect(otelApiState.spans[0].span.setAttribute).toHaveBeenCalledWith('root_close_reason', 'agent_end');
    expect(otelApiState.spans[0].span.end).toHaveBeenCalled();
  });

  it('merges namespaced sessionKey and bare sessionId into one root trace', async () => {
    registerPlugin(mockApi);
    const sessionKey = 'agent:main:feishu:direct:ou_xxx:01264e32-1ba7-482a-a12d-3bd5ca3f1fc1';
    const sessionId = '01264e32-1ba7-482a-a12d-3bd5ca3f1fc1';

    await hooks['inbound_claim']({ sessionKey, sessionId, agentName: 'main-agent' });

    events['llm_input']({
      sessionId,
      model: 'MiniMax-M2.7-highspeed',
      provider: 'minimax-portal',
    });

    events['before_tool_call']({
      sessionKey,
      toolCallId: 'call_1',
      toolName: 'sessions_spawn',
      params: {},
    });

    events['agent_end']({ sessionId });

    const rootSpans = otelApiState.spans.filter((entry) => entry.name === 'command.process');
    expect(rootSpans).toHaveLength(1);
    expect(rootSpans[0].span.setAttribute).toHaveBeenCalledWith('session_id', sessionKey);
    expect(rootSpans[0].span.setAttribute).toHaveBeenCalledWith('root_close_reason', 'agent_end');
    expect(rootSpans[0].span.end).toHaveBeenCalled();
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
    const childSessionId = 'test-session-3-child';
    
    await hooks['inbound_claim']({ sessionKey: sessionId });

    events['subagent_spawning']({
      requesterSessionKey: sessionId,
      childSessionKey: childSessionId,
      runId: 'sub-run-1',
      agentId: 'researcher',
      mode: 'delegation',
      prompt: 'do research',
    });

    events['subagent_spawned']({
      childSessionKey: childSessionId,
      runId: 'sub-run-1',
      agentId: 'researcher',
    });

    events['subagent_ended']({
      childSessionKey: childSessionId,
      runId: 'sub-run-1',
      result: 'research done',
      durationMs: 2000,
      tokens: { prompt: 5, completion: 15 },
    });

    events['agent_end']({ sessionId });

    expect(mockApi.logger.error).not.toHaveBeenCalled();
  });

  it('inherits the parent run trace for child session spans', async () => {
    registerPlugin(mockApi);
    const parentSessionId = 'parent-run';
    const childRunId = '59eec270-a221-4ecb-ba34-6293444dfd9f';
    const childSessionId = `agent:main:subagent:${childRunId}`;

    await hooks['inbound_claim']({ sessionKey: parentSessionId, agentName: 'planner' });

    events['subagent_spawning']({
      requesterSessionKey: parentSessionId,
      childSessionKey: childRunId,
      runId: childRunId,
      agentId: 'researcher',
      mode: 'delegation',
    });

    await hooks['inbound_claim']({ sessionId: childSessionId, agentName: 'researcher' });

    events['llm_input']({
      sessionId: childSessionId,
      model: 'gpt-4',
      provider: 'openai',
    });

    expect(otelApiState.spans).toHaveLength(4);

    const parentRoot = otelApiState.spans[0];
    const subagentSpan = otelApiState.spans[1];
    const childRoot = otelApiState.spans[2];
    const childLlm = otelApiState.spans[3];

    expect(parentRoot.name).toBe('command.process');
    expect(subagentSpan.name).toBe('subagent:researcher');
    expect(childRoot.name).toBe('command.process');
    expect(childLlm.name).toBe('llm.completion: gpt-4');

    expect(subagentSpan.parentCtx).toMatchObject({ __span: parentRoot.span });
    expect(childRoot.parentCtx).toMatchObject({ __span: subagentSpan.span });
    expect(childLlm.parentCtx).toMatchObject({ __span: childRoot.span });

    expect(childRoot.span.setAttribute).toHaveBeenCalledWith('subagent.parent_session_key', parentSessionId);
    expect(childRoot.span.setAttribute).toHaveBeenCalledWith('subagent.inherited_trace', true);
  });

  it('falls back to sessions_spawn results when subagent lifecycle hooks are absent', async () => {
    registerPlugin(mockApi);
    const parentSessionId = 'agent:main:feishu:direct:parent';
    const childRunId = '79d45840-c390-455f-a689-7888acd493ae';
    const childSessionId = `agent:main:subagent:${childRunId}`;

    await hooks['inbound_claim']({ sessionKey: parentSessionId, agentName: 'main-agent' });

    events['before_tool_call']({
      sessionKey: parentSessionId,
      toolCallId: 'call_spawn',
      toolName: 'sessions_spawn',
      params: { agentId: 'researcher', label: 'researcher', mode: 'run' },
    });

    events['after_tool_call']({
      sessionKey: parentSessionId,
      toolCallId: 'call_spawn',
      toolName: 'sessions_spawn',
      result: {
        status: 'accepted',
        runId: childRunId,
        childSessionKey: childSessionId,
      },
    });

    events['agent_end']({ sessionId: parentSessionId });

    await hooks['inbound_claim']({ sessionId: childSessionId, agentName: 'researcher' });

    events['llm_input']({
      sessionId: childSessionId,
      model: 'MiniMax-M2.7-highspeed',
      provider: 'minimax-portal',
    });

    events['agent_end']({ sessionId: childSessionId });

    const parentRoot = otelApiState.spans[0];
    const sessionsSpawnTool = otelApiState.spans[1];
    const fallbackSubagent = otelApiState.spans[2];
    const childRoot = otelApiState.spans[3];
    const childLlm = otelApiState.spans[4];

    expect(parentRoot.name).toBe('command.process');
    expect(sessionsSpawnTool.name).toBe('tool.call: sessions_spawn');
    expect(fallbackSubagent.name).toBe('subagent:researcher');
    expect(childRoot.name).toBe('command.process');
    expect(childLlm.name).toBe('llm.completion: MiniMax-M2.7-highspeed');

    expect(childRoot.parentCtx).toMatchObject({ __span: fallbackSubagent.span });
    expect(fallbackSubagent.span.end).toHaveBeenCalled();
    expect(childRoot.span.setAttribute).toHaveBeenCalledWith('subagent.parent_session_key', parentSessionId);
    expect(childRoot.span.setAttribute).toHaveBeenCalledWith('subagent.inherited_trace', true);
  });
});
