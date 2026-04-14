import { useEffect, useMemo, useState } from 'react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend
} from 'recharts';

interface CostSummary {
  window_days: number;
  total_cost_usd: number;
  total_calls: number;
  total_tokens: number;
  avg_cost_per_call: number;
  avg_tokens_per_call: number;
}

interface ModelStats {
  model: string;
  provider: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_cost_usd: number;
  calls: number;
  avg_cost_per_call: number;
}

interface ProviderStats {
  provider: string;
  total_cost_usd: number;
  total_tokens: number;
  calls: number;
  avg_cost_per_call: number;
}

interface TopRun {
  trace_id: string;
  session_id: string;
  user_message: string;
  status: string;
  duration_ms: number;
  total_cost_usd: number;
  total_tokens: number;
  llm_calls: number;
  tool_calls: number;
  subagent_calls: number;
  last_model: string;
  created_at: string;
}

interface ToolReliability {
  tool_name: string;
  calls: number;
  errors: number;
  error_rate: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
  max_duration_ms: number;
}

interface ContextBloatSummary {
  window_days: number;
  sessions_evaluated: number;
  alert_candidates: number;
  severe_candidates: number;
  max_prompt_tokens_seen: number;
}

interface ContextBloatPoint {
  turn_index: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  model: string;
  provider: string;
  created_at: string;
  trace_id: string;
}

interface ContextBloatCandidate {
  session_id: string;
  trace_id: string;
  agent_name: string;
  last_model: string;
  run_status: string;
  user_message: string;
  points: ContextBloatPoint[];
  turns: number;
  max_prompt_tokens: number;
  latest_prompt_tokens: number;
  growth_ratio: number;
  growth_slope: number;
  alert_level: string;
  created_at: string;
}

interface ContextBloatData {
  summary: ContextBloatSummary;
  candidates: ContextBloatCandidate[];
}

interface CostData {
  summary: CostSummary;
  models: ModelStats[];
  providers: ProviderStats[];
  trend: Array<Record<string, string | number>>;
  provider_keys: string[];
  top_runs: TopRun[];
  tool_reliability: ToolReliability[];
}

interface SpanNode {
  TraceID: string;
  SpanID: string;
  ParentSpanID: string;
  Name: string;
  DurationNs: number;
  StatusCode: number;
  CostUsd: number;
  TotalTokens: number;
  Attributes: unknown;
  children?: SpanNode[];
}

type FlameMode = 'cost' | 'tokens';

interface FlameBlock {
  id: string;
  name: string;
  left: number;
  width: number;
  depth: number;
  ownCost: number;
  aggregateCost: number;
  ownTokens: number;
  aggregateTokens: number;
  durationMs: number;
  statusCode: number;
}

const COLORS = ['#3b82f6', '#8b5cf6', '#34d399', '#fb923c', '#f472b6', '#60a5fa', '#a78bfa', '#22c55e', '#eab308'];

function formatCurrency(value: number) {
  return `$${value.toFixed(4)}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDurationMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 ms';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${value.toFixed(1)} ms`;
}

function truncate(value: string, max = 80) {
  if (!value) return '';
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="glass-card p-5 relative overflow-hidden">
      <div className="absolute top-0 right-0 h-32 w-32 rounded-full bg-orange-500/10 blur-3xl -mr-10 -mt-10" />
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-white/40">{label}</h4>
      <div className="text-3xl font-bold text-white/90">{value}</div>
      <div className="mt-1 text-xs text-white/40">{hint}</div>
    </div>
  );
}

