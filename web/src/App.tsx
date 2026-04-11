import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useWebSocket } from './hooks/useWebSocket';
import type { WsMessage, TimelineEvent } from './types';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';

const EVENT_COLORS: Record<string, string> = {
  'message': '#60a5fa',
  'custom': '#a78bfa',
  'model_change': '#fb923c',
  'session': '#34d399',
  'thinking_level_change': '#6b7280',
  'tool_call': '#fb923c',
  'tool_use': '#fb923c',
  'token_usage': '#34d399',
};
const TYPE_LABELS: Record<string, string> = {
  'message': 'Message',
  'custom': 'Custom',
  'model_change': 'Model Change',
  'session': 'Session',
  'thinking_level_change': 'Thinking',
  'tool_call': 'Tool Call',
  'tool_use': 'Tool Use',
  'token_usage': 'Token',
};

function formatBytes(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}
function formatUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function fmtTs(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtMs(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/* ── Particles ── */
function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf: number;
    const particles: { x: number; y: number; vx: number; vy: number; r: number; alpha: number; color: string }[] = [];
    const colors = ['#3b82f6', '#8b5cf6', '#34d399', '#fb923c', '#f472b6'];

    function resize() {
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * (canvas?.width || window.innerWidth),
        y: Math.random() * (canvas?.height || window.innerHeight),
        vx: (Math.random() - 0.5) * 0.3,
        vy: -Math.random() * 0.4 - 0.1,
        r: Math.random() * 2 + 0.5,
        alpha: Math.random() * 0.5 + 0.1,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }

    function draw() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        const w = canvas?.width || window.innerWidth;
        const h = canvas?.height || window.innerHeight;
        if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;

        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
        grd.addColorStop(0, p.color + Math.round(p.alpha * 255).toString(16).padStart(2, '0'));
        grd.addColorStop(1, p.color + '00');
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }} />;
}

/* ── Header ── */
function Header({ connected, messages }: { connected: boolean; messages: WsMessage[] }) {
  return (
    <header className="relative z-10 flex items-center justify-between px-6 py-4"
      style={{ background: 'rgba(10,15,30,0.7)', backdropFilter: 'blur(24px)', borderBottom: '1px solid rgba(255,255,255,0.05)', boxShadow: '0 4px 30px rgba(0,0,0,0.5)' }}>
      <div className="flex items-center gap-4">
        <div className="relative">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center animate-float shadow-lg border border-white/10"
            style={{ background: 'linear-gradient(135deg, #1e3a8a, #312e81, #831843)', backgroundSize: '200% 200%', animation: 'gradient-shift 4s ease infinite' }}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
              <path stroke="#fb923c" d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
              <circle fill="#f472b6" stroke="#f472b6" cx="12" cy="12" r="3"/>
              <path stroke="#60a5fa" d="M12 2v2M12 20v2M22 12h-2M4 12H2M4.9 4.9l1.4 1.4M17.7 19.1l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 19.1l-1.4 1.4"/>
            </svg>
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0a0f1e] animate-breathe"
            style={{ background: connected ? '#10b981' : '#ef4444', boxShadow: `0 0 8px ${connected ? '#10b981' : '#ef4444'}` }} />
        </div>
        <div>
          <h1 className="text-base font-extrabold tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 drop-shadow-md">
            OpenClaw Observability
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            {connected ? (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-mono tracking-widest text-emerald-400/80 uppercase">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                Live Telemetry
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-mono tracking-widest text-red-400/80 uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444]" />
                Disconnected
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-mono"
          style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2)' }}>
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>EVENTS</span>
          <span className="font-bold" style={{ color: '#60a5fa' }}>{messages.length.toLocaleString()}</span>
        </div>
        <div className="w-px h-5" style={{ background: 'rgba(255,255,255,0.1)' }} />
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono"
          style={{ background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.2)' }}>
          <span style={{ color: '#60a5fa' }}>v1.0</span>
        </div>
      </div>
    </header>
  );
}

/* ── Tab bar ── */
const TABS = ['overview', 'tokens', 'sessions', 'cron', 'workspace', 'logs'] as const;
const TAB_ICONS: Record<string, string> = {
  overview: '◈', tokens: '⚡', sessions: '🧠', cron: '⏱', workspace: '📁', logs: '📋',
};

