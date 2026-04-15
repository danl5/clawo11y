import { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

interface MetricSeries {
  name: string;
  description: string;
  unit: string;
  type: string;
  data: {
    id: number;
    created_at: string;
    data_points: any;
    resource_attrs: any;
  }[];
}

interface OverviewSummary {
  window_hours: number;
  total_runs: number;
  errored_runs: number;
  avg_run_duration_ms: number;
  total_tokens: number;
  total_cost_usd: number;
}

interface RecentRun {
  trace_id: string;
  session_id: string;
  name: string;
  user_message: string;
  status: string;
  close_reason: string;
  duration_ms: number;
  total_cost_usd: number;
  total_tokens: number;
  llm_calls: number;
  tool_calls: number;
  subagent_calls: number;
  last_model: string;
  last_provider: string;
  error_type: string;
  error_message: string;
  created_at: string;
}

interface ModelBreakdown {
  model: string;
  provider: string;
  calls: number;
  errors: number;
  total_tokens: number;
  total_cost_usd: number;
  avg_duration_ms: number;
}

interface ToolBreakdown {
  tool_name: string;
  calls: number;
  errors: number;
  avg_duration_ms: number;
  max_duration_ms: number;
}

interface SubagentBreakdown {
  label: string;
  mode: string;
  calls: number;
  errors: number;
  avg_duration_ms: number;
}

interface LogEventBreakdown {
  event_name: string;
  count: number;
}

interface OtelOverview {
  summary: OverviewSummary;
  recent_runs: RecentRun[];
  models: ModelBreakdown[];
  tools: ToolBreakdown[];
  subagents: SubagentBreakdown[];
  log_events: LogEventBreakdown[];
}

interface HealthSummary {
  window_hours: number;
  anomaly_count: number;
  idle_timeout_closures: number;
  root_recreated_count: number;
  orphan_event_count: number;
  agent_end_without_root: number;
}

interface HealthBreakdown {
  name: string;
  count: number;
}

interface RecentAnomaly {
  timestamp: string;
  severity: string;
  event_name: string;
  anomaly_type: string;
  session_id: string;
  trace_id: string;
  body: string;
}

interface OtelHealth {
  summary: HealthSummary;
  anomaly_types: HealthBreakdown[];
  close_reasons: HealthBreakdown[];
  recent_anomalies: RecentAnomaly[];
}

const COLORS = ['#3b82f6', '#8b5cf6', '#34d399', '#fb923c', '#f472b6', '#60a5fa', '#a78bfa'];

const EMPTY_OVERVIEW: OtelOverview = {
  summary: {
    window_hours: 24,
    total_runs: 0,
    errored_runs: 0,
    avg_run_duration_ms: 0,
    total_tokens: 0,
    total_cost_usd: 0,
  },
  recent_runs: [],
  models: [],
  tools: [],
  subagents: [],
  log_events: [],
};

const EMPTY_HEALTH: OtelHealth = {
  summary: {
    window_hours: 24,
    anomaly_count: 0,
    idle_timeout_closures: 0,
    root_recreated_count: 0,
    orphan_event_count: 0,
    agent_end_without_root: 0,
  },
  anomaly_types: [],
  close_reasons: [],
  recent_anomalies: [],
};

export function normalizeOverview(value: unknown): OtelOverview | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<OtelOverview>;
  const summary = input.summary && typeof input.summary === 'object'
    ? { ...EMPTY_OVERVIEW.summary, ...input.summary }
    : EMPTY_OVERVIEW.summary;

  return {
    summary,
    recent_runs: Array.isArray(input.recent_runs) ? input.recent_runs : [],
    models: Array.isArray(input.models) ? input.models : [],
    tools: Array.isArray(input.tools) ? input.tools : [],
    subagents: Array.isArray(input.subagents) ? input.subagents : [],
    log_events: Array.isArray(input.log_events) ? input.log_events : [],
  };
}

