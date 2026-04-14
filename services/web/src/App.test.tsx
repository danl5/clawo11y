import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';

// Mock the components so we don't need to mount their complex internals
vi.mock('./components/OtelTraceView', () => ({
  OtelTraceView: () => <div data-testid="otel-trace-view">Trace View Mock</div>
}));
vi.mock('./components/OtelMetricsDashboard', () => ({
  OtelMetricsDashboard: () => <div data-testid="otel-metrics-dashboard">Metrics Mock</div>
}));
vi.mock('./components/OtelCostDashboard', () => ({
  OtelCostDashboard: () => <div data-testid="otel-cost-dashboard">Cost Mock</div>
}));
vi.mock('./components/OtelSecurityDashboard', () => ({
  OtelSecurityDashboard: () => <div data-testid="otel-security-dashboard">Security Mock</div>
}));

// Mock the canvas background to prevent jsdom errors
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useRef: vi.fn((val) => actual.useRef(val)),
    useEffect: vi.fn((fn, deps) => actual.useEffect(fn, deps)),
  };
});

// We need to mock the canvas method globally for jsdom
HTMLCanvasElement.prototype.getContext = vi.fn();

// Mock the websocket hook
vi.mock('./hooks/useWebSocket', () => ({
  useWebSocket: vi.fn().mockReturnValue({
    messages: [],
    connected: true,
  })
}));

describe('App', () => {
  it('renders the header and navigation tabs', () => {
    render(<App />);
    expect(screen.getByText('OpenClaw Observability')).toBeTruthy();
    expect(screen.getByText('sessions')).toBeTruthy();
    expect(screen.getByText('trace')).toBeTruthy();
    expect(screen.getByText('logs')).toBeTruthy();
  });

  it('switches tabs when clicked', () => {
    render(<App />);
    
    const traceTab = screen.getByText('trace');
    fireEvent.click(traceTab);
    expect(screen.getByTestId('otel-trace-view')).toBeTruthy();
    
    const metricsTab = screen.getByText('metrics');
    fireEvent.click(metricsTab);
    expect(screen.getByTestId('otel-metrics-dashboard')).toBeTruthy();

    const costTab = screen.getByText('cost');
    fireEvent.click(costTab);
    expect(screen.getByTestId('otel-cost-dashboard')).toBeTruthy();
  });
});
