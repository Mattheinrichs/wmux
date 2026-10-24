import { describe, expect, it } from 'vitest';
import { openUrlArg } from '../../src/cli/wmux';

describe('wmux open argument', () => {
  it('accepts http and https and preserves the URL verbatim', () => {
    expect(openUrlArg(['open', 'https://example.com/a?b=c&d=e'])).toBe('https://example.com/a?b=c&d=e');
    expect(openUrlArg(['open', 'http://localhost:3000'])).toBe('http://localhost:3000');
  });

  it.each([
    ['open'],
    ['open', 'javascript:alert(1)'],
    ['open', 'file:///etc/passwd'],
    ['open', 'example.com'],
    ['open', ''],
    ['open', 'https://example.com', 'extra'],
  ])('rejects %p', args => {
    expect(() => openUrlArg(args)).toThrow(/http\(s\) URL/);
  });
});