export function normalizeHealth(value: unknown): OtelHealth | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<OtelHealth>;
  const summary = input.summary && typeof input.summary === 'object'
    ? { ...EMPTY_HEALTH.summary, ...input.summary }
    : EMPTY_HEALTH.summary;

  return {
    summary,
    anomaly_types: Array.isArray(input.anomaly_types) ? input.anomaly_types : [],
    close_reasons: Array.isArray(input.close_reasons) ? input.close_reasons : [],
    recent_anomalies: Array.isArray(input.recent_anomalies) ? input.recent_anomalies : [],
  };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDurationMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 ms';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${value.toFixed(1)} ms`;
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white/90">{value}</div>
      <div className="mt-1 text-xs text-white/40">{hint}</div>
    </div>
  );
}

function BreakdownTable({
  title,
  subtitle,
  headers,
  rows,
}: {
  title: string;
  subtitle: string;
  headers: string[];
  rows: Array<Array<string>>;
}) {
  return (
    <div className="glass-card p-5">
      <div className="mb-4">
        <h3 className="text-sm font-bold text-white/90">{title}</h3>
        <p className="mt-1 text-xs text-white/40">{subtitle}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-white/10 text-white/40">
              {headers.map((header) => (
                <th key={header} className="px-2 py-2 font-medium">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={`${title}-${idx}`} className="border-b border-white/[0.04] last:border-b-0">
                {row.map((cell, cellIdx) => (
                  <td key={`${title}-${idx}-${cellIdx}`} className="px-2 py-2 text-white/75">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OtelMetricsDashboard() {
  const [series, setSeries] = useState<MetricSeries[]>([]);
  const [overview, setOverview] = useState<OtelOverview | null>(null);
  const [health, setHealth] = useState<OtelHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchMetrics = () => {
      Promise.all([
        fetch('/api/v1/otlp/dashboard/metrics').then((res) => res.json()),
        fetch('/api/v1/otlp/dashboard/overview').then((res) => res.json()),
        fetch('/api/v1/otlp/dashboard/health').then((res) => res.json()),
      ])
        .then(([metricsJson, overviewJson, healthJson]) => {
          if (cancelled) return;
          if (Array.isArray(metricsJson)) {
            setSeries(metricsJson);
          }
          setOverview(normalizeOverview(overviewJson));
          setHealth(normalizeHealth(healthJson));
          setLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          console.error('Failed to fetch metrics data:', err);
          setLoading(false);
        });
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const parseChartData = (s: MetricSeries) => {
    const chartData: Array<{
      time: string;
      timestamp: number;
      value: number;
    }> = [];

    s.data.forEach((d) => {
      let points: any[] = [];
      try {
        if (typeof d.data_points === 'string') {
          points = JSON.parse(d.data_points);
        } else if (Array.isArray(d.data_points)) {
          points = d.data_points;
        }
      } catch {
        points = [];
      }

      points.forEach((pt: any) => {
        let val = 0;
        if (pt.asDouble !== undefined) val = Number(pt.asDouble);
        else if (pt.asInt !== undefined) val = Number(pt.asInt);
        else if (pt.sum !== undefined) val = Number(pt.sum);

        let ts = new Date(d.created_at).getTime();
        if (pt.timeUnixNano) {
          ts = Number(pt.timeUnixNano) / 1000000;
        }

        chartData.push({
          time: new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          timestamp: ts,
          value: val,
        });
      });
    });

    chartData.sort((a, b) => a.timestamp - b.timestamp);
    return chartData;
  };

  const chartSections = useMemo(() => {
    const sections = [
      {
        title: 'Run Metrics',
        patterns: ['openclaw.run.'],
      },
      {
        title: 'LLM Metrics',
        patterns: ['openclaw.llm.'],
      },
      {
        title: 'Tool Metrics',
        patterns: ['openclaw.tool.'],
      },
      {
        title: 'Subagent Metrics',
        patterns: ['openclaw.subagent.'],
      },
    ];

    return sections.map((section) => ({
      ...section,
      items: series.filter((item) => section.patterns.some((pattern) => item.name.startsWith(pattern))),
    })).filter((section) => section.items.length > 0);
  }, [series]);

  if (loading) {
    return <div className="p-8 text-center text-white/50 animate-pulse">Loading Metrics...</div>;
  }

  if (series.length === 0 && !overview && !health) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center h-64 border border-dashed border-white/10 rounded-xl bg-white/[0.02]">
        <span className="text-4xl mb-4">📈</span>
        <h3 className="text-lg font-medium text-white/80">No Metric Data Yet</h3>
        <p className="text-sm text-white/40 mt-2 max-w-sm">
          Once OpenClaw starts sending OTel metrics, they will be visualized here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-up pb-20 pr-2">
      {overview && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="24h Runs"
              value={formatNumber(overview.summary.total_runs)}
              hint={`${formatNumber(overview.summary.errored_runs)} errored runs`}
            />
            <MetricCard
              label="Avg Run Duration"
              value={formatDurationMs(overview.summary.avg_run_duration_ms)}
              hint="End-to-end root trace duration"
            />
            <MetricCard
              label="24h Tokens"
              value={formatNumber(overview.summary.total_tokens)}
              hint="Aggregated from root run summaries"
            />
            <MetricCard
              label="24h Cost"
              value={`$${overview.summary.total_cost_usd.toFixed(4)}`}
              hint={`Window: ${overview.summary.window_hours} hours`}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <BreakdownTable
              title="Recent Runs"
              subtitle="Latest root traces with business-level rollups."
              headers={['When', 'Status', 'Message / Session', 'Cost', 'Calls']}
              rows={overview.recent_runs.slice(0, 8).map((run) => [
                new Date(run.created_at).toLocaleTimeString(),
                run.status,
                run.user_message || run.session_id || run.trace_id.slice(0, 10),
                `$${run.total_cost_usd.toFixed(4)}`,
                `L${run.llm_calls} / T${run.tool_calls} / S${run.subagent_calls}`,
              ])}
            />
            <BreakdownTable
              title="Log Lifecycle"
              subtitle="Most frequent OTEL lifecycle events in the last 24 hours."
              headers={['Event', 'Count']}
              rows={overview.log_events.slice(0, 8).map((item) => [item.event_name, formatNumber(item.count)])}
            />
            <BreakdownTable
              title="Top Models"
              subtitle="Helps answer which model is slow or expensive."
              headers={['Model', 'Calls', 'Errors', 'Tokens', 'Cost', 'Avg']}
              rows={overview.models.map((item) => [
                item.provider ? `${item.model} (${item.provider})` : item.model,
                formatNumber(item.calls),
                formatNumber(item.errors),
                formatNumber(item.total_tokens),
                `$${item.total_cost_usd.toFixed(4)}`,
                formatDurationMs(item.avg_duration_ms),
              ])}
            />
            <BreakdownTable
              title="Top Tools"
              subtitle="Highlights slow or fragile tool calls."
              headers={['Tool', 'Calls', 'Errors', 'Avg', 'Max']}
              rows={overview.tools.map((item) => [
                item.tool_name,
                formatNumber(item.calls),
                formatNumber(item.errors),
                formatDurationMs(item.avg_duration_ms),
                formatDurationMs(item.max_duration_ms),
              ])}
            />
            <BreakdownTable
              title="Subagents"
              subtitle="Shows whether subagents are frequent or slow."
              headers={['Label', 'Mode', 'Calls', 'Errors', 'Avg']}
              rows={overview.subagents.map((item) => [
                item.label,
                item.mode,
                formatNumber(item.calls),
                formatNumber(item.errors),
                formatDurationMs(item.avg_duration_ms),
              ])}
            />
          </div>
        </>
      )}

      {health && (
        <>
          <div>
            <h3 className="text-sm font-semibold text-white/85">Observability Health</h3>
            <p className="mt-1 text-xs text-white/40">Signals that indicate broken trace lifecycles, missing pair events, or overly aggressive closure.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Anomalies"
              value={formatNumber(health.summary.anomaly_count)}
              hint={`Window: ${health.summary.window_hours} hours`}
            />
            <MetricCard
              label="Idle Closures"
              value={formatNumber(health.summary.idle_timeout_closures)}
              hint="Roots closed by idle timeout"
            />
            <MetricCard
              label="Root Recreated"
              value={formatNumber(health.summary.root_recreated_count)}
              hint="Roots recreated after lifecycle break"
            />
            <MetricCard
              label="Orphan Events"
              value={formatNumber(health.summary.orphan_event_count)}
              hint={`agent_end_without_root: ${formatNumber(health.summary.agent_end_without_root)}`}
            />
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <BreakdownTable
              title="Anomaly Types"
              subtitle="Most frequent observability lifecycle anomalies."
              headers={['Type', 'Count']}
              rows={health.anomaly_types.map((item) => [item.name, formatNumber(item.count)])}
            />
            <BreakdownTable
              title="Run Close Reasons"
              subtitle="How root traces are being finalized."
              headers={['Reason', 'Count']}
              rows={health.close_reasons.map((item) => [item.name, formatNumber(item.count)])}
            />
            <BreakdownTable
              title="Recent Anomalies"
              subtitle="Latest integrity issues emitted by the plugin."
              headers={['When', 'Severity', 'Type', 'Session / Trace']}
              rows={health.recent_anomalies.slice(0, 8).map((item) => [
                new Date(item.timestamp).toLocaleTimeString(),
                item.severity || 'WARN',
                item.anomaly_type || item.event_name,
                item.session_id || item.trace_id.slice(0, 12),
              ])}
            />
          </div>
        </>
      )}

      {chartSections.map((section) => (
        <div key={section.title} className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-white/85">{section.title}</h3>
            <p className="mt-1 text-xs text-white/40">Trend data from OTLP metrics, grouped by business domain.</p>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {section.items.map((s, i) => {
              const chartData = parseChartData(s);
              const color = COLORS[i % COLORS.length];

              return (
                <div key={s.name} className="glass-card p-5">
                  <div className="mb-4 flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-white/90">{s.name}</h3>
                      <p className="text-xs text-white/40">{s.description || 'No description'}</p>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="mb-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/60">
                        {s.type}
                      </span>
                      <span className="text-[10px] text-white/40">Unit: {s.unit || 'none'}</span>
                    </div>
                  </div>

                  {chartData.length > 0 ? (
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                          <XAxis
                            dataKey="time"
                            tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }}
                            axisLine={false}
                            tickLine={false}
                            minTickGap={30}
                          />
                          <YAxis
                            tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.4)' }}
                            axisLine={false}
                            tickLine={false}
                            width={40}
                            domain={['auto', 'auto']}
                          />
                          <Tooltip
                            contentStyle={{ background: '#0a0f1e', border: `1px solid ${color}40`, borderRadius: 8, fontSize: 12 }}
                            itemStyle={{ color: color }}
                            labelStyle={{ color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}
                          />
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke={color}
                            strokeWidth={2}
                            dot={{ r: 2, fill: color, strokeWidth: 0 }}
                            activeDot={{ r: 4, fill: '#fff', stroke: color, strokeWidth: 2 }}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="flex h-48 items-center justify-center text-xs italic text-white/30">
                      No parsable data points
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {chartSections.length === 0 && (
        <div className="glass-card p-6 text-sm text-white/45">
          Metrics have not been aggregated into trend series yet, but business overview data is already available above.
        </div>
      )}
    </div>
  );
}
