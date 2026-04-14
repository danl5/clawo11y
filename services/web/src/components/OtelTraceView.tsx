import { useEffect, useMemo, useState } from 'react';

interface OtelSpan {
  ID: number;
  TraceID: string;
  SpanID: string;
  ParentSpanID: string;
  Name: string;
  Kind: number;
  StartTimeUnix: number;
  EndTimeUnix: number;
  DurationNs: number;
  StatusCode: number;
  StatusMessage: string;
  Model: string;
  Provider: string;
  ToolName: string;
  PromptTokens: number;
  CompletionTokens: number;
  TotalTokens: number;
  CostUsd: number;
  Attributes: unknown;
  ResourceAttrs: unknown;
  CreatedAt: string;
}

interface SpanNode extends OtelSpan {
  children?: SpanNode[];
}

type AttrMap = Record<string, unknown>;

interface SpanInsights {
  attrs: AttrMap;
  resourceAttrs: AttrMap;
  sessionId: string;
  provider: string;
  model: string;
  toolName: string;
  toolCallId: string;
  errorMessage: string;
  toolParams: string;
  toolResult: string;
  serviceName: string;
  hostName: string;
  subagentLabel: string;
  subagentMode: string;
  subagentRunId: string;
  subagentChildSession: string;
  errorType: string;
  userMessage: string;
  userMessageLen: string;
  commandTrigger: string;
  runStatus: string;
  closeReason: string;
  llmCallCount: string;
  toolCallCount: string;
  subagentCallCount: string;
  totalCostUsd: string;
  totalTokens: string;
}

export function parseAttrMap(value: unknown): AttrMap {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as AttrMap) : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? (value as AttrMap) : {};
}

export function readString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function toPreview(value: unknown, maxLen: number = 180): string {
  if (value === undefined || value === null) return '';
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}...`;
}

export function shortId(value: string, size: number = 8): string {
  if (!value) return '-';
  return value.length <= size ? value : `${value.slice(0, size)}...`;
}

export function formatNsTimestamp(unixNs: number): string {
  if (!unixNs) return '-';
  return new Date(Math.floor(unixNs / 1e6)).toLocaleString();
}

function countSpans(node: SpanNode): number {
  return 1 + (node.children ?? []).reduce((sum, child) => sum + countSpans(child), 0);
}

function countErroredSpans(node: SpanNode): number {
  const self = node.StatusCode === 2 ? 1 : 0;
  return self + (node.children ?? []).reduce((sum, child) => sum + countErroredSpans(child), 0);
}

function getSpanInsights(node: OtelSpan): SpanInsights {
  const attrs = parseAttrMap(node.Attributes);
  const resourceAttrs = parseAttrMap(node.ResourceAttrs);

  return {
    attrs,
    resourceAttrs,
    sessionId: readString(attrs.session_id, resourceAttrs.session_id),
    provider: readString(node.Provider, attrs.provider, resourceAttrs['service.provider']),
    model: readString(node.Model, attrs.model),
    toolName: readString(node.ToolName, attrs.tool_name),
    toolCallId: readString(attrs.tool_call_id),
    errorMessage: readString(node.StatusMessage, attrs.error, attrs['subagent.error']),
    toolParams: toPreview(attrs.tool_params || attrs.params, 220),
    toolResult: toPreview(attrs.tool_result || attrs['subagent.result'], 220),
    serviceName: readString(resourceAttrs['service.name']),
    hostName: readString(resourceAttrs['host.name'], resourceAttrs.host),
    subagentLabel: readString(attrs['subagent.label'], attrs['subagent.agent_id']),
    subagentMode: readString(attrs['subagent.mode']),
    subagentRunId: readString(attrs['subagent.run_id']),
    subagentChildSession: readString(attrs['subagent.child_session_key']),
    errorType: readString(attrs.error_type, attrs['subagent.error_type']),
    userMessage: toPreview(attrs.user_message, 220),
    userMessageLen: readString(typeof attrs.user_message_len === 'number' ? String(attrs.user_message_len) : attrs.user_message_len),
    commandTrigger: readString(attrs.command_trigger),
    runStatus: readString(attrs.run_status),
    closeReason: readString(attrs.root_close_reason),
    llmCallCount: readString(typeof attrs.llm_call_count === 'number' ? String(attrs.llm_call_count) : attrs.llm_call_count),
    toolCallCount: readString(typeof attrs.tool_call_count === 'number' ? String(attrs.tool_call_count) : attrs.tool_call_count),
    subagentCallCount: readString(typeof attrs.subagent_call_count === 'number' ? String(attrs.subagent_call_count) : attrs.subagent_call_count),
    totalCostUsd: readString(typeof attrs.total_cost_usd === 'number' ? String(attrs.total_cost_usd) : attrs.total_cost_usd),
    totalTokens: readString(typeof attrs.total_tokens === 'number' ? String(attrs.total_tokens) : attrs.total_tokens),
  };
}

function TraceBadge({ label, tone = 'default' }: { label: string; tone?: 'default' | 'blue' | 'yellow' | 'red' | 'purple' | 'emerald' }) {
  const toneClass = {
    default: 'bg-white/5 text-white/60 border-white/10',
    blue: 'bg-blue-500/15 text-blue-200 border-blue-500/30',
    yellow: 'bg-yellow-500/15 text-yellow-200 border-yellow-500/30',
    red: 'bg-red-500/15 text-red-200 border-red-500/30',
    purple: 'bg-purple-500/15 text-purple-200 border-purple-500/30',
    emerald: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30',
  }[tone];

  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-md border shrink-0 ${toneClass}`}>
      {label}
    </span>
  );
}

