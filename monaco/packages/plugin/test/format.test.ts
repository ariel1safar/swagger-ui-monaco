import { describe, expect, it } from 'vitest';
import { formatJsonResponse } from '../src/format';

describe('response formatting', () => {
  it('formats whitespace without changing number or string tokens', () => {
    const raw = '{"integer":9007199254740993,"decimal":1.2300,"string":"\\u0041"}';
    expect(formatJsonResponse(raw)).toBe('{\n  "integer": 9007199254740993,\n  "decimal": 1.2300,\n  "string": "\\u0041"\n}');
  });
  it.each(['{', '{"name":1,}', '{/* comment */"name":1}'])('rejects invalid JSON: %s', raw => {
    expect(() => formatJsonResponse(raw)).toThrow('Invalid JSON');
  });
});
