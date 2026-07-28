import { describe, expect, it } from 'vitest';
import { formatWaitDuration } from './duration';

describe('formatWaitDuration', () => {
  it('formats under a minute as "s秒"', () => {
    expect(formatWaitDuration('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:45.000Z')).toBe('45秒');
  });

  it('formats a minute and change as "m分s秒"', () => {
    expect(formatWaitDuration('2026-01-01T00:00:00.000Z', '2026-01-01T00:02:03.000Z')).toBe('2分3秒');
  });

  it('rounds to the nearest second', () => {
    expect(formatWaitDuration('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.600Z')).toBe('1秒');
  });

  it('clamps a negative/out-of-order range to 0秒 instead of a negative duration', () => {
    expect(formatWaitDuration('2026-01-01T00:00:10.000Z', '2026-01-01T00:00:00.000Z')).toBe('0秒');
  });

  it('exact minutes show no leftover seconds as "m分0秒"', () => {
    expect(formatWaitDuration('2026-01-01T00:00:00.000Z', '2026-01-01T00:05:00.000Z')).toBe('5分0秒');
  });
});