function DetailBlock({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'red' }) {
  if (!value) return null;

  return (
    <div className={`rounded-md border px-2.5 py-2 text-[11px] ${tone === 'red' ? 'border-red-500/30 bg-red-500/10 text-red-100' : 'border-white/10 bg-black/20 text-white/70'}`}>
      <div className="text-[10px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-5">{value}</div>
    </div>
  );
}

export function OtelTraceView() {
  const [recentTraces, setRecentTraces] = useState<OtelSpan[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [traceTree, setTraceTree] = useState<SpanNode[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingTree, setLoadingTree] = useState(false);
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});

  const handleSelectTrace = (traceId: string) => {
    setSelectedTraceId(traceId);
    setLoadingTree(true);
    fetch(`/api/v1/otlp/trace/${traceId}`)
      .then((res) => res.json())
      .then((json) => {
        setTraceTree(json);
        setLoadingTree(false);
      })
      .catch((err) => {
        console.error('Failed to fetch trace tree:', err);
        setLoadingTree(false);
      });
  };

  useEffect(() => {
    fetch('/api/v1/otlp/traces/recent')
      .then((res) => res.json())
      .then((json) => {
        if (Array.isArray(json)) {
          setRecentTraces(json);
          if (json.length > 0) {
            handleSelectTrace(json[0].TraceID);
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch recent traces:', err);
        setLoading(false);
      });
  }, []);

  const selectedSummary = useMemo(() => {
    if (!traceTree || traceTree.length === 0) return null;

    const root = traceTree[0];
    const insights = getSpanInsights(root);
    const spanCount = traceTree.reduce((sum, node) => sum + countSpans(node), 0);
    const errorCount = traceTree.reduce((sum, node) => sum + countErroredSpans(node), 0);

    return {
      root,
      insights,
      spanCount,
      errorCount,
    };
  }, [traceTree]);

  const toggleExpanded = (spanId: string) => {
    setExpandedDetails((prev) => ({
      ...prev,
      [spanId]: !(prev[spanId] ?? false),
    }));
  };

  const renderSpanNode = (node: SpanNode, depth: number = 0, rootStartTime: number = 0, rootDuration: number = 0) => {
    const insights = getSpanInsights(node);
    const durationMs = (node.DurationNs / 1e6).toFixed(2);
    const hasChildren = (node.children?.length ?? 0) > 0;
    const hasDetailContent = Boolean(
      insights.errorMessage ||
      insights.errorType ||
      insights.userMessage ||
      insights.toolParams ||
      insights.toolResult ||
      insights.subagentChildSession ||
      insights.subagentRunId ||
      insights.subagentMode ||
      insights.serviceName ||
      insights.hostName ||
      insights.commandTrigger
    );
    const detailOpen = expandedDetails[node.SpanID] ?? node.StatusCode === 2;

    let leftPercent = 0;
    let widthPercent = 100;

    if (rootDuration > 0) {
      const startOffsetNs = Math.max(0, node.StartTimeUnix - rootStartTime);
      leftPercent = (startOffsetNs / rootDuration) * 100;
      widthPercent = (node.DurationNs / rootDuration) * 100;
      widthPercent = Math.max(0.5, Math.min(100 - leftPercent, widthPercent));
    }

    return (
      <div key={node.SpanID} className="mt-1.5 flex flex-col">
        <div
          className={`relative rounded-lg border px-3 py-2.5 transition-all hover:bg-white/[0.04] ${depth === 0 ? 'border-white/10 bg-white/[0.03]' : 'border-white/5 bg-transparent'}`}
          style={{ marginLeft: `${depth * 16}px` }}
        >
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-lg opacity-20">
            <div
              className="absolute top-0 bottom-0 rounded-sm"
              style={{
                left: `${leftPercent}%`,
                width: `${widthPercent}%`,
                background: node.StatusCode === 2 ? '#ef4444' : '#3b82f6'
              }}
            />
          </div>

          <div className="relative z-10 flex items-start gap-3">
            <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${node.StatusCode === 2 ? 'bg-red-500 shadow-[0_0_8px_#ef4444]' : 'bg-emerald-500'}`} />

            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-mono text-sm text-white/90" title={node.Name}>{node.Name}</span>
                {insights.model && <TraceBadge label={insights.model} tone="blue" />}
                {insights.provider && <TraceBadge label={insights.provider} tone="purple" />}
                {insights.toolName && <TraceBadge label={insights.toolName} tone="yellow" />}
                {insights.subagentLabel && <TraceBadge label={`subagent:${insights.subagentLabel}`} tone="emerald" />}
                {node.StatusCode === 2 && <TraceBadge label="error" tone="red" />}
                {insights.runStatus && depth === 0 && <TraceBadge label={`run:${insights.runStatus}`} tone={insights.runStatus === 'error' ? 'red' : 'emerald'} />}
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-white/50">
                <span title={node.SpanID}>Span: {shortId(node.SpanID)}</span>
                {node.ParentSpanID && <span title={node.ParentSpanID}>Parent: {shortId(node.ParentSpanID)}</span>}
                {insights.sessionId && <span title={insights.sessionId}>Session: {shortId(insights.sessionId, 14)}</span>}
                {insights.toolCallId && <span title={insights.toolCallId}>Call: {shortId(insights.toolCallId, 14)}</span>}
                <span title={formatNsTimestamp(node.StartTimeUnix)}>Start: {formatNsTimestamp(node.StartTimeUnix)}</span>
                {node.TotalTokens > 0 && <span className="font-bold text-purple-300">Tokens: {node.TotalTokens}</span>}
                {node.CostUsd > 0 && <span className="font-bold text-orange-300">Cost: ${node.CostUsd.toFixed(6)}</span>}
                {insights.errorType && <span className="text-red-300">Type: {insights.errorType}</span>}
                {insights.closeReason && <span>Close: {insights.closeReason}</span>}
                {insights.llmCallCount && <span>LLM: {insights.llmCallCount}</span>}
                {insights.toolCallCount && <span>Tool: {insights.toolCallCount}</span>}
                {insights.subagentCallCount && <span>Subagent: {insights.subagentCallCount}</span>}
              </div>

              {hasDetailContent && (
                <div className="flex items-center gap-2 text-[10px] font-mono text-white/45">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(node.SpanID)}
                    className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-white/60 hover:bg-white/10"
                  >
                    {detailOpen ? '收起详情' : '展开详情'}
                  </button>
                  {insights.userMessage && !detailOpen && <span title={insights.userMessage}>Msg: {toPreview(insights.userMessage, 80)}</span>}
                  {insights.errorMessage && !detailOpen && <span className="text-red-300" title={insights.errorMessage}>Err: {toPreview(insights.errorMessage, 80)}</span>}
                </div>
              )}

              {hasDetailContent && detailOpen && (
                <div className="grid gap-2 md:grid-cols-2">
                  <DetailBlock label="Error" value={insights.errorMessage} tone="red" />
                  <DetailBlock label="Error Type" value={insights.errorType} />
                  <DetailBlock label="User Message" value={insights.userMessage} />
                  <DetailBlock label="Tool Params" value={insights.toolParams} />
                  <DetailBlock label="Tool Result" value={insights.toolResult} />
                  <DetailBlock
                    label="Context"
                    value={[
                      insights.commandTrigger && `trigger: ${insights.commandTrigger}`,
                      insights.runStatus && `run_status: ${insights.runStatus}`,
                      insights.closeReason && `close_reason: ${insights.closeReason}`,
                      insights.userMessageLen && `message_len: ${insights.userMessageLen}`,
                      insights.subagentChildSession && `child_session: ${insights.subagentChildSession}`,
                      insights.subagentMode && `mode: ${insights.subagentMode}`,
                      insights.subagentRunId && `run_id: ${insights.subagentRunId}`,
                      insights.serviceName && `service: ${insights.serviceName}`,
                      insights.hostName && `host: ${insights.hostName}`,
                    ].filter(Boolean).join('\n')}
                  />
                </div>
              )}
            </div>

            <div className="shrink-0 text-right font-mono text-xs font-bold text-white/70">
              <div>{durationMs} ms</div>
            </div>
          </div>
        </div>

        {hasChildren && (
          <div className="ml-[8px] flex flex-col border-l border-white/10">
            {node.children!.map((child) => renderSpanNode(child, depth + 1, rootStartTime, rootDuration))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return <div className="p-8 text-center text-white/50 animate-pulse">Loading Traces...</div>;
  }

  if (recentTraces.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
        <span className="mb-4 text-4xl">🔍</span>
        <h3 className="text-lg font-medium text-white/80">No Traces Found</h3>
        <p className="mt-2 max-w-sm text-sm text-white/40">
          Once OpenClaw agents start executing tasks, distributed traces will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[680px] flex-col gap-5 animate-fade-up lg:h-full lg:min-h-0 lg:flex-row">
      <div className="glass-card flex flex-col overflow-hidden lg:w-[34%]">
        <div className="border-b border-white/10 p-4">
          <h3 className="text-sm font-medium text-white/80">Recent Traces</h3>
          <p className="mt-1 text-xs text-white/40">Shows timing, status, and the most useful identifiers available on each trace root.</p>
        </div>
        <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto p-2">
          {recentTraces.map((trace) => {
            const insights = getSpanInsights(trace);
            const errorPreview = insights.errorMessage || trace.StatusMessage;

            return (
              <button
                key={trace.TraceID}
                onClick={() => handleSelectTrace(trace.TraceID)}
                className={`w-full rounded-lg border p-3 text-left transition-all ${selectedTraceId === trace.TraceID ? 'border-blue-500/30 bg-blue-500/10' : 'border-transparent hover:bg-white/[0.04]'}`}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm text-white/90" title={trace.Name}>{trace.Name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {trace.StatusCode === 2 ? <TraceBadge label="error" tone="red" /> : <TraceBadge label="ok" tone="emerald" />}
                      {insights.runStatus && <TraceBadge label={`run:${insights.runStatus}`} tone={insights.runStatus === 'error' ? 'red' : 'emerald'} />}
                      {insights.model && <TraceBadge label={insights.model} tone="blue" />}
                      {insights.provider && <TraceBadge label={insights.provider} tone="purple" />}
                      {insights.sessionId && <TraceBadge label={`session:${shortId(insights.sessionId, 10)}`} />}
                    </div>
                  </div>
                  <div className="shrink-0 text-[10px] text-white/40">
                    {new Date(trace.CreatedAt).toLocaleString()}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-white/50">
                  <span title={trace.TraceID}>Trace: {shortId(trace.TraceID, 10)}</span>
                  <span title={trace.SpanID}>Root Span: {shortId(trace.SpanID)}</span>
                  <span>{(trace.DurationNs / 1e6).toFixed(1)} ms</span>
                  {insights.totalCostUsd && <span>Cost: ${Number(insights.totalCostUsd).toFixed(4)}</span>}
                  {insights.totalTokens && <span>Tokens: {insights.totalTokens}</span>}
                </div>

                {errorPreview && (
                  <div className="mt-2 rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-100">
                    {toPreview(errorPreview, 180)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="glass-card flex flex-col overflow-hidden lg:w-[66%]">
        <div className="border-b border-white/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-white/80">Trace Call Tree</h3>
            {selectedTraceId && (
              <span className="rounded bg-white/5 px-2 py-1 font-mono text-[10px] text-white/40">
                {selectedTraceId}
              </span>
            )}
          </div>

          {selectedSummary && (
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <DetailBlock label="Trace Summary" value={[
                `root: ${selectedSummary.root.Name}`,
                `started: ${formatNsTimestamp(selectedSummary.root.StartTimeUnix)}`,
                `duration_ms: ${(selectedSummary.root.DurationNs / 1e6).toFixed(2)}`,
                `spans: ${selectedSummary.spanCount}`,
                `errors: ${selectedSummary.errorCount}`,
                selectedSummary.insights.runStatus && `run_status: ${selectedSummary.insights.runStatus}`,
                selectedSummary.insights.closeReason && `close_reason: ${selectedSummary.insights.closeReason}`,
              ].join('\n')} />
              <DetailBlock label="Invocation" value={[
                selectedSummary.insights.sessionId && `session_id: ${selectedSummary.insights.sessionId}`,
                selectedSummary.insights.model && `model: ${selectedSummary.insights.model}`,
                selectedSummary.insights.provider && `provider: ${selectedSummary.insights.provider}`,
                selectedSummary.insights.commandTrigger && `trigger: ${selectedSummary.insights.commandTrigger}`,
                selectedSummary.insights.llmCallCount && `llm_calls: ${selectedSummary.insights.llmCallCount}`,
                selectedSummary.insights.toolCallCount && `tool_calls: ${selectedSummary.insights.toolCallCount}`,
                selectedSummary.insights.subagentCallCount && `subagent_calls: ${selectedSummary.insights.subagentCallCount}`,
                selectedSummary.insights.totalTokens && `total_tokens: ${selectedSummary.insights.totalTokens}`,
                selectedSummary.insights.totalCostUsd && `total_cost_usd: ${selectedSummary.insights.totalCostUsd}`,
                selectedSummary.insights.serviceName && `service: ${selectedSummary.insights.serviceName}`,
                selectedSummary.insights.hostName && `host: ${selectedSummary.insights.hostName}`,
              ].filter(Boolean).join('\n')} />
              <DetailBlock label="Error" value={selectedSummary.insights.errorMessage} tone="red" />
              <DetailBlock label="User Message" value={selectedSummary.insights.userMessage} />
              <DetailBlock label="Latest Output" value={selectedSummary.insights.toolResult || selectedSummary.insights.toolParams} />
            </div>
          )}
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto p-4">
          {loadingTree ? (
            <div className="flex h-full items-center justify-center text-white/50 animate-pulse">
              Loading Trace Tree...
            </div>
          ) : traceTree && traceTree.length > 0 ? (
            <div className="space-y-4">
              {traceTree.map((rootNode) => {
                const rootStartTime = rootNode.StartTimeUnix;
                let maxEndTime = rootNode.EndTimeUnix;

                const findMaxEnd = (n: SpanNode) => {
                  if (n.EndTimeUnix > maxEndTime) maxEndTime = n.EndTimeUnix;
                  if (n.children) n.children.forEach(findMaxEnd);
                };
                findMaxEnd(rootNode);

                const rootDuration = Math.max(1, maxEndTime - rootStartTime);

                return renderSpanNode(rootNode, 0, rootStartTime, rootDuration);
              })}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-white/50">
              Select a trace to view its call tree
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
