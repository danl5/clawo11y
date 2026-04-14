export function formatTokens(tokenCount: number): string {
  if (tokenCount < 1000) return String(tokenCount);
  if (tokenCount < 1_000_000) return `${(tokenCount / 1000).toFixed(1)}K`;
  return `${(tokenCount / 1_000_000).toFixed(2)}M`;
}

export function formatCost(costUsd: number): string {
  if (costUsd < 0.001) return `<$0.001`;
  if (costUsd < 1) return `$${costUsd.toFixed(3)}`;
  if (costUsd < 100) return `$${costUsd.toFixed(2)}`;
  return `$${costUsd.toFixed(1)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function calcCostPer1M(promptTokens: number, completionTokens: number, inputPrice: number, outputPrice: number): number {
  return (promptTokens * inputPrice + completionTokens * outputPrice) / 1_000_000;
}

export function calcCostPerCall(totalCostUsd: number, totalCalls: number): number {
  if (totalCalls === 0) return 0;
  return totalCostUsd / totalCalls;
}

export function calcErrorRate(errors: number, total: number): number {
  if (total === 0) return 0;
  return (errors / total) * 100;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