function buildFlameBlocks(roots: SpanNode[], mode: FlameMode) {
  const rows: FlameBlock[][] = [];

  const aggregate = (node: SpanNode): { cost: number; tokens: number } => {
    const children = node.children ?? [];
    const childTotals = children.reduce((acc, child) => {
      const childAgg = aggregate(child);
      acc.cost += childAgg.cost;
      acc.tokens += childAgg.tokens;
      return acc;
    }, { cost: 0, tokens: 0 });

    const ownCost = node.ParentSpanID ? (node.CostUsd || 0) : 0;
    const ownTokens = node.ParentSpanID ? (node.TotalTokens || 0) : 0;
    return {
      cost: ownCost + childTotals.cost,
      tokens: ownTokens + childTotals.tokens,
    };
  };

  const totals = roots.map((root) => ({
    root,
    aggregate: aggregate(root),
  }));
  const totalMetric = totals.reduce((sum, item) => sum + (mode === 'cost' ? item.aggregate.cost : item.aggregate.tokens), 0);

  const walk = (node: SpanNode, depth: number, left: number, rootTotal: number) => {
    const nodeTotals = aggregate(node);
    const metric = mode === 'cost' ? nodeTotals.cost : nodeTotals.tokens;
    const width = rootTotal > 0 ? (metric / rootTotal) * 100 : 100;
    const ownCost = node.ParentSpanID ? (node.CostUsd || 0) : 0;
    const ownTokens = node.ParentSpanID ? (node.TotalTokens || 0) : 0;

    if (!rows[depth]) rows[depth] = [];
    rows[depth].push({
      id: node.SpanID,
      name: node.Name,
      left,
      width,
      depth,
      ownCost,
      aggregateCost: nodeTotals.cost,
      ownTokens,
      aggregateTokens: nodeTotals.tokens,
      durationMs: node.DurationNs / 1e6,
      statusCode: node.StatusCode,
    });

    let cursor = left;
    (node.children ?? []).forEach((child) => {
      const childTotals = aggregate(child);
      const childMetric = mode === 'cost' ? childTotals.cost : childTotals.tokens;
      const childWidth = rootTotal > 0 ? (childMetric / rootTotal) * 100 : 0;
      walk(child, depth + 1, cursor, rootTotal);
      cursor += childWidth;
    });
  };

  let rootCursor = 0;
  totals.forEach(({ root, aggregate: nodeTotals }) => {
    const metric = mode === 'cost' ? nodeTotals.cost : nodeTotals.tokens;
    const width = totalMetric > 0 ? (metric / totalMetric) * 100 : 100;
    walk(root, 0, rootCursor, totalMetric || 1);
    rootCursor += width;
  });

  return { rows, totalMetric };
}

