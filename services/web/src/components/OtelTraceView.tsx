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
  runId: string;
  runTrigger: string;
  messageProvider: string;
  parentSessionKey: string;
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
  assistantPreview: string;
  userMessageLen: string;
  runLineageId: string;
  parentRunLineageId: string;
  rootRunLineageId: string;
  runRelationSource: string;
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

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return `${value.toFixed(0)}%`;
}

function getSpanInsights(node: OtelSpan): SpanInsights {
  const attrs = parseAttrMap(node.Attributes);
  const resourceAttrs = parseAttrMap(node.ResourceAttrs);

  return {
    attrs,
    resourceAttrs,
    sessionId: readString(attrs.session_id, resourceAttrs.session_id),
    runId: readString(attrs.run_id, attrs['subagent.run_id']),
    runTrigger: readString(attrs.run_trigger, attrs.run_trigger),
    messageProvider: readString(attrs.message_provider),
    parentSessionKey: readString(attrs['subagent.parent_session_key']),
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
    assistantPreview: toPreview(attrs.assistant_preview, 220),
    userMessageLen: readString(typeof attrs.user_message_len === 'number' ? String(attrs.user_message_len) : attrs.user_message_len),
    runLineageId: readString(attrs.run_lineage_id),
    parentRunLineageId: readString(attrs.parent_run_lineage_id),
    rootRunLineageId: readString(attrs.root_run_lineage_id),
    runRelationSource: readString(attrs.run_relation_source),
    runStatus: readString(attrs.run_status),
    closeReason: readString(attrs.run_close_reason),
    llmCallCount: readString(typeof attrs.run_llm_call_count === 'number' ? String(attrs.run_llm_call_count) : attrs.run_llm_call_count),
    toolCallCount: readString(typeof attrs.run_tool_call_count === 'number' ? String(attrs.run_tool_call_count) : attrs.run_tool_call_count),
    subagentCallCount: readString(typeof attrs.run_subagent_call_count === 'number' ? String(attrs.run_subagent_call_count) : attrs.run_subagent_call_count),
    totalCostUsd: readString(typeof attrs.total_cost_usd === 'number' ? String(attrs.total_cost_usd) : attrs.total_cost_usd),
    totalTokens: readString(typeof attrs.total_tokens === 'number' ? String(attrs.total_tokens) : attrs.total_tokens),
  };
}

function isSubagentSession(sessionId: string): boolean {
  return sessionId.includes(':subagent:');
}

