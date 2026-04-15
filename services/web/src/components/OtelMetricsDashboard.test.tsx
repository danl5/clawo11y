import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OtelMetricsDashboard, normalizeHealth, normalizeOverview } from './OtelMetricsDashboard';

describe('normalizeOverview', () => {
  it('converts null collections into empty arrays', () => {
    const overview = normalizeOverview({
      summary: { total_runs: 3 },
      recent_runs: null,
      models: null,
      tools: null,
      subagents: null,
      log_events: null,
    });

    expect(overview).not.toBeNull();
    expect(overview?.summary.total_runs).toBe(3);
    expect(overview?.recent_runs).toEqual([]);
    expect(overview?.models).toEqual([]);
    expect(overview?.tools).toEqual([]);
    expect(overview?.subagents).toEqual([]);
    expect(overview?.log_events).toEqual([]);
  });
});

describe('normalizeHealth', () => {
  it('converts null collections into empty arrays', () => {
    const health = normalizeHealth({
      summary: { anomaly_count: 2 },
      anomaly_types: null,
      close_reasons: null,
      recent_anomalies: null,
    });

    expect(health).not.toBeNull();
    expect(health?.summary.anomaly_count).toBe(2);
    expect(health?.anomaly_types).toEqual([]);
    expect(health?.close_reasons).toEqual([]);
    expect(health?.recent_anomalies).toEqual([]);
  });
});

describe('OtelMetricsDashboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders empty tables without crashing when overview arrays are null', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: vi.fn().mockResolvedValue([]) })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          summary: {
            window_hours: 24,
            total_runs: 0,
            errored_runs: 0,
            avg_run_duration_ms: 0,
            total_tokens: 0,
            total_cost_usd: 0,
          },
          recent_runs: null,
          models: null,
          tools: null,
          subagents: null,
          log_events: null,
        }),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          summary: {
            window_hours: 24,
            anomaly_count: 0,
            idle_timeout_closures: 0,
            root_recreated_count: 0,
            orphan_event_count: 0,
            agent_end_without_root: 0,
          },
          anomaly_types: null,
          close_reasons: null,
          recent_anomalies: null,
        }),
      });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('setInterval', vi.fn(() => 1));
    vi.stubGlobal('clearInterval', vi.fn());

    render(<OtelMetricsDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Top Models')).toBeTruthy();
    });

    expect(screen.getByText('Subagents')).toBeTruthy();
    expect(screen.getByText('Observability Health')).toBeTruthy();
  });
});