export function OtelCostDashboard() {
  const [data, setData] = useState<CostData | null>(null);
  const [contextBloat, setContextBloat] = useState<ContextBloatData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [traceTree, setTraceTree] = useState<SpanNode[] | null>(null);
  const [flameMode, setFlameMode] = useState<FlameMode>('cost');
  const [loadingTrace, setLoadingTrace] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/otlp/dashboard/cost').then((res) => res.json()),
      fetch('/api/v1/otlp/dashboard/context-bloat').then((res) => res.json()),
    ])
      .then(([costJson, bloatJson]) => {
        setData(costJson);
        setContextBloat(bloatJson);
        setLoading(false);
        if (costJson?.top_runs?.length) {
          setSelectedTraceId(costJson.top_runs[0].trace_id);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch cost data:', err);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!selectedTraceId) return;
    setLoadingTrace(true);
    fetch(`/api/v1/otlp/trace/${selectedTraceId}`)
      .then((res) => res.json())
      .then((json) => {
        setTraceTree(Array.isArray(json) ? json : []);
        setLoadingTrace(false);
      })
      .catch((err) => {
        console.error('Failed to fetch trace tree for flame graph:', err);
        setLoadingTrace(false);
      });
  }, [selectedTraceId]);

  const flameData = useMemo(() => {
    if (!traceTree || traceTree.length === 0) return null;
    return buildFlameBlocks(traceTree, flameMode);
  }, [traceTree, flameMode]);

  if (loading) {
    return <div className="p-8 text-center text-white/50 animate-pulse">Loading Cost Dashboard...</div>;
  }

  if (!data || (!data.models?.length && !data.trend?.length && !data.top_runs?.length)) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
        <span className="mb-4 text-4xl">💰</span>
        <h3 className="text-lg font-medium text-white/80">No Cost Data Yet</h3>
        <p className="mt-2 max-w-sm text-sm text-white/40">
          Once OpenClaw starts sending OTel traces with token and cost information, they will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label={`AI Spend (${data.summary.window_days}d)`}
          value={formatCurrency(data.summary.total_cost_usd)}
          hint="Total estimated LLM spend"
        />
        <SummaryCard
          label="LLM Calls"
          value={formatNumber(data.summary.total_calls)}
          hint="Total model invocations"
        />
        <SummaryCard
          label="Avg Cost / Call"
          value={formatCurrency(data.summary.avg_cost_per_call)}
          hint={`Avg tokens / call: ${formatNumber(Math.round(data.summary.avg_tokens_per_call))}`}
        />
        <SummaryCard
          label="Total Tokens"
          value={formatNumber(data.summary.total_tokens)}
          hint="Prompt + completion tokens"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="glass-card p-5 xl:col-span-2">
          <h3 className="mb-1 text-sm font-medium text-white/75">Global Cost Dashboard</h3>
          <p className="mb-4 text-xs text-white/40">Stacked provider spend by day. Answers where money goes over time.</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{ background: '#0a0f1e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                formatter={(val: unknown) => [formatCurrency(Number(val || 0)), 'Cost']}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {data.provider_keys.map((provider, index) => (
                <Bar key={provider} dataKey={provider} stackId="cost" fill={COLORS[index % COLORS.length]} radius={index === data.provider_keys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-5">
          <h3 className="mb-1 text-sm font-medium text-white/75">Provider Spend</h3>
          <p className="mb-4 text-xs text-white/40">Helps CFO and infra owners spot who is burning budget.</p>
          <div className="space-y-3">
            {data.providers.map((provider, index) => (
              <div key={provider.provider || `provider-${index}`} className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[index % COLORS.length] }} />
                    <span className="text-sm text-white/80">{provider.provider || 'unknown'}</span>
                  </div>
                  <span className="font-mono text-sm text-orange-300">{formatCurrency(provider.total_cost_usd)}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/45">
                  <span>calls: {formatNumber(provider.calls)}</span>
                  <span>tokens: {formatNumber(provider.total_tokens)}</span>
                  <span>avg/call: {formatCurrency(provider.avg_cost_per_call)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="glass-card p-5">
          <h3 className="mb-1 text-sm font-medium text-white/75">Top Expensive Runs</h3>
          <p className="mb-4 text-xs text-white/40">Select a run to inspect where the cost or tokens concentrate.</p>
          <div className="space-y-2">
            {data.top_runs.map((run) => (
              <button
                key={run.trace_id}
                type="button"
                onClick={() => setSelectedTraceId(run.trace_id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${selectedTraceId === run.trace_id ? 'border-orange-500/30 bg-orange-500/10' : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'}`}
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div className="min-w-0 text-sm text-white/85">{truncate(run.user_message || run.session_id || run.trace_id, 70)}</div>
                  <span className="shrink-0 font-mono text-[11px] text-orange-300">{formatCurrency(run.total_cost_usd)}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-white/45">
                  <span>{new Date(run.created_at).toLocaleTimeString()}</span>
                  <span>{run.last_model || 'unknown model'}</span>
                  <span>{formatNumber(run.total_tokens)} tok</span>
                  <span>{formatDurationMs(run.duration_ms)}</span>
                  <span>{run.status}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-white/75">Cost Flame Graph</h3>
              <p className="mt-1 text-xs text-white/40">Width represents cumulative {flameMode === 'cost' ? 'cost' : 'token'} contribution inside the selected run.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFlameMode('cost')}
                className={`rounded-md border px-3 py-1 text-xs ${flameMode === 'cost' ? 'border-orange-500/30 bg-orange-500/10 text-orange-200' : 'border-white/10 bg-white/5 text-white/55'}`}
              >
                Cost Mode
              </button>
              <button
                type="button"
                onClick={() => setFlameMode('tokens')}
                className={`rounded-md border px-3 py-1 text-xs ${flameMode === 'tokens' ? 'border-purple-500/30 bg-purple-500/10 text-purple-200' : 'border-white/10 bg-white/5 text-white/55'}`}
              >
                Token Mode
              </button>
            </div>
          </div>

          {loadingTrace ? (
            <div className="flex h-[300px] items-center justify-center text-sm text-white/45">Loading selected trace...</div>
          ) : flameData && flameData.totalMetric > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-white/45">
                <span>Total {flameMode === 'cost' ? 'cost' : 'tokens'} in view</span>
                <span className="font-mono text-white/70">
                  {flameMode === 'cost' ? formatCurrency(flameData.totalMetric) : formatNumber(Math.round(flameData.totalMetric))}
                </span>
              </div>
              <div className="space-y-1">
                {flameData.rows.map((row, depth) => (
                  <div key={`row-${depth}`} className="relative h-11 rounded-md bg-white/[0.02]">
                    {row.map((block) => (
                      <div
                        key={block.id}
                        className={`absolute top-1 bottom-1 overflow-hidden rounded-sm border px-2 py-1 ${block.statusCode === 2 ? 'border-red-500/30 bg-red-500/20' : flameMode === 'cost' ? 'border-orange-500/20 bg-orange-500/20' : 'border-purple-500/20 bg-purple-500/20'}`}
                        style={{ left: `${block.left}%`, width: `${Math.max(block.width, 1)}%` }}
                        title={`${block.name}
agg cost: ${formatCurrency(block.aggregateCost)}
agg tokens: ${formatNumber(Math.round(block.aggregateTokens))}
duration: ${formatDurationMs(block.durationMs)}`}
                      >
                        <div className="truncate text-[10px] font-mono text-white/85">{block.name}</div>
                        <div className="truncate text-[9px] text-white/55">
                          {flameMode === 'cost' ? formatCurrency(block.aggregateCost) : `${formatNumber(Math.round(block.aggregateTokens))} tok`}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-[300px] items-center justify-center text-sm text-white/45">
              No cost/token flame data available for the selected trace yet.
            </div>
          )}
        </div>
      </div>

      {contextBloat && (
        <div className="glass-card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-white/75">Context Bloat Alert</h3>
              <p className="mt-1 text-xs text-white/40">Flags sessions whose prompt token growth suggests runaway loops or exploding context.</p>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] text-white/50">
              <span className="rounded border border-white/10 bg-white/5 px-2 py-1">evaluated: {formatNumber(contextBloat.summary.sessions_evaluated)}</span>
              <span className="rounded border border-yellow-500/20 bg-yellow-500/10 px-2 py-1 text-yellow-300">warning+: {formatNumber(contextBloat.summary.alert_candidates)}</span>
              <span className="rounded border border-red-500/20 bg-red-500/10 px-2 py-1 text-red-300">severe: {formatNumber(contextBloat.summary.severe_candidates)}</span>
              <span className="rounded border border-purple-500/20 bg-purple-500/10 px-2 py-1 text-purple-300">max prompt: {formatNumber(contextBloat.summary.max_prompt_tokens_seen)}</span>
            </div>
          </div>

          {contextBloat.candidates.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm text-white/45">
              No candidate session currently exceeds the prompt-growth thresholds.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
              <div className="space-y-2">
                {contextBloat.candidates.map((candidate) => (
                  <div
                    key={`${candidate.session_id}-${candidate.trace_id}`}
                    className={`rounded-lg border p-3 ${candidate.alert_level === 'severe' ? 'border-red-500/25 bg-red-500/10' : 'border-yellow-500/20 bg-yellow-500/10'}`}
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <div className="min-w-0 text-sm text-white/85">{truncate(candidate.user_message || candidate.session_id || candidate.trace_id, 72)}</div>
                      <span className={`shrink-0 rounded border px-2 py-0.5 text-[10px] uppercase ${candidate.alert_level === 'severe' ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300'}`}>
                        {candidate.alert_level}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-white/45">
                      <span>turns: {candidate.turns}</span>
                      <span>growth: {candidate.growth_ratio.toFixed(2)}x</span>
                      <span>slope: {candidate.growth_slope.toFixed(0)}</span>
                      <span>max: {formatNumber(candidate.max_prompt_tokens)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-4">
                {contextBloat.candidates.map((candidate) => (
                  <div key={`chart-${candidate.session_id}-${candidate.trace_id}`} className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm text-white/85">{truncate(candidate.user_message || candidate.session_id || candidate.trace_id, 96)}</div>
                        <div className="mt-1 text-[11px] text-white/40">
                          {candidate.agent_name || 'unknown agent'} · {candidate.last_model || 'unknown model'} · latest prompt {formatNumber(candidate.latest_prompt_tokens)}
                        </div>
                      </div>
                      <div className={`rounded border px-2 py-1 text-[10px] uppercase ${candidate.alert_level === 'severe' ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300'}`}>
                        {candidate.alert_level}
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={candidate.points}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                        <XAxis dataKey="turn_index" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false} />
                        <Tooltip
                          contentStyle={{ background: '#0a0f1e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                          formatter={(val: unknown) => [formatNumber(Number(val || 0)), 'tokens']}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="prompt_tokens" fill="#fb923c" name="Prompt Tokens" />
                        <Bar dataKey="completion_tokens" fill="#34d399" name="Completion Tokens" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="glass-card overflow-x-auto p-5">
        <div className="mb-4">
          <h3 className="text-sm font-medium text-white/75">Tool Reliability Matrix</h3>
          <p className="mt-1 text-xs text-white/40">Prioritizes which tool integrations deserve SRE attention first.</p>
        </div>
        <table className="min-w-[760px] w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-white/10 text-xs text-white/40">
              <th className="pb-2 font-medium">Tool</th>
              <th className="pb-2 font-medium text-right">Calls</th>
              <th className="pb-2 font-medium text-right">Errors</th>
              <th className="pb-2 font-medium text-right">Error Rate</th>
              <th className="pb-2 font-medium text-right">Avg</th>
              <th className="pb-2 font-medium text-right">P95</th>
              <th className="pb-2 font-medium text-right">Max</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {data.tool_reliability.map((tool) => (
              <tr key={tool.tool_name} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                <td className="py-3 font-mono text-xs text-white/80">{tool.tool_name}</td>
                <td className="py-3 text-right font-mono text-white/60">{formatNumber(tool.calls)}</td>
                <td className="py-3 text-right font-mono text-white/60">{formatNumber(tool.errors)}</td>
                <td className={`py-3 text-right font-mono ${tool.error_rate >= 0.2 ? 'text-red-300' : tool.error_rate >= 0.05 ? 'text-yellow-300' : 'text-emerald-300'}`}>
                  {(tool.error_rate * 100).toFixed(1)}%
                </td>
                <td className="py-3 text-right font-mono text-blue-300">{formatDurationMs(tool.avg_duration_ms)}</td>
                <td className="py-3 text-right font-mono text-orange-300">{formatDurationMs(tool.p95_duration_ms)}</td>
                <td className="py-3 text-right font-mono text-purple-300">{formatDurationMs(tool.max_duration_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="glass-card overflow-x-auto p-5">
        <div className="mb-4">
          <h3 className="text-sm font-medium text-white/75">Model Cost Breakdown</h3>
          <p className="mt-1 text-xs text-white/40">Supports FinOps conversations about model routing and provider choice.</p>
        </div>
        <table className="min-w-[760px] w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-white/10 text-xs text-white/40">
              <th className="pb-2 font-medium">Model</th>
              <th className="pb-2 font-medium text-right">Calls</th>
              <th className="pb-2 font-medium text-right">Prompt Tokens</th>
              <th className="pb-2 font-medium text-right">Completion</th>
              <th className="pb-2 font-medium text-right">Total Tokens</th>
              <th className="pb-2 font-medium text-right">Cost</th>
              <th className="pb-2 font-medium text-right">Avg / Call</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {data.models.map((model) => (
              <tr key={`${model.provider}-${model.model}`} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                <td className="py-3 text-white/80">
                  <div className="font-mono text-xs">{model.model}</div>
                  <div className="text-[10px] text-white/40">{model.provider || 'unknown'}</div>
                </td>
                <td className="py-3 text-right font-mono text-white/60">{formatNumber(model.calls)}</td>
                <td className="py-3 text-right font-mono text-blue-300">{formatNumber(model.prompt_tokens)}</td>
                <td className="py-3 text-right font-mono text-emerald-300">{formatNumber(model.completion_tokens)}</td>
                <td className="py-3 text-right font-mono text-purple-300">{formatNumber(model.total_tokens)}</td>
                <td className="py-3 text-right font-mono text-orange-300">{formatCurrency(model.total_cost_usd)}</td>
                <td className="py-3 text-right font-mono text-white/70">{formatCurrency(model.avg_cost_per_call)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