function TabBar({ tab, setTab }: { tab: string; setTab: (t: typeof TABS[number]) => void }) {
  return (
    <div className="relative z-10 flex gap-1 px-6 pt-4">
      <div className="flex gap-1 px-1 py-1 rounded-2xl"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(12px)' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="tab-btn flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-medium capitalize transition-all duration-200"
            style={{
              background: tab === t
                ? 'linear-gradient(135deg, rgba(59,130,246,0.25), rgba(139,92,246,0.25))'
                : 'transparent',
              color: tab === t ? 'white' : 'rgba(255,255,255,0.35)',
              border: tab === t ? '1px solid rgba(99,132,246,0.3)' : '1px solid transparent',
              boxShadow: tab === t ? '0 0 12px rgba(59,130,246,0.15)' : 'none',
            }}>
            <span className="text-[10px]">{TAB_ICONS[t]}</span>
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Metric Card ── */
function MetricCard({ m, idx }: { m: any; idx: number }) {
  return (
    <div className="metric-card glass-card p-5 relative overflow-hidden animate-fade-up"
      style={{ animationDelay: `${idx * 80}ms` }}>
      <div className="absolute inset-0 pointer-events-none animate-shimmer" />
      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <span className="text-lg">{m.icon}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
            style={{ background: m.color + '15', color: m.color, border: `1px solid ${m.color}25` }}>
            {m.label}
          </span>
        </div>
        <div className="text-3xl font-bold mb-1 tracking-tight" style={{ color: 'rgba(255,255,255,0.95)' }}>{m.value}</div>
        <div className="text-xs mb-4" style={{ color: 'rgba(255,255,255,0.35)' }}>{m.sub}</div>
        <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <div className="h-full rounded-full transition-all duration-1000 ease-out"
            style={{ width: `${Math.min(m.percent, 100)}%`, background: `linear-gradient(90deg, ${m.color}, ${m.color}80)` }} />
        </div>
      </div>
    </div>
  );
}

/* ── Overview ── */
function OverviewTab({ messages }: any) {
  const [healthSnapshots] = useState<{ ts: string, cpu: number, ram: number, disk: number }[]>([]);
  const latestMetrics = messages.find((m: WsMessage) => m.type === 'system_metrics');
  const latestWorkspace = messages.find((m: WsMessage) => m.type === 'workspace_event');
  const latestCron = messages.find((m: WsMessage) => m.type === 'cron_event');
  const sessionsEvent = messages.find((m: WsMessage) => m.type === 'sessions_event');

  const nodeCount = [...new Set(messages.filter((m: WsMessage) => m.node_id).map((m: WsMessage) => m.node_id))].length;
  
  const tokenMsgs = messages.filter((m: WsMessage) => m.input_tokens !== undefined || m.output_tokens !== undefined);
  let totalCost = tokenMsgs.reduce((sum: number, m: WsMessage) => sum + (m.cost_usd || 0), 0);

  // 计算真实的 OpenClaw Agent 数量以及累加 session 里的汇总 Cost（为了弥补有些缺失 token_usage 事件的情况）
  const agentsSet = new Set<string>();
  if (sessionsEvent && sessionsEvent.sessions) {
    sessionsEvent.sessions.forEach((s: any) => {
      agentsSet.add(s.agent_name || 'main');
      if (s.cost_usd && totalCost === 0) {
        totalCost += s.cost_usd;
      }
    });
  }
  const actualAgentCount = agentsSet.size;

  // 计算活跃的 Cron 任务数
  const activeJobs = latestCron?.jobs?.filter((j: any) => j.enabled).length || 0;

  const metrics = [
    { label: 'CPU Load', value: latestMetrics ? `${latestMetrics.cpu_percent?.toFixed(1)}%` : '—',
      sub: latestMetrics ? `Load: ${latestMetrics.load_avg_1m?.toFixed(2)}` : '', color: '#3b82f6', icon: '⚡', percent: latestMetrics?.cpu_percent || 0 },
    { label: 'Memory', value: latestMetrics ? `${latestMetrics.ram_percent?.toFixed(1)}%` : '—',
      sub: latestMetrics ? formatBytes(latestMetrics.ram_used_mb) : '', color: '#8b5cf6', icon: '💾', percent: latestMetrics?.ram_percent || 0 },
    { label: 'Disk', value: latestMetrics ? `${latestMetrics.disk_used_percent?.toFixed(1)}%` : '—',
      sub: latestMetrics ? formatUptime(latestMetrics.uptime_seconds || 0) + ' uptime' : '', color: '#34d399', icon: '💿', percent: latestMetrics?.disk_used_percent || 0 },
    { label: 'Nodes', value: nodeCount || '—', sub: 'active hosts', color: '#f472b6', icon: '🔗', percent: Math.min(nodeCount * 33, 100) },
  ];

  const summaryItems = [
    { label: 'Sessions', value: sessionsEvent?.session_count || 0, color: '#60a5fa' },
    { label: 'Agents', value: actualAgentCount || '—', color: '#a78bfa' },
    { label: 'Total Cost', value: totalCost > 0 ? `$${totalCost.toFixed(4)}` : '—', color: '#fb923c' },
    { label: 'Active Jobs', value: activeJobs || '—', color: '#34d399' },
    { label: 'Workspace', value: latestWorkspace?.summary ? (['SOUL', 'AGENTS', 'STATE'].filter((_, i) => [latestWorkspace.summary.soul_exists, latestWorkspace.summary.agents_exists, latestWorkspace.summary.state_exists][i])).join('·') || 'clean' : '—', color: '#a78bfa' },
  ];

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m, i) => <MetricCard key={m.label} m={m} idx={i} />)}
      </div>

      <div className="glass-card p-4 flex flex-wrap gap-5">
        {summaryItems.map(({ label, value, color }) => (
          <div key={label} className="flex items-center gap-3 group cursor-default">
            <div className="w-1 h-8 rounded-full transition-all" style={{ background: color, boxShadow: `0 0 8px ${color}60` }} />
            <div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.3)' }}>{label}</div>
              <div className="text-sm font-semibold transition-colors group-hover:text-white" style={{ color: 'rgba(255,255,255,0.7)' }}>{value}</div>
            </div>
          </div>
        ))}
      </div>

      {healthSnapshots.length > 0 && (
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>
              <span className="inline-block w-2 h-2 rounded-full mr-2 animate-breathe" style={{ background: '#fb923c' }} />
              System Health — 24h
            </h3>
            <div className="flex gap-4 text-xs">
              {[{ color: '#fb923c', label: 'CPU' }, { color: '#3b82f6', label: 'RAM' }, { color: '#34d399', label: 'Disk' }].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm" style={{ background: color, boxShadow: `0 0 4px ${color}` }} />
                  <span style={{ color: 'rgba(255,255,255,0.35)' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={healthSnapshots}>
              <defs>
                <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fb923c" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#fb923c" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="ts" tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.25)' }}
                tickFormatter={(v: number) => fmtTs(v)} />
              <YAxis tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.25)' }} domain={[0, 100]} />
              <Tooltip contentStyle={{ background: '#0a0f1e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11, color: 'white' }} />
              <Area type="monotone" dataKey="cpu" stroke="#fb923c" fill="url(#cpuGrad)" strokeWidth={2} isAnimationActive={false} />
              <Line type="monotone" dataKey="ram" stroke="#3b82f6" dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line type="monotone" dataKey="disk" stroke="#34d399" dot={false} strokeWidth={1} strokeOpacity={0.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {tokenMsgs.length > 0 && (
        <div className="glass-card p-5">
          <h3 className="text-sm font-medium mb-4" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Recent Token Usage
          </h3>
          <div className="space-y-1.5">
            {tokenMsgs.slice(0, 8).map((m: WsMessage, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 px-3 rounded-xl transition-all hover:bg-white/[0.03]"
                style={{ animationDelay: `${i * 40}ms` }}>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] px-2 py-0.5 rounded-md font-mono"
                    style={{ background: 'rgba(52,211,153,0.1)', color: '#34d399', border: '1px solid rgba(52,211,153,0.15)' }}>
                    {m.model?.split('/').pop() || '—'}
                  </span>
                  <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                    {m.session_id?.slice(0, 8)}...
                  </span>
                  {m.tool_name && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-md border border-yellow-500/20" style={{ background: 'rgba(250,204,21,0.1)', color: '#facc15' }}>
                      {m.tool_name}
                    </span>
                  )}
                  {m.provider && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(167,139,250,0.1)', color: 'rgba(167,139,250,0.5)' }}>
                      {m.provider}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs font-mono">
                  <span style={{ color: '#60a5fa' }}>{(m.input_tokens || 0).toLocaleString()}</span>
                  <span style={{ color: '#34d399' }}>{(m.output_tokens || 0).toLocaleString()}</span>
                  <span style={{ color: '#fb923c' }}>${(m.cost_usd || 0).toFixed(6)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Tokens ── */
function TokensTab({ messages }: any) {
  const chartData = useMemo(() => {
    return messages
      .filter((m: WsMessage) => (m.input_tokens || 0) > 0 || (m.output_tokens || 0) > 0)
      .slice(0, 40)
      .reverse()
      .map((m: WsMessage) => ({
        ts: m.timestamp ? fmtMs(new Date(m.timestamp).getTime()) : '',
        input: m.input_tokens || 0,
        output: m.output_tokens || 0,
        total: (m.input_tokens || 0) + (m.output_tokens || 0),
        cost: (m.cost_usd || 0) * 1000,
      }));
  }, [messages]);

  const skillStats = useMemo(() => {
    const stats: Record<string, { calls: number, cost: number, input: number, output: number }> = {};
    messages.forEach((m: WsMessage) => {
      if ((m.input_tokens || 0) > 0 || (m.output_tokens || 0) > 0) {
        const skill = m.tool_name || '— (No Skill)';
        if (!stats[skill]) stats[skill] = { calls: 0, cost: 0, input: 0, output: 0 };
        stats[skill].calls += 1;
        stats[skill].cost += (m.cost_usd || 0);
        stats[skill].input += (m.input_tokens || 0);
        stats[skill].output += (m.output_tokens || 0);
      }
    });
    return Object.entries(stats)
      .map(([name, s]) => ({ name, ...s }))
      .sort((a, b) => b.cost - a.cost);
  }, [messages]);

  if (chartData.length === 0) return <EmptyState icon="⚡" title="No token data yet" subtitle="Token usage will appear here as sessions are tracked" />;

  return (
    <div className="space-y-5 animate-fade-up">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>Token Volume</h3>
              <div className="flex gap-3 text-xs">
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: '#3b82f6', boxShadow: '0 0 4px #3b82f6' }} /><span style={{ color: 'rgba(255,255,255,0.35)' }}>Input</span></div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: '#34d399', boxShadow: '0 0 4px #34d399' }} /><span style={{ color: 'rgba(255,255,255,0.35)' }}>Output</span></div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="ts" tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.25)' }} />
                <YAxis tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.25)' }} />
                <Tooltip contentStyle={{ background: '#0a0f1e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11, color: 'white' }} />
                <Bar dataKey="input" fill="#3b82f6" stackId="a" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="output" fill="#34d399" stackId="a" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="glass-card p-5">
            <h3 className="text-sm font-medium mb-4" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Cost Trend <span className="text-[10px] font-normal" style={{ color: 'rgba(255,255,255,0.2)' }}>(USD × 1000)</span>
            </h3>
            <ResponsiveContainer width="100%" height={110}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="costGrad2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#fb923c" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#fb923c" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="ts" tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.25)' }} />
                <YAxis tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.25)' }} />
                <Tooltip contentStyle={{ background: '#0a0f1e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11, color: 'white' }} />
                <Area type="monotone" dataKey="cost" stroke="#fb923c" fill="url(#costGrad2)" strokeWidth={2} strokeOpacity={0.9} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-card p-5 overflow-y-auto max-h-[415px] scrollbar-none">
          <h3 className="text-sm font-medium mb-4" style={{ color: 'rgba(255,255,255,0.6)' }}>Cost Breakdown by Skill</h3>
          <div className="space-y-3">
            {skillStats.map((skill, i) => (
              <div key={i} className="p-3 rounded-xl bg-white/[0.02] border border-white/5">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-bold" style={{ color: skill.name === '— (No Skill)' ? 'rgba(255,255,255,0.3)' : '#facc15' }}>
                    {skill.name}
                  </div>
                  <div className="text-xs font-mono" style={{ color: '#fb923c' }}>
                    ${skill.cost.toFixed(6)}
                  </div>
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  <span>{skill.calls} invocations</span>
                  <div className="flex gap-2">
                    <span style={{ color: '#60a5fa' }}>in: {skill.input.toLocaleString()}</span>
                    <span style={{ color: '#34d399' }}>out: {skill.output.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sessions ── */
const AGENT_COLORS: Record<string, string> = {
  'main': '#3b82f6',
  'feishu-a': '#8b5cf6',
  'feishu-claw': '#f472b6',
};

function SessionsTab({ messages }: { messages: WsMessage[] }) {
  const [activeAgent, setActiveAgent] = useState<string>('all');
  const [sessionsMap, setSessionsMap] = useState<Record<string, { sessionId: string; label?: string; model?: string; agent_name?: string; channel?: string }[]>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');

  useEffect(() => {
    const latest = messages.filter((m: WsMessage) => m.type === 'sessions_event').pop();
    if (!latest?.sessions) return;
    const byAgent: Record<string, any[]> = {};
    for (const s of latest.sessions) {
      const agent = s.agent_name || 'main';
      if (!byAgent[agent]) byAgent[agent] = [];
      byAgent[agent].push({ sessionId: s.sessionId, label: s.label, model: s.model, agent_name: agent, channel: s.channel });
    }
    setSessionsMap(byAgent);
  }, [messages]);

  const agentNames = Object.keys(sessionsMap).sort();
  const displayAgents = activeAgent === 'all' ? agentNames : [activeAgent];
  const displaySessions = displayAgents.flatMap(a => sessionsMap[a] || []);

  const loadTimeline = useCallback((sessionId: string) => {
    setActiveId(sessionId); setLoading(true);
    const host = import.meta.env.DEV ? 'http://localhost:8000' : '';
    fetch(`${host}/api/v1/timeline/${encodeURIComponent(sessionId)}/timeline`)
      .then(r => r.json()).then(data => { setTimeline(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => { setTimeline([]); setLoading(false); });
  }, []);

  useEffect(() => {
    if (displaySessions.length > 0 && !activeId) loadTimeline(displaySessions[0].sessionId);
  }, [displaySessions, activeId, loadTimeline]);

  const activeSession = displaySessions.find(s => s.sessionId === activeId);
  const agentColor = activeSession?.agent_name ? (AGENT_COLORS[activeSession.agent_name] || '#6b7280') : '#6b7280';

  return (
    <div className="flex gap-4 h-[calc(100vh-220px)] animate-fade-up">
      <div className="w-72 shrink-0 glass-card p-4 overflow-y-auto scrollbar-thin flex flex-col gap-3">
        {agentNames.length > 1 && (
          <div className="flex gap-1 px-1 py-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)' }}>
            {['all', ...agentNames].map(a => (
              <button key={a} onClick={() => setActiveAgent(a)}
                className="flex-1 text-[9px] py-1 rounded-lg capitalize transition-all"
                style={{
                  background: activeAgent === a ? 'rgba(99,132,246,0.2)' : 'transparent',
                  color: activeAgent === a ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)',
                  border: activeAgent === a ? '1px solid rgba(99,132,246,0.25)' : '1px solid transparent',
                }}>
                {a}
              </button>
            ))}
          </div>
        )}

        <div className="text-[10px] uppercase tracking-widest px-1" style={{ color: 'rgba(255,255,255,0.2)' }}>
          {displaySessions.length} sessions
        </div>

        <div className="space-y-1">
          {displaySessions.map((s, i) => (
            <button key={s.sessionId} onClick={() => loadTimeline(s.sessionId)}
              className="w-full text-left p-3 rounded-xl transition-all duration-200 animate-slide-in"
              style={{
                animationDelay: `${i * 20}ms`,
                background: activeId === s.sessionId
                  ? 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.15))'
                  : 'rgba(255,255,255,0.02)',
                border: `1px solid ${activeId === s.sessionId ? 'rgba(99,132,246,0.3)' : 'rgba(255,255,255,0.05)'}`,
                boxShadow: activeId === s.sessionId ? '0 0 12px rgba(59,130,246,0.1)' : 'none',
              }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                {s.agent_name && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold capitalize"
                    style={{ background: (AGENT_COLORS[s.agent_name] || '#6b7280') + '20', color: AGENT_COLORS[s.agent_name] || '#6b7280', border: `1px solid ${(AGENT_COLORS[s.agent_name] || '#6b7280')}30` }}>
                    {s.agent_name}
                  </span>
                )}
                <div className="text-xs font-mono truncate flex-1" style={{ color: activeId === s.sessionId ? 'white' : 'rgba(255,255,255,0.55)' }}>
                  {s.sessionId}
                </div>
              </div>
              <div className="flex items-center gap-2 mb-1">
                {s.channel && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)' }}>
                    {s.channel}
                  </span>
                )}
                {s.label && <div className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.25)' }}>{s.label}</div>}
              </div>
              {s.model && <div className="text-[9px] font-mono truncate" style={{ color: 'rgba(255,255,255,0.2)' }}>{s.model.split('/').pop()}</div>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 glass-card p-5 flex flex-col overflow-hidden">
        {activeSession && (
          <div className="flex items-center justify-between gap-4 px-4 py-2.5 mb-4 rounded-xl shrink-0"
            style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${agentColor}20` }}>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider">Agent</span>
              <span className="text-sm font-semibold capitalize" style={{ color: agentColor }}>{activeSession.agent_name}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-md font-mono" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)' }}>{activeSession.sessionId}</span>
            </div>
            
            <div className="flex items-center gap-1 bg-black/40 rounded-lg p-1 border border-white/5">
              {[
                { id: 'all', label: 'All', icon: '📋' },
                { id: 'message', label: 'Messages', icon: '🗣' },
                { id: 'tool', label: 'Tools', icon: '🛠' },
                { id: 'token_usage', label: 'Tokens', icon: '📊' }
              ].map(f => (
                <button key={f.id} onClick={() => setFilterType(f.id)}
                  className={`text-[10px] px-2.5 py-1 rounded-md transition-all font-medium flex items-center gap-1 ${filterType === f.id ? 'bg-white/10 text-white shadow-sm' : 'text-white/40 hover:text-white/70 hover:bg-white/5'}`}>
                  <span>{f.icon}</span>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto scrollbar-thin pr-2">
          {loading && (
            <div className="flex items-center justify-center h-full gap-2">
              <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'rgba(59,130,246,0.5)', borderTopColor: 'transparent' }} />
              <span className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>Loading timeline...</span>
            </div>
          )}
          {!loading && timeline.length === 0 && (
            <EmptyState icon="🧠" title="No timeline yet" subtitle="Select a session to view its event chain" />
          )}
          {!loading && timeline.filter(ev => {
            if (filterType === 'all') return true;
            if (filterType === 'message') {
              if (ev.event_type !== 'message') return false;
              // ToolResult doesn't belong in Message filter
              if ((ev.content as any)?.message?.role === 'toolResult') return false;
              return true;
            }
            if (filterType === 'tool') {
              if (ev.event_type === 'tool_call') return true;
              if (ev.event_type === 'message') {
                const msg = (ev.content as any)?.message;
                if (msg?.role === 'toolResult') return true;
                // Assistant messages that contain a toolCall block
                if (msg?.role === 'assistant' && Array.isArray(msg.content) && msg.content.some((b: any) => b.type === 'toolCall')) {
                  return true;
                }
              }
              return false;
            }
            if (filterType === 'token_usage') return ev.event_type === 'token_usage' || ev.input_tokens > 0 || ev.output_tokens > 0;
            return true;
          }).map((ev: TimelineEvent, idx: number, arr) => (
            <div key={ev.id || idx} className="mb-3">
              <TimelineNode ev={ev} first={idx === 0} last={idx === arr.length - 1} filterType={filterType} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function renderContentBlocks(blocks: any[], filterType: string) {
  return blocks.map((b, i) => {
    if (b.type === 'text') {
      if (filterType === 'tool' || filterType === 'token_usage') return null;
      return <div key={i} className="whitespace-pre-wrap leading-relaxed opacity-90">{b.text}</div>;
    }
    if (b.type === 'thinking') {
      if (filterType === 'tool' || filterType === 'token_usage') return null;
      return (
        <details key={i} className="my-2 p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <summary className="cursor-pointer text-[10px] font-bold tracking-wider text-white/50 hover:text-white/80 select-none uppercase">
            🤔 Thinking Process
          </summary>
          <div className="mt-2 pt-2 border-t border-white/5 text-[11px] whitespace-pre-wrap text-white/60 leading-relaxed font-serif">
            {b.thinking}
          </div>
        </details>
      );
    }
    if (b.type === 'toolCall') {
      if (filterType === 'message' || filterType === 'token_usage') return null;
      return (
        <div key={i} className="my-2 p-3 rounded-lg border border-orange-500/20 bg-orange-500/5">
          <div className="text-[10px] uppercase font-bold text-orange-400 mb-2">🛠 Tool Call: {b.name}</div>
          <pre className="text-[10px] overflow-x-auto text-orange-200/80 font-mono">
            {JSON.stringify(b.arguments, null, 2)}
          </pre>
        </div>
      );
    }
    return null;
  });
}

function TimelineNode({ ev, first, last, filterType }: { ev: TimelineEvent; first: boolean; last: boolean; filterType: string }) {
  const [expanded, setExpanded] = useState(false);
  const type = ev.event_type || '';
  const rawColor = EVENT_COLORS[type] || '#4b5563';

  let label = TYPE_LABELS[type] || type;
  let color = rawColor;

  const msg = (ev.content as any)?.message;
  if (type === 'message' && msg) {
    const role = msg.role;
    if (role === 'user') { color = '#a78bfa'; label = 'User'; }
    else if (role === 'assistant') { color = '#60a5fa'; label = 'Assistant'; }
    else if (role === 'system') { color = '#fbbf24'; label = 'System'; }
    else if (role === 'toolResult') { color = '#34d399'; label = 'Tool Result'; }
  }

  let renderBody = null;

  if (type === 'message' && msg) {
    if (msg.role === 'toolResult') {
      let resultText = '';
      if (msg.details?.aggregated) {
        resultText = msg.details.aggregated;
      } else if (Array.isArray(msg.content) && msg.content.length > 0 && msg.content[0].type === 'text') {
        resultText = msg.content[0].text;
      } else {
        resultText = JSON.stringify(msg.content, null, 2);
      }

      renderBody = (
        <details className="mt-1 p-3 rounded-xl transition-all text-xs" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <summary className="font-mono text-emerald-400/80 select-none cursor-pointer">
            {msg.isError ? '❌' : '✅'} {msg.toolName}
          </summary>
          <div className="mt-2 pt-2 border-t border-white/10">
            <pre className="whitespace-pre-wrap font-mono text-[10px] text-emerald-200/70">{resultText}</pre>
          </div>
        </details>
      );
    } else if (filterType !== 'token_usage') {
      renderBody = (
        <div className="mt-2 text-xs space-y-3">
          {Array.isArray(msg.content) ? renderContentBlocks(msg.content, filterType) : (
            <div className="whitespace-pre-wrap leading-relaxed opacity-90">{typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}</div>
          )}
        </div>
      );
    }
  } else if (type === 'tool_call' && ev.content) {
    renderBody = (
      <div>
        <button onClick={() => setExpanded(!expanded)} className="text-[10px] transition-colors hover:text-white"
          style={{ color: 'rgba(255,255,255,0.3)' }}>
          {expanded ? '▲ Hide args' : '▼ Show args'}
        </button>
        {expanded && (
          <pre className="mt-2 p-3 rounded-xl text-xs overflow-x-auto"
            style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.07)', color: '#34d399', fontFamily: 'ui-monospace, monospace' }}>
            {JSON.stringify(ev.content, null, 2)}
          </pre>
        )}
      </div>
    );
  } else if (type !== 'token_usage' && ev.content && typeof ev.content === 'object') {
    renderBody = (
      <div onClick={() => setExpanded(!expanded)}
        className="mt-1 p-3 rounded-xl cursor-pointer transition-all hover:bg-white/[0.02] text-xs"
        style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {expanded
          ? <pre className="whitespace-pre-wrap" style={{ color: '#6ee7b7', fontFamily: 'ui-monospace, monospace' }}>{JSON.stringify(ev.content, null, 2)}</pre>
          : <span style={{ color: 'rgba(255,255,255,0.3)' }}>{JSON.stringify(ev.content).slice(0, 100)}...</span>
        }
      </div>
    );
  }

  return (
    <div className="flex gap-4 animate-fade-up">
      <div className="flex flex-col items-center w-7 shrink-0">
        {!first && <div className="w-px flex-1 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }} />}
        <div className={`w-3.5 h-3.5 rounded-full shrink-0 timeline-dot ${first ? 'mt-1' : ''}`}
          style={{ background: color, boxShadow: `0 0 10px ${color}80` }} />
        {!last && <div className="w-px flex-1 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }} />}
      </div>
      <div className="flex-1 pb-2">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{label}</span>
          {ev.model && (
            <code className="text-[10px] px-1.5 py-0.5 rounded-md font-mono"
              style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {ev.model.split('/').pop()}
            </code>
          )}
          {ev.tool_name && (
            <span className="text-xs px-2 py-0.5 rounded-full font-mono font-medium"
              style={{ background: 'rgba(251,146,60,0.12)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.2)' }}>
              {ev.tool_name}
            </span>
          )}
          {ev.cost_usd != null && ev.cost_usd > 0 && (
            <span className="text-xs font-mono" style={{ color: '#fb923c' }}>${ev.cost_usd.toFixed(6)}</span>
          )}
          <span className="text-[10px] ml-auto" style={{ color: 'rgba(255,255,255,0.18)' }}>
            {ev.timestamp ? fmtMs(new Date(ev.timestamp).getTime()) : ''}
          </span>
        </div>

        {renderBody}

        {(type === 'token_usage' || ev.input_tokens > 0 || ev.output_tokens > 0) && (
          <div className="flex flex-wrap gap-4 mt-2 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {ev.tool_name && (
              <span className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold border border-yellow-500/30" style={{ color: '#facc15', background: 'rgba(250,204,21,0.1)' }}>
                {ev.tool_name}
              </span>
            )}
            <span>In: <strong style={{ color: '#60a5fa' }}>{(ev.input_tokens || 0).toLocaleString()}</strong></span>
            <span>Out: <strong style={{ color: '#34d399' }}>{(ev.output_tokens || 0).toLocaleString()}</strong></span>
            {ev.cache_read_tokens > 0 && <span>CacheR: <strong style={{ color: '#a78bfa' }}>{(ev.cache_read_tokens).toLocaleString()}</strong></span>}
            {ev.cache_write_tokens > 0 && <span>CacheW: <strong style={{ color: '#f472b6' }}>{(ev.cache_write_tokens).toLocaleString()}</strong></span>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Modal Component ── */
function Modal({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden'; // 防止背景滚动
    }
    return () => {
      window.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div 
      className="fixed inset-0 flex items-center justify-center p-4 sm:p-6 animate-fade-up" 
      style={{ animationDuration: '0.2s', zIndex: 99999 }}
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity cursor-pointer" />
      <div 
        className="relative w-full max-w-4xl max-h-[85vh] flex flex-col glass-card border border-white/10 shadow-2xl overflow-hidden animate-slide-in rounded-2xl"
        style={{ background: 'rgba(15,20,35,0.95)' }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <h3 className="text-sm font-bold tracking-wide" style={{ color: 'rgba(255,255,255,0.95)' }}>{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/50 hover:text-white" title="Close (ESC)">
            ✕
          </button>
        </div>
        <div className="p-5 overflow-y-auto scrollbar-thin flex-1 text-xs">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

function CronJobDetails({ job }: { job: any }) {
  const [page, setPage] = useState(1);
  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const PAGE_SIZE = 10;
  
  const allRuns = [...(job.recent_runs || [])].reverse();
  const totalPages = Math.ceil(allRuns.length / PAGE_SIZE) || 1;
  const currentRuns = allRuns.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-2">Schedule</div>
          <pre className="font-mono text-xs text-blue-300">{typeof job.schedule === 'string' ? job.schedule : JSON.stringify(job.schedule, null, 2)}</pre>
        </div>
        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-2">Payload (Action)</div>
          {job.payload?.kind ? (
            <div className="space-y-2">
              <div className="flex gap-2 text-xs"><span className="text-white/50 w-16">Kind:</span> <span className="text-emerald-300 font-mono">{job.payload.kind}</span></div>
              {job.payload.agent && <div className="flex gap-2 text-xs"><span className="text-white/50 w-16">Agent:</span> <span className="text-purple-300 font-mono">{job.payload.agent}</span></div>}
              {job.payload.input && (
                <div className="mt-2 text-xs border border-white/5 bg-black/30 p-2 rounded-lg">
                  <span className="text-white/50 block mb-1">Input:</span>
                  <div className="text-gray-300 whitespace-pre-wrap font-serif leading-relaxed">{job.payload.input}</div>
                </div>
              )}
            </div>
          ) : (
            <pre className="font-mono text-xs text-emerald-300 whitespace-pre-wrap">{JSON.stringify(job.payload || 'No payload', null, 2)}</pre>
          )}
        </div>
      </div>
      
      <div className="glass-card p-4 overflow-visible">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] uppercase tracking-wider text-white/40">Recent Runs</div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2 text-xs">
              <button 
                disabled={page === 1} 
                onClick={() => setPage(p => p - 1)} 
                className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors">
                Prev
              </button>
              <span className="text-white/50 font-mono">{page} / {totalPages}</span>
              <button 
                disabled={page === totalPages} 
                onClick={() => setPage(p => p + 1)} 
                className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors">
                Next
              </button>
            </div>
          )}
        </div>
        
        {allRuns.length === 0 ? (
          <div className="text-xs text-white/30 italic">No execution history found.</div>
        ) : (
          <div className="space-y-2">
            {currentRuns.map((run: any, idx: number) => {
              const isExpanded = expandedRun === idx;
              return (
              <div key={idx} 
                className="flex flex-col p-2 rounded-lg bg-black/20 border border-white/5 hover:bg-white/5 transition-colors cursor-pointer"
                onClick={() => setExpandedRun(isExpanded ? null : idx)}>
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${run.status === 'ok' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    <span className="text-xs text-white/60 font-mono">{new Date(run.ts).toLocaleString()}</span>
                  </div>
                  <div className="flex-1 text-xs truncate mx-2 text-white/80">
                    {run.status === 'ok' ? run.summary : run.error}
                  </div>
                  <div className="text-[10px] text-white/40">
                    {run.durationMs ? `${run.durationMs}ms` : ''}
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 p-3 rounded-md bg-black/40 border border-white/10 overflow-x-auto" onClick={(e) => e.stopPropagation()}>
                    <div className="text-[10px] uppercase text-white/40 mb-2 font-bold tracking-widest">
                      {run.status === 'ok' ? 'Full Summary' : 'Error Details'}
                    </div>
                    <pre className="text-xs text-gray-300 whitespace-pre-wrap font-serif leading-relaxed">
                      {run.status === 'ok' ? run.summary : run.error}
                    </pre>
                  </div>
                )}
              </div>
            )})}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Cron ── */
function CronTab({ messages }: { messages: WsMessage[] }) {
  const cronEvents = messages.filter((m: WsMessage) => m.type === 'cron_event');
  const latestCron = cronEvents.length > 0 ? cronEvents[cronEvents.length - 1] : null;
  const jobs = latestCron?.jobs || [];
  const [selectedJob, setSelectedJob] = useState<any>(null);

  if (jobs.length === 0) return <EmptyState icon="⏰" title="No cron jobs" subtitle="Scheduled tasks will appear here" />;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-up">
      {jobs.map((j: any, i: number) => (
        <div key={j.id || i} onClick={() => setSelectedJob(j)} className="glass-card p-5 cursor-pointer transition-all duration-300 hover:scale-[1.01]"
          style={{ animationDelay: `${i * 60}ms`, borderColor: j.enabled ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.06)' }}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-sm font-medium mb-0.5">{j.name || j.id}</div>
              <code className="text-xs font-mono" style={{ color: '#60a5fa' }}>
                {typeof j.schedule === 'string' ? j.schedule : (j.schedule?.expr || JSON.stringify(j.schedule))}
              </code>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: j.enabled ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.05)', color: j.enabled ? '#34d399' : 'rgba(255,255,255,0.3)', border: `1px solid ${j.enabled ? 'rgba(52,211,153,0.2)' : 'rgba(255,255,255,0.08)'}` }}>
              {j.enabled ? 'active' : 'paused'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {[{ label: 'Runs', value: j.run_count || 0, color: 'rgba(255,255,255,0.6)' },
              { label: 'Errors', value: j.error_count || 0, color: j.error_count > 0 ? '#f87171' : 'rgba(255,255,255,0.6)' },
              { label: 'Next', value: j.next_run_ms > 0 ? new Date(j.next_run_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—', color: '#fb923c' }].map(({ label, value, color }) => (
              <div key={label} className="text-center p-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="text-sm font-bold" style={{ color }}>{value}</div>
                <div className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.25)' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <Modal isOpen={!!selectedJob} onClose={() => setSelectedJob(null)} title={`Cron Job Details: ${selectedJob?.name || selectedJob?.id}`}>
        {selectedJob && <CronJobDetails job={selectedJob} />}
      </Modal>
    </div>
  );
}

/* ── Workspace ── */
function WorkspaceTab({ messages }: { messages: WsMessage[] }) {
  const [modalContent, setModalContent] = useState<{ title: string, content: string } | null>(null);
  const [activeAgent, setActiveAgent] = useState<string>('main');

  // Get all workspace events
  const wsEvents = messages.filter((m: WsMessage) => m.type === 'workspace_event');

  // Find unique agents from the latest events (we can use a map to keep the latest event per agent)
  const agentEventsMap = new Map<string, any>();
  wsEvents.forEach(ev => {
    if (ev.summary?.agent_name) {
      agentEventsMap.set(ev.summary.agent_name, ev);
    }
  });

  const availableAgents = Array.from(agentEventsMap.keys()).sort();

  // If no active agent selected or it doesn't exist, fallback to the first one
  useEffect(() => {
    if (availableAgents.length > 0 && !availableAgents.includes(activeAgent)) {
      setActiveAgent(availableAgents.includes('main') ? 'main' : availableAgents[0]);
    }
  }, [availableAgents, activeAgent]);

  const latestEvent = agentEventsMap.get(activeAgent);

  if (availableAgents.length === 0) {
    return <EmptyState icon="📁" title="No workspace events" subtitle="Workspace state and files will appear here" />;
  }

  const getFileMeta = (filename: string) => {
    const meta: Record<string, { icon: string, color: string }> = {
      'SOUL.md': { icon: '🧠', color: '#f472b6' },
      'AGENTS.md': { icon: '🤖', color: '#60a5fa' },
      'state.json': { icon: '⚙️', color: '#34d399' },
      'BOOTSTRAP.md': { icon: '🚀', color: '#fb923c' },
      'IDENTITY.md': { icon: '🎭', color: '#a855f7' },
      'TOOLS.md': { icon: '🔧', color: '#facc15' },
      'USER.md': { icon: '👤', color: '#2dd4bf' },
      'HEARTBEAT.md': { icon: '❤️', color: '#ef4444' },
    };
    return meta[filename] || { icon: '📄', color: '#94a3b8' };
  };

  const files = latestEvent?.files || [];
  const memoryExists = latestEvent?.summary?.memory_exists;

  return (
    <div className="space-y-5 animate-fade-up">
      {/* Agent Selector */}
      {availableAgents.length > 1 && (
        <div className="flex gap-2 p-1.5 rounded-xl overflow-x-auto scrollbar-none" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
          {availableAgents.map(agent => (
            <button key={agent} onClick={() => setActiveAgent(agent)}
              className={`px-4 py-2 rounded-lg text-xs font-bold tracking-wider uppercase transition-all whitespace-nowrap ${activeAgent === agent ? 'shadow-lg' : 'opacity-40 hover:opacity-80'}`}
              style={{
                background: activeAgent === agent ? 'rgba(96,165,250,0.15)' : 'transparent',
                color: activeAgent === agent ? '#60a5fa' : 'white'
              }}>
              {agent}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {files.map((file: any) => {
          const { icon, color } = getFileMeta(file.filename);
          return (
            <div key={file.filename} 
              onClick={() => { if (file.content) setModalContent({ title: file.filename, content: file.content }) }}
              className="glass-card p-5 text-center transition-all duration-300 cursor-pointer hover:scale-[1.02]"
              style={{ borderColor: `${color}40`, boxShadow: `0 0 16px ${color}15` }}>
              <div className="text-2xl mb-2">{icon}</div>
              <div className="text-sm font-medium mb-1" style={{ color: 'rgba(255,255,255,0.9)' }}>{file.filename}</div>
              <div className="text-[10px] font-medium uppercase tracking-widest" style={{ color: color }}>
                Click to view
              </div>
            </div>
          );
        })}

        {memoryExists && (
          <div className="glass-card p-5 text-center transition-all duration-300 opacity-70"
            style={{ borderColor: 'rgba(167,139,250,0.4)' }}>
            <div className="text-2xl mb-2">🗂️</div>
            <div className="text-sm font-medium mb-1" style={{ color: 'rgba(255,255,255,0.9)' }}>memory/</div>
            <div className="text-[10px] font-medium uppercase tracking-widest" style={{ color: '#a78bfa' }}>
              Directory
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={!!modalContent} onClose={() => setModalContent(null)} title={`Workspace — ${modalContent?.title}`}>
        <pre className="whitespace-pre-wrap font-mono p-4 rounded-xl bg-black/40 border border-white/5" style={{ color: '#34d399' }}>
          {modalContent?.content}
        </pre>
      </Modal>
    </div>
  );
}

/* ── Logs ── */
function LogsTab({ messages }: any) {
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const gatewayLogs = messages.filter((m: WsMessage) => m.type === 'gateway_log_event');

  if (gatewayLogs.length === 0) {
    return <EmptyState icon="📋" title="No logs yet" subtitle="Gateway and system logs will stream here" />;
  }

  const filteredLogs = gatewayLogs.filter((ev: WsMessage) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const pathMatch = ev.log_path?.toLowerCase().includes(q);
    const linesMatch = ev.lines?.some((l: any) => 
      (typeof l === 'string' ? l : JSON.stringify(l)).toLowerCase().includes(q)
    );
    return pathMatch || linesMatch;
  });

  const LEVEL_COLORS: Record<string, string> = { error: '#f87171', warn: '#fbbf24', info: '#60a5fa' };

  return (
    <div className="space-y-4 animate-fade-up">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <span className="text-white/30 text-xs">🔍</span>
          </div>
          <input
            type="text"
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/[0.03] border border-white/10 rounded-lg pl-8 pr-4 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50 transition-colors"
          />
        </div>
        <div className="text-[10px] text-white/40">
          Showing {filteredLogs.length} of {gatewayLogs.length} logs
        </div>
      </div>

      <div className="space-y-1.5">
        {[...filteredLogs]
          .sort((a: WsMessage, b: WsMessage) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 100)
          .map((ev: WsMessage, i: number) => {
            let level = (ev as any).level || 'info';
            if (ev.lines && ev.lines.length > 0 && typeof ev.lines[0] === 'object') {
              level = ev.lines[0].level || ev.lines[0].status || 'info';
            }
            const isExpanded = expandedLogId === i || !!searchQuery; // Auto-expand when searching
            
            return (
              <div key={i} className="flex flex-col gap-2 p-3 rounded-xl animate-slide-in transition-all hover:bg-white/[0.03] cursor-pointer"
                onClick={() => setExpandedLogId(isExpanded && !searchQuery ? null : i)}
                style={{ animationDelay: `${i * 15}ms`, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex items-start gap-3">
                  <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded shrink-0 font-bold"
                    style={{ background: (LEVEL_COLORS[level] || 'rgba(255,255,255,0.2)') + '15', color: LEVEL_COLORS[level] || 'rgba(255,255,255,0.35)', border: `1px solid ${LEVEL_COLORS[level] || 'rgba(255,255,255,0.1)'}25` }}>
                    {level}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs truncate font-mono" style={{ color: 'rgba(255,255,255,0.4)' }}>{ev.log_path?.split('/').pop() || 'system.log'}</div>
                  </div>
                  <span className="text-[10px] shrink-0" style={{ color: 'rgba(255,255,255,0.15)' }}>
                    {ev.timestamp ? fmtMs(new Date(ev.timestamp).getTime()) : ''}
                  </span>
                </div>
                
                {isExpanded && ev.lines && ev.lines.length > 0 && (
                  <div className="mt-2 p-3 rounded-lg bg-black/40 border border-white/5 overflow-x-auto" onClick={(e) => e.stopPropagation()}>
                    <pre className="text-[10px] font-mono text-gray-300 whitespace-pre-wrap leading-relaxed">
                      {ev.lines.map((l: any) => typeof l === 'string' ? l : JSON.stringify(l, null, 2)).join('\n')}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

/* ── Empty state ── */
function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-28 text-center">
      <div className="text-5xl mb-5 animate-float">{icon}</div>
      <div className="text-sm font-medium mb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>{title}</div>
      <div className="text-xs" style={{ color: 'rgba(255,255,255,0.18)' }}>{subtitle}</div>
    </div>
  );
}

/* ── App ── */
export default function App() {
  const isDev = import.meta.env.DEV;
  const host = isDev ? 'localhost:8000' : window.location.host;
  const wsUrl = `ws://${host}/api/v1/ws`;
  const { messages, connected } = useWebSocket(wsUrl);
  const [tab, setTab] = useState<typeof TABS[number]>('overview');

  return (
    <div className="h-screen flex flex-col overflow-hidden text-white font-sans bg-black relative">
      <ParticleBackground />

      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse at 15% 0%, rgba(59,130,246,0.07) 0%, transparent 45%), radial-gradient(ellipse at 85% 100%, rgba(139,92,246,0.07) 0%, transparent 45%), radial-gradient(ellipse at 50% 50%, rgba(99,102,241,0.04) 0%, transparent 65%)',
        zIndex: 0,
      }} />

      <div className="relative z-10 flex flex-col min-h-screen">
        <Header connected={connected} messages={messages} />
        <TabBar tab={tab} setTab={setTab} />

        <div className="flex-1 p-6">
          {tab === 'overview' && <OverviewTab messages={messages} />}
          {tab === 'tokens' && <TokensTab messages={messages} />}
          {tab === 'sessions' && <SessionsTab messages={messages} />}
          {tab === 'cron' && <CronTab messages={messages} />}
          {tab === 'workspace' && <WorkspaceTab messages={messages} />}
          {tab === 'logs' && <LogsTab messages={messages} />}
        </div>
      </div>
    </div>
  );
}
