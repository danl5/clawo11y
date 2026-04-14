import { describe, it, expect } from 'vitest';

function calculateCost(
  promptTokens: number,
  completionTokens: number,
  pricing?: { prompt?: number; completion?: number; input?: number; output?: number }
): number {
  if (!pricing) return 0;
  const inputKey = pricing.prompt !== undefined ? 'prompt' : pricing.input !== undefined ? 'input' : null;
  const outputKey = pricing.completion !== undefined ? 'completion' : pricing.output !== undefined ? 'output' : null;
  const inputCost = inputKey ? (pricing as any)[inputKey] : 0;
  const outputCost = outputKey ? (pricing as any)[outputKey] : 0;
  return (promptTokens * inputCost + completionTokens * outputCost) / 1_000_000;
}

function classifyToolRisk(toolName?: string, _params?: any): {
  toolCategory: string;
  toolRiskClass: string;
  riskReason: string;
} {
  if (!toolName) return { toolCategory: 'unknown', toolRiskClass: 'low', riskReason: '' };
  const name = toolName.toLowerCase();
  const isExecTool = /\b(exec|bash|sh|shell|run_command|subprocess)\b/.test(name);
  const isFsTool = /\b(fs_write|file_write|create_file|fs_read|file_read|read_file)\b/.test(name);
  const isNetTool = /\b(http_request|fetch|http_fetch|web_fetch|browser|curl|wget)\b/.test(name);
  const isCodeTool = /\b(code_execution|python_execute|execute_code|run_code)\b/.test(name);
  const isDbTool = /\b(db_query|sql|database|query|mysql|postgres)\b/.test(name);
  const isVcsTool = /(^|_)(git|svn)(_|$)/.test(name);
  if (isExecTool) return { toolCategory: 'shell', toolRiskClass: 'high', riskReason: 'Arbitrary command execution' };
  if (isFsTool) return { toolCategory: 'filesystem', toolRiskClass: 'high', riskReason: 'File write operations' };
  if (isNetTool) return { toolCategory: 'network', toolRiskClass: 'medium', riskReason: 'Network access capabilities' };
  if (isCodeTool) return { toolCategory: 'code', toolRiskClass: 'medium', riskReason: 'Dynamic code execution' };
  if (isDbTool) return { toolCategory: 'database', toolRiskClass: 'high', riskReason: 'Database query operations' };
  if (isVcsTool) return { toolCategory: 'vcs', toolRiskClass: 'medium', riskReason: 'Version control access' };
  return { toolCategory: 'general', toolRiskClass: 'low', riskReason: '' };
}

function resolveSubagentLabel(attrs: Record<string, any>): string {
  if (attrs['subagent.label']) return attrs['subagent.label'];
  if (attrs['subagent.agent_id']) return attrs['subagent.agent_id'];
  if (attrs['subagent.name']) return attrs['subagent.name'];
  return 'unknown';
}

describe('calculateCost', () => {
  it('returns 0 when pricing is undefined', () => {
    expect(calculateCost(100, 50)).toBe(0);
  });

  it('returns 0 when pricing is empty', () => {
    expect(calculateCost(100, 50, {})).toBe(0);
  });

  it('calculates cost using prompt/completion keys', () => {
    const cost = calculateCost(1_000_000, 500_000, { prompt: 0.3, completion: 1.2 });
    expect(cost).toBeCloseTo(0.3 + 0.6, 4);
  });

  it('calculates cost using input/output keys', () => {
    const cost = calculateCost(1_000_000, 500_000, { input: 0.3, output: 1.2 });
    expect(cost).toBeCloseTo(0.3 + 0.6, 4);
  });

  it('prefers prompt/completion over input/output when both present', () => {
    const cost = calculateCost(1_000_000, 500_000, { prompt: 0.5, completion: 2.0, input: 0.3, output: 1.2 });
    expect(cost).toBeCloseTo(0.5 + 1.0, 4);
  });

  it('handles zero tokens', () => {
    expect(calculateCost(0, 0, { prompt: 0.3, completion: 1.2 })).toBe(0);
  });

  it('handles fractional millionths', () => {
    const cost = calculateCost(100, 50, { prompt: 0.3, completion: 1.2 });
    expect(cost).toBeCloseTo(0.00003 + 0.00006, 6);
  });
});

