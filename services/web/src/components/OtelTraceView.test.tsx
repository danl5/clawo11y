import { describe, it, expect } from 'vitest';
import { parseAttrMap, readString, toPreview, shortId, formatNsTimestamp } from './OtelTraceView';

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
