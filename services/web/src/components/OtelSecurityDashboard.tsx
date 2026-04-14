import { useEffect, useState } from 'react';

interface SecuritySummary {
  window_days: number;
  high_risk_count: number;
  medium_risk_count: number;
  errored_risk_count: number;
  affected_sessions: number;
}

interface BreakdownItem {
  name: string;
  count: number;
}

interface RiskTimelineItem {
  created_at: string;
  trace_id: string;
  span_id: string;
  session_id: string;
  tool_name: string;
  tool_category: string;
  tool_risk_class: string;
  tool_risk_reason: string;
  params_preview: string;
  duration_ms: number;
  status: string;
  error_type: string;
  error_message: string;
}

interface SecurityData {
  summary: SecuritySummary;
  risk_classes: BreakdownItem[];
  categories: BreakdownItem[];
  timeline: RiskTimelineItem[];
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDurationMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 ms';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${value.toFixed(1)} ms`;
}

function truncate(value: string, max = 120) {
  if (!value) return '';
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function SummaryCard({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: 'red' | 'yellow' | 'blue' | 'purple' }) {
  const toneMap = {
    red: 'text-red-300 border-red-500/20 bg-red-500/10',
    yellow: 'text-yellow-300 border-yellow-500/20 bg-yellow-500/10',
    blue: 'text-blue-300 border-blue-500/20 bg-blue-500/10',
    purple: 'text-purple-300 border-purple-500/20 bg-purple-500/10',
  }[tone];

  return (
    <div className={`rounded-xl border p-4 ${toneMap}`}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white/90">{value}</div>
      <div className="mt-1 text-xs text-white/45">{hint}</div>
    </div>
  );
}

export function OtelSecurityDashboard() {
  const [data, setData] = useState<SecurityData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/otlp/dashboard/security')
      .then((res) => res.json())
      .then((json) => {
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch security timeline:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="p-8 text-center text-white/50 animate-pulse">Loading Security Timeline...</div>;
  }

  if (!data || (!data.timeline?.length && !data.risk_classes?.length)) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
        <span className="mb-4 text-4xl">🛡️</span>
        <h3 className="text-lg font-medium text-white/80">No High-Risk Operations Yet</h3>
        <p className="mt-2 max-w-sm text-sm text-white/40">
          High-risk shell, code, filesystem, or network tool operations will appear here once the updated plugin is active.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <h2 className="text-base font-semibold text-white/90">High-Risk Operation Timeline</h2>
        <p className="mt-1 text-sm text-white/40">Audit-focused view for shell, code execution, filesystem mutation, and risky network operations.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label={`High Risk (${data.summary.window_days}d)`}
          value={formatNumber(data.summary.high_risk_count)}
          hint="Operations classified as high risk"
          tone="red"
        />
        <SummaryCard
          label="Medium Risk"
          value={formatNumber(data.summary.medium_risk_count)}
          hint="Filesystem or network actions worth review"
          tone="yellow"
        />
        <SummaryCard
          label="Errored Risk Ops"
          value={formatNumber(data.summary.errored_risk_count)}
          hint="Failed high-risk attempts"
          tone="purple"
        />
        <SummaryCard
          label="Affected Sessions"
          value={formatNumber(data.summary.affected_sessions)}
          hint="Sessions that touched risky tools"
          tone="blue"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="glass-card p-5">
          <h3 className="mb-3 text-sm font-medium text-white/80">Risk Classes</h3>
          <div className="space-y-2">
            {data.risk_classes.map((item) => (
              <div key={item.name} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                <span className="text-sm text-white/75">{item.name}</span>
                <span className="font-mono text-xs text-white/55">{formatNumber(item.count)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card p-5">
          <h3 className="mb-3 text-sm font-medium text-white/80">Risk Categories</h3>
          <div className="space-y-2">
            {data.categories.map((item) => (
              <div key={item.name} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                <span className="text-sm text-white/75">{item.name}</span>
                <span className="font-mono text-xs text-white/55">{formatNumber(item.count)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="glass-card overflow-x-auto p-5">
        <div className="mb-4">
          <h3 className="text-sm font-medium text-white/80">Audit Timeline</h3>
          <p className="mt-1 text-xs text-white/40">Most recent risky operations, with enough context for review and incident response.</p>
        </div>
        <table className="min-w-[1100px] w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-white/10 text-xs text-white/40">
              <th className="pb-2 font-medium">When</th>
              <th className="pb-2 font-medium">Risk</th>
              <th className="pb-2 font-medium">Tool</th>
              <th className="pb-2 font-medium">Reason</th>
              <th className="pb-2 font-medium">Params Preview</th>
              <th className="pb-2 font-medium text-right">Duration</th>
              <th className="pb-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {data.timeline.map((item) => (
              <tr key={`${item.trace_id}-${item.span_id}`} className="border-b border-white/5 align-top hover:bg-white/[0.02] transition-colors">
                <td className="py-3 text-[11px] font-mono text-white/55">
                  <div>{new Date(item.created_at).toLocaleString()}</div>
                  <div className="mt-1 text-[10px] text-white/35">{truncate(item.session_id || item.trace_id, 22)}</div>
                </td>
                <td className="py-3">
                  <div className={`inline-flex rounded border px-2 py-0.5 text-[10px] uppercase ${
                    item.tool_risk_class === 'high'
                      ? 'border-red-500/30 bg-red-500/10 text-red-300'
                      : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300'
                  }`}>
                    {item.tool_risk_class}
                  </div>
                  <div className="mt-1 text-[10px] text-white/35">{item.tool_category}</div>
                </td>
                <td className="py-3 text-white/80">
                  <div className="font-mono text-xs">{item.tool_name}</div>
                  {item.error_type && <div className="mt-1 text-[10px] text-red-300">{item.error_type}</div>}
                </td>
                <td className="py-3 text-xs text-white/60">{item.tool_risk_reason}</td>
                <td className="py-3">
                  <div className="max-w-[420px] whitespace-pre-wrap break-words rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-[11px] text-white/70">
                    {truncate(item.params_preview || item.error_message || '-', 260)}
                  </div>
                </td>
                <td className="py-3 text-right font-mono text-xs text-blue-300">{formatDurationMs(item.duration_ms)}</td>
                <td className="py-3">
                  <div className={`inline-flex rounded border px-2 py-0.5 text-[10px] uppercase ${
                    item.status === 'error'
                      ? 'border-red-500/30 bg-red-500/10 text-red-300'
                      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  }`}>
                    {item.status}
                  </div>
                  {item.error_message && (
                    <div className="mt-1 max-w-[220px] text-[10px] text-white/45">{truncate(item.error_message, 120)}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