describe('classifyToolRisk', () => {
  it('returns low/unknown for undefined tool name', () => {
    expect(classifyToolRisk()).toEqual({ toolCategory: 'unknown', toolRiskClass: 'low', riskReason: '' });
  });

  it('classifies exec-like tools as high risk shell', () => {
    expect(classifyToolRisk('exec')).toEqual({ toolCategory: 'shell', toolRiskClass: 'high', riskReason: 'Arbitrary command execution' });
    expect(classifyToolRisk('bash')).toEqual({ toolCategory: 'shell', toolRiskClass: 'high', riskReason: 'Arbitrary command execution' });
    expect(classifyToolRisk('run_command')).toEqual({ toolCategory: 'shell', toolRiskClass: 'high', riskReason: 'Arbitrary command execution' });
  });

  it('classifies fs_write-like tools as high risk filesystem', () => {
    expect(classifyToolRisk('fs_write')).toEqual({ toolCategory: 'filesystem', toolRiskClass: 'high', riskReason: 'File write operations' });
    expect(classifyToolRisk('file_write')).toEqual({ toolCategory: 'filesystem', toolRiskClass: 'high', riskReason: 'File write operations' });
  });

  it('classifies network tools as medium risk', () => {
    expect(classifyToolRisk('http_request')).toEqual({ toolCategory: 'network', toolRiskClass: 'medium', riskReason: 'Network access capabilities' });
    expect(classifyToolRisk('curl')).toEqual({ toolCategory: 'network', toolRiskClass: 'medium', riskReason: 'Network access capabilities' });
  });

  it('classifies code execution tools as medium risk', () => {
    expect(classifyToolRisk('python_execute')).toEqual({ toolCategory: 'code', toolRiskClass: 'medium', riskReason: 'Dynamic code execution' });
    expect(classifyToolRisk('run_code')).toEqual({ toolCategory: 'code', toolRiskClass: 'medium', riskReason: 'Dynamic code execution' });
  });

  it('classifies python alone as general/low (not a tool name by itself)', () => {
    expect(classifyToolRisk('python')).toEqual({ toolCategory: 'general', toolRiskClass: 'low', riskReason: '' });
  });

  it('classifies database tools as high risk', () => {
    expect(classifyToolRisk('db_query')).toEqual({ toolCategory: 'database', toolRiskClass: 'high', riskReason: 'Database query operations' });
    expect(classifyToolRisk('sql')).toEqual({ toolCategory: 'database', toolRiskClass: 'high', riskReason: 'Database query operations' });
  });

  it('classifies git tools as medium risk', () => {
    expect(classifyToolRisk('git_commit')).toEqual({ toolCategory: 'vcs', toolRiskClass: 'medium', riskReason: 'Version control access' });
  });

  it('returns low/general for unknown tools', () => {
    expect(classifyToolRisk('web_search')).toEqual({ toolCategory: 'general', toolRiskClass: 'low', riskReason: '' });
    expect(classifyToolRisk('random_tool')).toEqual({ toolCategory: 'general', toolRiskClass: 'low', riskReason: '' });
  });

  it('is case insensitive', () => {
    expect(classifyToolRisk('EXEC')).toEqual({ toolCategory: 'shell', toolRiskClass: 'high', riskReason: 'Arbitrary command execution' });
  });
});

describe('resolveSubagentLabel', () => {
  it('returns subagent.label when present', () => {
    expect(resolveSubagentLabel({ 'subagent.label': 'researcher' })).toBe('researcher');
  });

  it('returns subagent.agent_id when label absent', () => {
    expect(resolveSubagentLabel({ 'subagent.agent_id': 'agent-42' })).toBe('agent-42');
  });

  it('returns subagent.name as fallback', () => {
    expect(resolveSubagentLabel({ 'subagent.name': 'coordinator' })).toBe('coordinator');
  });

  it('prefers label over agent_id over name', () => {
    expect(resolveSubagentLabel({ 'subagent.label': 'primary', 'subagent.agent_id': 'id-2', 'subagent.name': 'name-3' })).toBe('primary');
  });

  it('returns unknown when no label keys present', () => {
    expect(resolveSubagentLabel({})).toBe('unknown');
  });
});
