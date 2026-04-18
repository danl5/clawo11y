import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { parseAttrMap, readString, toPreview, shortId, formatNsTimestamp } from './OtelTraceView';
import { OtelTraceView } from './OtelTraceView';

describe('parseAttrMap', () => {
  it('returns empty object for falsy values', () => {
    expect(parseAttrMap(null)).toEqual({});
    expect(parseAttrMap(undefined)).toEqual({});
    expect(parseAttrMap('')).toEqual({});
  });

  it('parses valid JSON string into object', () => {
    expect(parseAttrMap('{"key":"value"}')).toEqual({ key: 'value' });
  });

  it('returns empty object for invalid JSON string', () => {
    expect(parseAttrMap('{invalid json}')).toEqual({});
  });

  it('returns empty object if JSON parses to array', () => {
    expect(parseAttrMap('["a", "b"]')).toEqual({});
  });

  it('returns the object if it is already a plain object', () => {
    const obj = { foo: 'bar' };
    expect(parseAttrMap(obj)).toBe(obj);
  });

  it('returns empty object if value is an array object', () => {
    expect(parseAttrMap(['a', 'b'])).toEqual({});
  });
});

describe('readString', () => {
  it('returns the first non-empty string', () => {
    expect(readString(null, undefined, '', '  ', 'hello', 'world')).toBe('hello');
  });

  it('trims the returned string', () => {
    expect(readString('  padded  ')).toBe('padded');
  });

  it('returns empty string if no valid strings are found', () => {
    expect(readString(null, 123, {}, [])).toBe('');
  });
});

describe('toPreview', () => {
  it('returns empty string for null/undefined', () => {
    expect(toPreview(null)).toBe('');
    expect(toPreview(undefined)).toBe('');
  });

  it('normalizes whitespace', () => {
    expect(toPreview('line1\nline2\tline3')).toBe('line1 line2 line3');
  });

  it('stringifies objects', () => {
    expect(toPreview({ a: 1 })).toBe('{"a":1}');
  });

  it('truncates long strings to maxLen', () => {
    const longString = 'a'.repeat(200);
    const preview = toPreview(longString, 10);
    expect(preview).toBe('aaaaaaaaaa...');
    expect(preview.length).toBe(13); // 10 + 3 for ...
  });
});

describe('shortId', () => {
  it('returns "-" for empty string', () => {
    expect(shortId('')).toBe('-');
  });

  it('returns the string if shorter than size', () => {
    expect(shortId('abc', 5)).toBe('abc');
  });

  it('truncates and adds ... if longer than size', () => {
    expect(shortId('abcdefghij', 5)).toBe('abcde...');
  });

  it('uses default size of 8', () => {
    expect(shortId('1234567890')).toBe('12345678...');
  });
});

describe('formatNsTimestamp', () => {
  it('returns "-" for 0 or falsy', () => {
    expect(formatNsTimestamp(0)).toBe('-');
  });

  it('formats nanoseconds to locale string', () => {
    const unixMs = new Date('2026-04-14T10:00:00.000Z').getTime();
    const unixNs = unixMs * 1_000_000;
    const formatted = formatNsTimestamp(unixNs);
    // Since it uses toLocaleString(), the exact output depends on timezone, 
    // but it should not be "-" and should contain some part of the date.
    expect(formatted).not.toBe('-');
    expect(typeof formatted).toBe('string');
  });
});

