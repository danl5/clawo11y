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

const metricState = vi.hoisted(() => {
  const counters = new Map<string, { add: ReturnType<typeof vi.fn> }>();
  const histograms = new Map<string, { record: ReturnType<typeof vi.fn> }>();

  const getCounter = (name: string) => {
    if (!counters.has(name)) counters.set(name, { add: vi.fn() });
    return counters.get(name)!;
  };

  const getHistogram = (name: string) => {
    if (!histograms.has(name)) histograms.set(name, { record: vi.fn() });
    return histograms.get(name)!;
  };

  const reset = () => {
    counters.clear();
    histograms.clear();
  };

  return { counters, histograms, getCounter, getHistogram, reset };
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
        createCounter: (name: string) => metricState.getCounter(name),
        createHistogram: (name: string) => metricState.getHistogram(name),
        createUpDownCounter: (name: string) => metricState.getCounter(name),
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
    metricState.reset();
    vi.useRealTimers();
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

  it('prefers llm_output lastAssistant.usage for token and cost accounting', async () => {
    registerPlugin(mockApi);
    const sessionId = 'agent:main:demo:last-assistant-usage';

    await hooks['inbound_claim']({ sessionKey: sessionId, agentName: 'demo-agent' });

    events['llm_input']({
      sessionId,
      model: 'MiniMax-M2.7-highspeed',
      provider: 'minimax-portal',
      systemPrompt: 'You are a helpful assistant',
    });

    events['llm_output']({
      sessionId,
      model: 'MiniMax-M2.7-highspeed',
      provider: 'minimax-portal',
      lastAssistant: {
        usage: {
          input: 24248,
          output: 98,
          cacheRead: 12397,
          cacheWrite: 0,
          totalTokens: 36743,
          cost: {
            input: 0.0145488,
            output: 0.0002352,
            cacheRead: 0.00074382,
            cacheWrite: 0,
            total: 0.01552782,
          },
        },
      },
    });

    const llmSpanEntry = otelApiState.spans.find((entry) => entry.name === 'llm.completion: MiniMax-M2.7-highspeed');
    expect(llmSpanEntry).toBeTruthy();

    const llmSpan = llmSpanEntry!.span;
    expect(llmSpan.setAttribute).toHaveBeenCalledWith('prompt_tokens', 24248);
    expect(llmSpan.setAttribute).toHaveBeenCalledWith('completion_tokens', 98);
    expect(llmSpan.setAttribute).toHaveBeenCalledWith('cache_read_tokens', 12397);
    expect(llmSpan.setAttribute).toHaveBeenCalledWith('cache_write_tokens', 0);
    expect(llmSpan.setAttribute).toHaveBeenCalledWith('total_tokens', 36743);
    expect(llmSpan.setAttribute).toHaveBeenCalledWith('cost_usd', 0.01552782);
    expect(llmSpan.setAttribute).toHaveBeenCalledWith('usage_source', 'lastAssistant.usage');
  });

  it('keeps token metric labels when llm_output omits model and provider', async () => {
    registerPlugin(mockApi);
    const sessionId = 'agent:main:demo:metric-label-fallback';

    await hooks['inbound_claim']({ sessionKey: sessionId, agentName: 'demo-agent' });

    events['llm_input']({
      sessionId,
      model: 'MiniMax-M2.7-highspeed',
      provider: 'minimax-portal',
    });

    events['llm_output']({
      sessionId,
      lastAssistant: {
        usage: {
          input: 10,
          output: 5,
          totalTokens: 15,
          cost: {
            total: 0.01,
          },
        },
      },
    });

    expect(metricState.counters.get('openclaw.llm.tokens.total')?.add).toHaveBeenCalledWith(15, {
      model: 'MiniMax-M2.7-highspeed',
      provider: 'minimax-portal',
    });
    expect(metricState.counters.get('openclaw.llm.cost.usd')?.add).toHaveBeenCalledWith(0.01, {
      model: 'MiniMax-M2.7-highspeed',
      provider: 'minimax-portal',
    });

    const rootSpan = otelApiState.spans.find((entry) => entry.name === 'command.process')?.span;
    expect(rootSpan?.setAttribute).toHaveBeenCalledWith('last_model', 'MiniMax-M2.7-highspeed');
    expect(rootSpan?.setAttribute).toHaveBeenCalledWith('last_provider', 'minimax-portal');
  });

  it('uses resolved sessionId during inbound_claim and closes on agent_end', async () => {
    registerPlugin(mockApi);
    const sessionId = 'agent:main:demo:123';

    await hooks['inbound_claim']({ sessionId, agentName: 'demo-agent' });

    expect(otelApiState.spans).toHaveLength(1);
    expect(otelApiState.spans[0].name).toBe('command.process');
    expect(otelApiState.spans[0].span.setAttribute).toHaveBeenCalledWith('session_id', sessionId);
    expect(otelApiState.spans[0].span.setAttribute).toHaveBeenCalledWith('run_trigger', 'inbound_claim');
    expect(otelApiState.spans[0].span.setAttribute).toHaveBeenCalledWith('root_run_lineage_id', expect.any(String));
    expect(otelApiState.spans[0].span.setAttribute).toHaveBeenCalledWith('run_lineage_id', expect.any(String));

    events['agent_end']({ sessionId });

    expect(otelApiState.spans[0].span.setAttribute).toHaveBeenCalledWith('run_close_reason', 'agent_end');
    expect(otelApiState.spans[0].span.setAttribute).toHaveBeenCalledWith('run_close_reason', 'agent_end');
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
    expect(rootSpans[0].span.setAttribute).toHaveBeenCalledWith('run_close_reason', 'agent_end');
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

    expect(childRoot.span.setAttribute).toHaveBeenCalledWith('parent_run_lineage_id', expect.any(String));
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
    const parentRunLineageIdCall = parentRoot.span.setAttribute.mock.calls.find(([key]: [string]) => key === 'run_lineage_id');
    const parentRootRunLineageIdCall = parentRoot.span.setAttribute.mock.calls.find(([key]: [string]) => key === 'root_run_lineage_id');

    expect(parentRoot.name).toBe('command.process');
    expect(sessionsSpawnTool.name).toBe('tool.call: sessions_spawn');
    expect(fallbackSubagent.name).toBe('subagent:researcher');
    expect(childRoot.name).toBe('command.process');
    expect(childLlm.name).toBe('llm.completion: MiniMax-M2.7-highspeed');

    expect(childRoot.parentCtx).toMatchObject({ __span: fallbackSubagent.span });
    expect(fallbackSubagent.span.end).toHaveBeenCalled();
    expect(parentRunLineageIdCall?.[1]).toBeTruthy();
    expect(parentRootRunLineageIdCall?.[1]).toBeTruthy();
    expect(childRoot.span.setAttribute).toHaveBeenCalledWith('parent_run_lineage_id', parentRunLineageIdCall?.[1]);
    expect(childRoot.span.setAttribute).toHaveBeenCalledWith('root_run_lineage_id', parentRootRunLineageIdCall?.[1]);
    expect(childRoot.span.setAttribute).toHaveBeenCalledWith('run_relation_source', 'sessions_spawn_fallback');
    expect(childRoot.span.setAttribute).toHaveBeenCalledWith('subagent.parent_session_key', parentSessionId);
    expect(childRoot.span.setAttribute).toHaveBeenCalledWith('subagent.inherited_trace', true);
  });

  it('parses sessions_spawn result payloads wrapped in content text and details', async () => {
    registerPlugin(mockApi);
    const parentSessionId = 'agent:main:feishu:direct:parent';
    const childRunId = 'eec9c3eb-7648-44c1-992d-efe76218cb0a';
    const childSessionId = 'agent:main:subagent:d3d34e3b-c7a1-4f6b-892c-66deeffd3879';

    await hooks['inbound_claim']({ sessionKey: parentSessionId, agentName: 'main-agent' });

    events['before_tool_call']({
      sessionKey: parentSessionId,
      toolCallId: 'call_spawn_wrapped',
      toolName: 'sessions_spawn',
      params: {
        task: 'weather',
        runtime: 'subagent',
        mode: 'run',
      },
    });

    events['subagent_spawned']({
      childSessionKey: childSessionId,
      runId: childRunId,
    });

    events['after_tool_call']({
      sessionKey: parentSessionId,
      toolCallId: 'call_spawn_wrapped',
      toolName: 'sessions_spawn',
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'accepted',
              childSessionKey: childSessionId,
              runId: childRunId,
              mode: 'run',
            }),
          },
        ],
        details: {
          status: 'accepted',
          childSessionKey: childSessionId,
          runId: childRunId,
          mode: 'run',
        },
      },
    });

    events['agent_end']({ sessionId: parentSessionId });

    await hooks['inbound_claim']({ sessionId: childSessionId, agentName: 'researcher' });

    events['llm_input']({
      sessionId: childSessionId,
      model: 'MiniMax-M2.7-highspeed',
      provider: 'minimax-portal',
    });

    const parentRoot = otelApiState.spans[0];
    const fallbackSubagent = otelApiState.spans.find((entry) => entry.name === 'subagent:subagent');
    const childRoot = [...otelApiState.spans].reverse().find((entry) => entry.name === 'command.process');
    const parentRunLineageIdCall = parentRoot.span.setAttribute.mock.calls.find(([key]: [string]) => key === 'run_lineage_id');
    const parentRootRunLineageIdCall = parentRoot.span.setAttribute.mock.calls.find(([key]: [string]) => key === 'root_run_lineage_id');

    expect(fallbackSubagent).toBeTruthy();
    expect(childRoot?.parentCtx).toMatchObject({ __span: fallbackSubagent?.span });
    expect(parentRunLineageIdCall?.[1]).toBeTruthy();
    expect(parentRootRunLineageIdCall?.[1]).toBeTruthy();
    expect(childRoot?.span.setAttribute).toHaveBeenCalledWith('parent_run_lineage_id', parentRunLineageIdCall?.[1]);
    expect(childRoot?.span.setAttribute).toHaveBeenCalledWith('root_run_lineage_id', parentRootRunLineageIdCall?.[1]);
    expect(childRoot?.span.setAttribute).toHaveBeenCalledWith('run_relation_source', 'sessions_spawn_fallback');
  });

  it('keeps related runs linked when the parent session resumes after multiple subagents finish', async () => {
    registerPlugin(mockApi);
    const parentSessionId = 'agent:main:feishu:direct:parent';
    const child1SessionId = 'agent:main:subagent:child-1';
    const child2SessionId = 'agent:main:subagent:child-2';

    await hooks['inbound_claim']({ sessionKey: parentSessionId, agentName: 'main-agent' });

    events['subagent_spawning']({
      requesterSessionKey: parentSessionId,
      childSessionKey: child1SessionId,
      runId: 'child-run-1',
      agentId: 'researcher-a',
      label: 'researcher-a',
      mode: 'run',
    });

    events['subagent_spawning']({
      requesterSessionKey: parentSessionId,
      childSessionKey: child2SessionId,
      runId: 'child-run-2',
      agentId: 'researcher-b',
      label: 'researcher-b',
      mode: 'run',
    });

    const originalRoot = otelApiState.spans[0];
    const originalRunLineageId = originalRoot.span.setAttribute.mock.calls.find(([key]: [string]) => key === 'run_lineage_id')?.[1];
    const originalRootRunLineageId = originalRoot.span.setAttribute.mock.calls.find(([key]: [string]) => key === 'root_run_lineage_id')?.[1];

    events['agent_end']({ sessionId: parentSessionId });

    events['subagent_ended']({
      childSessionKey: child1SessionId,
      runId: 'child-run-1',
      result: 'child one done',
      mode: 'run',
    });

    events['subagent_ended']({
      childSessionKey: child2SessionId,
      runId: 'child-run-2',
      result: 'child two done',
      mode: 'run',
    });

    events['llm_input']({
      sessionId: parentSessionId,
      model: 'MiniMax-M2.7-highspeed',
      provider: 'minimax-portal',
    });

    const parentRoots = otelApiState.spans.filter((entry) => entry.name === 'command.process');
    expect(parentRoots).toHaveLength(2);

    const resumedRoot = parentRoots[1];
    expect(originalRunLineageId).toBeTruthy();
    expect(originalRootRunLineageId).toBeTruthy();
    expect(resumedRoot.span.setAttribute).toHaveBeenCalledWith('root_run_lineage_id', originalRootRunLineageId);
    expect(resumedRoot.span.setAttribute).toHaveBeenCalledWith('parent_run_lineage_id', originalRunLineageId);
    expect(resumedRoot.span.setAttribute).toHaveBeenCalledWith('run_relation_source', 'session_continuation');
  });

  it('does not leave orphan session stats that later emit idle timeout closes', async () => {
    vi.useFakeTimers();
    registerPlugin(mockApi);
    const parentSessionId = 'agent:main:feishu:direct:parent';
    const childSessionId = 'agent:main:subagent:child-1';

    await hooks['inbound_claim']({ sessionKey: parentSessionId, agentName: 'main-agent' });

    events['before_tool_call']({
      sessionKey: parentSessionId,
      toolCallId: 'call_spawn_idle',
      toolName: 'sessions_spawn',
      params: { mode: 'run' },
    });

    events['after_tool_call']({
      sessionKey: parentSessionId,
      toolCallId: 'call_spawn_idle',
      toolName: 'sessions_spawn',
      result: {
        details: {
          status: 'accepted',
          childSessionKey: childSessionId,
          runId: 'child-run-idle',
          mode: 'run',
        },
      },
    });

    events['agent_end']({ sessionId: parentSessionId });
    events['subagent_ended']({
      childSessionKey: childSessionId,
      runId: 'child-run-idle',
      result: 'done',
      mode: 'run',
    });

    vi.advanceTimersByTime(1500);

    expect(mockApi.logger.error).not.toHaveBeenCalledWith(expect.stringContaining('run.close_without_root'));
  });
});