function resolveTopLevelSessionKey(
  sessionId: string,
  entriesBySession: Map<string, { trace: OtelSpan; insights: SpanInsights }>,
): string {
  let current = sessionId;
  const seen = new Set<string>();

  while (current && !seen.has(current)) {
    seen.add(current);
    const parentSessionKey = entriesBySession.get(current)?.insights.parentSessionKey;
    if (!parentSessionKey) return current;
    current = parentSessionKey;
  }

  return sessionId;
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
  const [runFilter, setRunFilter] = useState<'all' | 'root' | 'child' | 'fallback'>('all');
  const [relationSourceFilter, setRelationSourceFilter] = useState<string>('all');
  const [runSort, setRunSort] = useState<'latest' | 'duration' | 'cost' | 'error'>('latest');
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [traceTree, setTraceTree] = useState<SpanNode[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingTree, setLoadingTree] = useState(false);
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const [showTraceHeaderDetails, setShowTraceHeaderDetails] = useState(false);

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

  const recentRuns = useMemo(() => {
    return recentTraces
      .map((trace) => ({ trace, insights: getSpanInsights(trace) }))
      .sort((a, b) => new Date(b.trace.CreatedAt).getTime() - new Date(a.trace.CreatedAt).getTime());
  }, [recentTraces]);

  const relatedRuns = useMemo(() => {
    if (!selectedSummary?.insights.sessionId) return [];
    const entriesBySession = new Map<string, { trace: OtelSpan; insights: SpanInsights }>();
    for (const item of recentRuns) {
      if (item.insights.sessionId && !entriesBySession.has(item.insights.sessionId)) {
        entriesBySession.set(item.insights.sessionId, item);
      }
    }

    const selectedTopLevelSession = resolveTopLevelSessionKey(selectedSummary.insights.sessionId, entriesBySession);
    return recentRuns
      .filter(({ insights }) => {
        if (!insights.sessionId) return false;
        return resolveTopLevelSessionKey(insights.sessionId, entriesBySession) === selectedTopLevelSession;
      })
      .sort((a, b) => new Date(a.trace.CreatedAt).getTime() - new Date(b.trace.CreatedAt).getTime());
  }, [recentRuns, selectedSummary]);

  const relationSourceOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const { insights } of relatedRuns) {
      if (insights.runRelationSource) seen.add(insights.runRelationSource);
    }
    return ['all', ...Array.from(seen).sort()];
  }, [relatedRuns]);

  const filteredRelatedRuns = useMemo(() => {
    if (relationSourceFilter === 'all') return relatedRuns;
    return relatedRuns.filter(({ insights }) => insights.runRelationSource === relationSourceFilter);
  }, [relatedRuns, relationSourceFilter]);

  const filteredRecentRuns = useMemo(() => {
    let filtered = recentRuns;
    switch (runFilter) {
      case 'root':
        filtered = recentRuns.filter(({ insights }) => !isSubagentSession(insights.sessionId) && !insights.parentSessionKey);
        break;
      case 'child':
        filtered = recentRuns.filter(({ insights }) => isSubagentSession(insights.sessionId) || Boolean(insights.parentSessionKey));
        break;
      case 'fallback':
        filtered = recentRuns.filter(({ insights }) => insights.runRelationSource.includes('fallback'));
        break;
      default:
        filtered = recentRuns;
    }

    return [...filtered].sort((a, b) => {
      switch (runSort) {
        case 'duration':
          return b.trace.DurationNs - a.trace.DurationNs;
        case 'cost':
          return Number(b.insights.totalCostUsd || 0) - Number(a.insights.totalCostUsd || 0);
        case 'error':
          if (Number(b.trace.StatusCode === 2) !== Number(a.trace.StatusCode === 2)) return Number(b.trace.StatusCode === 2) - Number(a.trace.StatusCode === 2);
          return new Date(b.trace.CreatedAt).getTime() - new Date(a.trace.CreatedAt).getTime();
        case 'latest':
        default:
          return new Date(b.trace.CreatedAt).getTime() - new Date(a.trace.CreatedAt).getTime();
      }
    });
  }, [runFilter, runSort, recentRuns]);

  const relatedRunsSummary = useMemo(() => {
    if (relatedRuns.length === 0) return null;
    const members = relatedRuns.length;
    const visibleMembers = filteredRelatedRuns.length;
    const children = relatedRuns.filter(({ insights }) => Boolean(insights.parentSessionKey)).length;
    const fallback = relatedRuns.filter(({ insights }) => insights.runRelationSource.includes('fallback')).length;
    const errors = relatedRuns.filter(({ trace }) => trace.StatusCode === 2).length;
    const childSuccesses = relatedRuns.filter(({ trace, insights }) => Boolean(insights.parentSessionKey) && trace.StatusCode !== 2).length;
    const totalDurationMs = relatedRuns.reduce((sum, { trace }) => sum + trace.DurationNs / 1e6, 0);
    const totalTokens = relatedRuns.reduce((sum, { insights }) => sum + Number(insights.totalTokens || 0), 0);
    const totalCostUsd = relatedRuns.reduce((sum, { insights }) => sum + Number(insights.totalCostUsd || 0), 0);
    const errorRate = members > 0 ? (errors / members) * 100 : 0;
    const childSuccessRate = children > 0 ? (childSuccesses / children) * 100 : 0;
    return { members, visibleMembers, children, fallback, errors, childSuccesses, errorRate, childSuccessRate, totalDurationMs, totalTokens, totalCostUsd };
  }, [filteredRelatedRuns.length, relatedRuns]);

  useEffect(() => {
    setShowTraceHeaderDetails(false);
  }, [selectedTraceId]);

  useEffect(() => {
    if (relationSourceFilter === 'all') return;
    if (!relationSourceOptions.includes(relationSourceFilter)) {
      setRelationSourceFilter('all');
    }
  }, [relationSourceFilter, relationSourceOptions]);

  const relatedRunsNavigation = useMemo(() => {
    if (!selectedTraceId || relatedRuns.length === 0) return null;

    const selectedEntry = relatedRuns.find(({ trace }) => trace.TraceID === selectedTraceId);
    if (!selectedEntry) return null;

    const selectedSessionId = selectedEntry.insights.sessionId;
    const parentSessionKey = selectedEntry.insights.parentSessionKey;
    const parent = parentSessionKey
      ? [...relatedRuns].reverse().find(({ insights, trace }) => insights.sessionId === parentSessionKey && new Date(trace.CreatedAt).getTime() <= new Date(selectedEntry.trace.CreatedAt).getTime()) ?? null
      : null;

    const childCandidates = parentSessionKey
      ? relatedRuns.filter(({ insights }) => insights.parentSessionKey === parentSessionKey)
      : relatedRuns.filter(({ insights }) => insights.parentSessionKey === selectedSessionId);
    const currentChildIndex = childCandidates.findIndex(({ trace }) => trace.TraceID === selectedTraceId);
    const prevChild = parentSessionKey && currentChildIndex > 0 ? childCandidates[currentChildIndex - 1] : null;
    const nextChild = parentSessionKey
      ? (currentChildIndex >= 0 && currentChildIndex < childCandidates.length - 1 ? childCandidates[currentChildIndex + 1] : null)
      : childCandidates[0] ?? null;

    return {
      parent,
      prevChild,
      nextChild,
      childCount: childCandidates.length,
      currentChildIndex,
    };
  }, [relatedRuns, selectedTraceId]);

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
      insights.runTrigger
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
                    label="Lineage"
                    value={[
                      insights.runLineageId && `lineage.run_id: ${insights.runLineageId}`,
                      insights.parentRunLineageId && `lineage.parent_run_id: ${insights.parentRunLineageId}`,
                      insights.rootRunLineageId && `lineage.root_run_id: ${insights.rootRunLineageId}`,
                      insights.runRelationSource && `lineage.relation_source: ${insights.runRelationSource}`,
                      insights.runId && `run_id: ${insights.runId}`,
                      insights.runTrigger && `run_trigger: ${insights.runTrigger}`,
                      insights.messageProvider && `message_provider: ${insights.messageProvider}`,
                      insights.runStatus && `run_status: ${insights.runStatus}`,
                      insights.closeReason && `close_reason: ${insights.closeReason}`,
                      insights.userMessageLen && `message_len: ${insights.userMessageLen}`,
                      insights.parentSessionKey && `requester_session: ${insights.parentSessionKey}`,
                      insights.subagentChildSession && `child_session: ${insights.subagentChildSession}`,
                      insights.subagentMode && `mode: ${insights.subagentMode}`,
                      insights.subagentRunId && `subagent_run_id: ${insights.subagentRunId}`,
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
          <h3 className="text-sm font-medium text-white/80">Recent Runs</h3>
          <p className="mt-1 text-xs text-white/40">Shows recent root runs. Use session and requester hints to inspect likely related execution chains.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              ['all', 'All'],
              ['root', 'Main Runs'],
              ['child', 'Subagent Runs'],
              ['fallback', 'Fallback'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setRunFilter(value as 'all' | 'root' | 'child' | 'fallback')}
                className={`rounded-md border px-2 py-1 text-[11px] ${runFilter === value ? 'border-blue-500/40 bg-blue-500/15 text-blue-100' : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06]'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-white/60">
            <span>Sort</span>
            <select
              value={runSort}
              onChange={(e) => setRunSort(e.target.value as 'latest' | 'duration' | 'cost' | 'error')}
              className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-white outline-none"
            >
              <option value="latest">Latest</option>
              <option value="duration">Duration</option>
              <option value="cost">Cost</option>
              <option value="error">Error First</option>
            </select>
          </div>
        </div>
        <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto p-2">
          {filteredRecentRuns.map(({ trace, insights }) => {
            const errorPreview = insights.errorMessage || trace.StatusMessage;
            const preview = insights.userMessage || insights.assistantPreview || insights.toolResult || insights.toolParams;
            return (
              <div
                key={trace.TraceID}
                className={`rounded-xl border transition-all ${selectedTraceId === trace.TraceID ? 'border-blue-500/20 bg-blue-500/[0.04] shadow-[0_0_0_1px_rgba(59,130,246,0.08)]' : 'border-white/10 bg-white/[0.02]'}`}
              >
                <button
                  type="button"
                  onClick={() => handleSelectTrace(trace.TraceID)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <TraceBadge label={trace.StatusCode === 2 ? 'run:error' : 'run:ok'} tone={trace.StatusCode === 2 ? 'red' : 'emerald'} />
                      {isSubagentSession(insights.sessionId) || insights.parentSessionKey ? (
                        <TraceBadge label="subagent" tone="yellow" />
                      ) : (
                        <TraceBadge label="main" tone="blue" />
                      )}
                      {insights.runRelationSource && <TraceBadge label={insights.runRelationSource} tone={insights.runRelationSource.includes('fallback') ? 'yellow' : 'purple'} />}
                      <span className="font-mono text-xs text-white/70" title={insights.runId || trace.TraceID}>
                        run:{shortId(insights.runId || trace.TraceID, 12)}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-white/40">
                      {new Date(trace.CreatedAt).toLocaleString()}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-white/35">
                      <span>{(trace.DurationNs / 1e6).toFixed(1)} ms</span>
                      <span>{insights.totalTokens || '0'} tokens</span>
                      <span>${Number(insights.totalCostUsd || 0).toFixed(4)}</span>
                      {insights.sessionId && <span title={insights.sessionId}>session:{shortId(insights.sessionId, 10)}</span>}
                      {insights.parentSessionKey && <span title={insights.parentSessionKey}>requester:{shortId(insights.parentSessionKey, 10)}</span>}
                      {insights.runTrigger && <span>{insights.runTrigger}</span>}
                    </div>
                    {preview && (
                      <div className="mt-2 text-[11px] text-white/55" title={preview}>
                        {preview}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-white/50">Open</div>
                </button>
                {errorPreview && (
                  <div className="mx-3 mb-3 rounded-md border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-100">
                    {toPreview(errorPreview, 180)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="glass-card flex flex-col overflow-hidden lg:w-[66%]">
        <div className="border-b border-white/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-white/80">Run Trace Tree</h3>
            {selectedTraceId && (
              <span className="rounded bg-white/5 px-2 py-1 font-mono text-[10px] text-white/40">
                {selectedTraceId}
              </span>
            )}
          </div>

          {selectedSummary && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  <TraceBadge label={selectedSummary.insights.runStatus || 'ok'} tone={selectedSummary.insights.runStatus === 'error' ? 'red' : 'emerald'} />
                  <TraceBadge label={`spans:${selectedSummary.spanCount}`} tone="blue" />
                  <TraceBadge label={`errors:${selectedSummary.errorCount}`} tone={selectedSummary.errorCount > 0 ? 'red' : 'emerald'} />
                  {selectedSummary.insights.runRelationSource && <TraceBadge label={selectedSummary.insights.runRelationSource} tone="purple" />}
                  {selectedSummary.insights.closeReason && <TraceBadge label={`close:${selectedSummary.insights.closeReason}`} tone="blue" />}
                </div>
                <button
                  type="button"
                  onClick={() => setShowTraceHeaderDetails((current) => !current)}
                  className="rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-white/60 hover:bg-white/[0.04]"
                >
                  {showTraceHeaderDetails ? '收起详情' : '展开详情'}
                </button>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-white/35">Run</div>
                  <div className="mt-1 font-mono text-[11px] text-white/75">
                    {shortId(selectedSummary.insights.runId || selectedSummary.root.TraceID, 12)}
                  </div>
                  <div className="mt-1 text-[11px] text-white/45">
                    {formatNsTimestamp(selectedSummary.root.StartTimeUnix)} · {(selectedSummary.root.DurationNs / 1e6).toFixed(2)} ms
                  </div>
                </div>
                <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-white/35">Counts</div>
                  <div className="mt-1 text-[11px] text-white/75">
                    LLM {selectedSummary.insights.llmCallCount || '0'} · Tool {selectedSummary.insights.toolCallCount || '0'} · Subagent {selectedSummary.insights.subagentCallCount || '0'}
                  </div>
                  <div className="mt-1 text-[11px] text-white/45">
                    Tokens {selectedSummary.insights.totalTokens || '0'} · Cost ${selectedSummary.insights.totalCostUsd || '0'}
                  </div>
                </div>
                <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wide text-white/35">Related Runs</div>
                  <div className="mt-1 text-[11px] text-white/75">
                    {relatedRunsSummary ? `Runs ${relatedRunsSummary.members} · Subagent ${relatedRunsSummary.children}` : 'No related runs found'}
                  </div>
                  <div className="mt-1 text-[11px] text-white/45">
                    {relatedRunsSummary ? `Visible ${relatedRunsSummary.visibleMembers} · Error ${formatPercent(relatedRunsSummary.errorRate)}` : '-'}
                  </div>
                </div>
              </div>
              {showTraceHeaderDetails && (
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <DetailBlock label="Trace" value={[
                    `root: ${selectedSummary.root.Name}`,
                    `started: ${formatNsTimestamp(selectedSummary.root.StartTimeUnix)}`,
                    `duration_ms: ${(selectedSummary.root.DurationNs / 1e6).toFixed(2)}`,
                  ].join('\n')} />
                  <DetailBlock label="Run" value={[
                    selectedSummary.insights.sessionId && `session_id: ${selectedSummary.insights.sessionId}`,
                    selectedSummary.insights.runId && `run_id: ${selectedSummary.insights.runId}`,
                    selectedSummary.insights.parentSessionKey && `requester_session_key: ${selectedSummary.insights.parentSessionKey}`,
                    selectedSummary.insights.runTrigger && `run_trigger: ${selectedSummary.insights.runTrigger}`,
                    selectedSummary.insights.messageProvider && `message_provider: ${selectedSummary.insights.messageProvider}`,
                    selectedSummary.insights.model && `model: ${selectedSummary.insights.model}`,
                    selectedSummary.insights.provider && `provider: ${selectedSummary.insights.provider}`,
                  ].filter(Boolean).join('\n')} />
                  <DetailBlock label="Counts" value={[
                    `llm_calls: ${selectedSummary.insights.llmCallCount || '0'}`,
                    `tool_calls: ${selectedSummary.insights.toolCallCount || '0'}`,
                    `subagent_calls: ${selectedSummary.insights.subagentCallCount || '0'}`,
                    `total_tokens: ${selectedSummary.insights.totalTokens || '0'}`,
                    `total_cost_usd: ${selectedSummary.insights.totalCostUsd || '0'}`,
                  ].join('\n')} />
                  <DetailBlock label="Related Runs" value={relatedRunsSummary ? [
                    `runs: ${relatedRunsSummary.members}`,
                    `visible: ${relatedRunsSummary.visibleMembers}`,
                    `subagent_runs: ${relatedRunsSummary.children}`,
                    `subagent_success_rate: ${formatPercent(relatedRunsSummary.childSuccessRate)}`,
                    `error_rate: ${formatPercent(relatedRunsSummary.errorRate)}`,
                    `duration_ms: ${relatedRunsSummary.totalDurationMs.toFixed(2)}`,
                  ].join('\n') : 'No related runs found'} />
                </div>
              )}
              {showTraceHeaderDetails && (selectedSummary.insights.errorMessage || selectedSummary.insights.userMessage || selectedSummary.insights.assistantPreview || selectedSummary.insights.toolResult || selectedSummary.insights.toolParams) && (
                <div className="grid gap-2 md:grid-cols-2">
                  <DetailBlock label="Error" value={selectedSummary.insights.errorMessage} tone="red" />
                  <DetailBlock label="Context" value={selectedSummary.insights.userMessage || selectedSummary.insights.assistantPreview || selectedSummary.insights.toolResult || selectedSummary.insights.toolParams} />
                </div>
              )}
            </div>
          )}
          {selectedSummary && (
            <div className="mt-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-white/40">Related Runs</div>
                  {relatedRunsSummary && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      <TraceBadge label={`error-rate:${formatPercent(relatedRunsSummary.errorRate)}`} tone={relatedRunsSummary.errorRate > 0 ? 'red' : 'emerald'} />
                      <TraceBadge label={`subagent-success:${formatPercent(relatedRunsSummary.childSuccessRate)}`} tone={relatedRunsSummary.childSuccessRate < 100 && relatedRunsSummary.children > 0 ? 'yellow' : 'emerald'} />
                      <TraceBadge label={`visible:${relatedRunsSummary.visibleMembers}/${relatedRunsSummary.members}`} tone="blue" />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-white/60">
                  <span>Relation Source</span>
                  <select
                    aria-label="Relation Source Filter"
                    value={relationSourceFilter}
                    onChange={(e) => setRelationSourceFilter(e.target.value)}
                    className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-white outline-none"
                  >
                    {relationSourceOptions.map((source) => (
                      <option key={source} value={source}>
                        {source === 'all' ? 'All Sources' : source}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {filteredRelatedRuns.length > 0 ? (
                <div className="space-y-2">
                  {filteredRelatedRuns.map(({ trace, insights }) => {
                    const role = insights.parentSessionKey ? 'subagent' : 'main';
                    const status = trace.StatusCode === 2 ? 'error' : 'ok';
                    const preview = insights.userMessage || insights.assistantPreview || insights.toolResult || insights.toolParams;
                    return (
                      <button
                        key={trace.TraceID}
                        type="button"
                        onClick={() => handleSelectTrace(trace.TraceID)}
                        className={`w-full rounded-md border px-3 py-2 text-left ${selectedTraceId === trace.TraceID ? 'border-blue-500/30 bg-blue-500/10' : 'border-white/10 bg-black/20 hover:bg-white/[0.04]'}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <TraceBadge label={role} tone={role === 'subagent' ? 'yellow' : 'emerald'} />
                          <TraceBadge label={status} tone={status === 'error' ? 'red' : 'emerald'} />
                          {insights.runRelationSource && <TraceBadge label={insights.runRelationSource} tone={insights.runRelationSource.includes('fallback') ? 'yellow' : 'purple'} />}
                          <span className="font-mono text-[11px] text-white/70">
                            {shortId(insights.runId || trace.TraceID, 12)}
                          </span>
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-white/40">
                          trace={shortId(trace.TraceID, 10)} started={new Date(trace.CreatedAt).toLocaleTimeString()} session={shortId(insights.sessionId, 10)}
                        </div>
                        {preview && (
                          <div className="mt-1 text-[11px] text-white/55" title={preview}>
                            {preview}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-white/50">
                  No related runs match this relation source
                </div>
              )}
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
              {relatedRunsNavigation && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => relatedRunsNavigation.parent && handleSelectTrace(relatedRunsNavigation.parent.trace.TraceID)}
                    disabled={!relatedRunsNavigation.parent}
                    className="rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-white/70 disabled:cursor-not-allowed disabled:opacity-30 hover:bg-white/[0.04]"
                  >
                    切到 parent
                  </button>
                  <button
                    type="button"
                    onClick={() => relatedRunsNavigation.prevChild && handleSelectTrace(relatedRunsNavigation.prevChild.trace.TraceID)}
                    disabled={!relatedRunsNavigation.prevChild}
                    className="rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-white/70 disabled:cursor-not-allowed disabled:opacity-30 hover:bg-white/[0.04]"
                  >
                    切到 prev child
                  </button>
                  <button
                    type="button"
                    onClick={() => relatedRunsNavigation.nextChild && handleSelectTrace(relatedRunsNavigation.nextChild.trace.TraceID)}
                    disabled={!relatedRunsNavigation.nextChild}
                    className="rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-white/70 disabled:cursor-not-allowed disabled:opacity-30 hover:bg-white/[0.04]"
                  >
                    切到 next child
                  </button>
                  <span className="text-[10px] font-mono text-white/40">
                    children:{relatedRunsNavigation.childCount}
                    {relatedRunsNavigation.currentChildIndex >= 0 ? ` current:${relatedRunsNavigation.currentChildIndex + 1}` : ''}
                  </span>
                </div>
              )}
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