describe('OtelTraceView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads related runs, supports relation source filtering, and navigates linked runs', async () => {
    const rootTrace = {
      TraceID: 'trace-root-1',
      SpanID: 'span-root-1',
      ParentSpanID: '',
      Name: 'command.process',
      DurationNs: 2_000_000_000,
      StatusCode: 1,
      CostUsd: 0,
      TotalTokens: 0,
      StartTimeUnix: 1,
      CreatedAt: '2026-04-15T10:00:00Z',
      Attributes: JSON.stringify({
        session_id: 'sess-1',
        run_id: 'run-root-1',
        assistant_preview: 'root summary preview',
        run_lineage_id: 'run-lineage-root-1',
        root_run_lineage_id: 'run-lineage-root-1',
        run_status: 'ok',
      }),
    };

    const childTrace = {
      TraceID: 'trace-child-1',
      SpanID: 'span-child-1',
      ParentSpanID: '',
      Name: 'command.process',
      DurationNs: 1_500_000_000,
      StatusCode: 2,
      CostUsd: 0,
      TotalTokens: 0,
      StartTimeUnix: 2,
      CreatedAt: '2026-04-15T10:00:05Z',
      Attributes: JSON.stringify({
        session_id: 'sess-2',
        run_id: 'run-child-1',
        'subagent.parent_session_key': 'sess-1',
        assistant_preview: 'child fallback preview',
        run_lineage_id: 'run-lineage-child-1',
        parent_run_lineage_id: 'run-lineage-root-1',
        root_run_lineage_id: 'run-lineage-root-1',
        run_relation_source: 'sessions_spawn_fallback',
        run_status: 'error',
      }),
    };

    const childTrace2 = {
      TraceID: 'trace-child-2',
      SpanID: 'span-child-2',
      ParentSpanID: '',
      Name: 'command.process',
      DurationNs: 1_200_000_000,
      StatusCode: 1,
      CostUsd: 0,
      TotalTokens: 0,
      StartTimeUnix: 3,
      CreatedAt: '2026-04-15T10:00:08Z',
      Attributes: JSON.stringify({
        session_id: 'sess-3',
        run_id: 'run-child-2',
        'subagent.parent_session_key': 'sess-1',
        assistant_preview: 'child hook preview',
        run_lineage_id: 'run-lineage-child-2',
        parent_run_lineage_id: 'run-lineage-root-1',
        root_run_lineage_id: 'run-lineage-root-1',
        run_relation_source: 'hook',
        run_status: 'ok',
      }),
    };

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/otlp/traces/recent')) {
        return Promise.resolve({ json: () => Promise.resolve([rootTrace, childTrace, childTrace2]) });
      }
      if (url.endsWith('/api/v1/otlp/trace/trace-root-1')) {
        return Promise.resolve({ json: () => Promise.resolve([{ ...rootTrace, children: [] }]) });
      }
      if (url.endsWith('/api/v1/otlp/trace/trace-child-1')) {
        return Promise.resolve({ json: () => Promise.resolve([{ ...childTrace, children: [] }]) });
      }
      if (url.endsWith('/api/v1/otlp/trace/trace-child-2')) {
        return Promise.resolve({ json: () => Promise.resolve([{ ...childTrace2, children: [] }]) });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<OtelTraceView />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/otlp/traces/recent');
    });

    await waitFor(() => {
      expect(screen.getByText('error-rate:33%')).toBeTruthy();
    });

    expect(screen.getByText('Recent Runs')).toBeTruthy();
    expect(screen.getAllByText('Related Runs').length).toBeGreaterThan(0);
    expect(screen.getByText('切到 next child')).toBeTruthy();
    expect(screen.getByText('subagent-success:50%')).toBeTruthy();
    expect(screen.getAllByText('root summary preview').length).toBeGreaterThan(0);
    expect(screen.getAllByText('child fallback preview').length).toBeGreaterThan(0);
    expect(screen.getAllByText('child hook preview').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByText('child fallback preview')[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/otlp/trace/trace-child-1');
    });

    fireEvent.click(screen.getByText('切到 next child'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/otlp/trace/trace-child-2');
    });

    fireEvent.change(screen.getByLabelText('Relation Source Filter'), {
      target: { value: 'sessions_spawn_fallback' },
    });

    await waitFor(() => {
      expect((screen.getByLabelText('Relation Source Filter') as HTMLSelectElement).value).toBe('sessions_spawn_fallback');
    });
    expect(screen.getAllByText('child fallback preview').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('切到 parent'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/otlp/trace/trace-root-1');
    });
  });
});
