import { describe, it, expect } from 'vitest';
import {
  formatTokens,
  formatCost,
  formatDuration,
  calcCostPer1M,
  calcCostPerCall,
  calcErrorRate,
  percentile,
} from './utils';

describe('formatTokens', () => {
  it('returns raw number under 1K', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(500)).toBe('500');
    expect(formatTokens(999)).toBe('999');
  });

  it('adds K suffix for thousands', () => {
    expect(formatTokens(1000)).toBe('1.0K');
    expect(formatTokens(1500)).toBe('1.5K');
    expect(formatTokens(999999)).toBe('1000.0K');
  });

  it('adds M suffix for millions', () => {
    expect(formatTokens(1_000_000)).toBe('1.00M');
    expect(formatTokens(2_500_000)).toBe('2.50M');
  });
});

describe('formatCost', () => {
  it('returns <$0.001 for very small costs', () => {
    expect(formatCost(0)).toBe('<$0.001');
    expect(formatCost(0.0001)).toBe('<$0.001');
    expect(formatCost(0.0009)).toBe('<$0.001');
  });

  it('formats sub-dollar costs with 3 decimals', () => {
    expect(formatCost(0.001)).toBe('$0.001');
    expect(formatCost(0.5)).toBe('$0.500');
    expect(formatCost(0.999)).toBe('$0.999');
  });

  it('formats 1-100 costs with 2 decimals', () => {
    expect(formatCost(1)).toBe('$1.00');
    expect(formatCost(50.5)).toBe('$50.50');
    expect(formatCost(99.99)).toBe('$99.99');
  });

  it('formats large costs with 1 decimal', () => {
    expect(formatCost(100)).toBe('$100.0');
    expect(formatCost(1234.5)).toBe('$1234.5');
  });
});

describe('formatDuration', () => {
  it('formats milliseconds under 1 second', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats seconds for sub-minute durations', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(5500)).toBe('5.5s');
    expect(formatDuration(59500)).toBe('59.5s');
  });

  it('formats minutes for durations >= 60 seconds', () => {
    expect(formatDuration(60000)).toBe('1.0m');
    expect(formatDuration(90000)).toBe('1.5m');
    expect(formatDuration(600000)).toBe('10.0m');
  });
});

describe('calcCostPer1M', () => {
  it('returns 0 when tokens are 0', () => {
    expect(calcCostPer1M(0, 0, 0.3, 1.2)).toBe(0);
  });

  it('calculates cost using per-million prices', () => {
    expect(calcCostPer1M(1_000_000, 500_000, 0.3, 1.2)).toBeCloseTo(0.9, 4);
  });

  it('handles fractional million', () => {
    expect(calcCostPer1M(100, 50, 0.3, 1.2)).toBeCloseTo(0.00009, 6);
  });
});

describe('calcCostPerCall', () => {
  it('returns 0 when calls is 0', () => {
    expect(calcCostPerCall(10, 0)).toBe(0);
  });

  it('calculates average cost per call', () => {
    expect(calcCostPerCall(10, 2)).toBe(5);
    expect(calcCostPerCall(0, 5)).toBe(0);
  });
});

describe('calcErrorRate', () => {
  it('returns 0 when total is 0', () => {
    expect(calcErrorRate(0, 0)).toBe(0);
  });

  it('returns 0 when errors is 0', () => {
    expect(calcErrorRate(0, 10)).toBe(0);
  });

  it('returns percentage', () => {
    expect(calcErrorRate(1, 10)).toBe(10);
    expect(calcErrorRate(5, 10)).toBe(50);
    expect(calcErrorRate(1, 3)).toBeCloseTo(33.33, 1);
  });
});

describe('percentile', () => {
  it('returns 0 for empty array', () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it('returns single element for single-item array', () => {
    expect(percentile([42], 0.5)).toBe(42);
  });

  it('returns p95 of sorted values with linear interpolation', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const result = percentile(values, 0.95);
    expect(result).toBeGreaterThan(90);
    expect(result).toBeLessThan(100);
  });

  it('handles unsorted input', () => {
    expect(percentile([100, 10, 50, 30, 20], 0.5)).toBe(30);
  });
});
