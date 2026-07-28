import { describe, expect, it } from 'vitest';
import { computeRiderTier } from '../lib/riderTier';

describe('computeRiderTier', () => {
  it('0 completed orders is 新手骑手, next threshold is 5', () => {
    expect(computeRiderTier(0)).toEqual({ label: '新手骑手', index: 0, nextThreshold: 5 });
  });

  it('4 completed orders is still 新手骑手 (below the 资深骑手 threshold)', () => {
    expect(computeRiderTier(4)).toEqual({ label: '新手骑手', index: 0, nextThreshold: 5 });
  });

  it('5 completed orders is 资深骑手, next threshold is 20', () => {
    expect(computeRiderTier(5)).toEqual({ label: '资深骑手', index: 1, nextThreshold: 20 });
  });

  it('20 completed orders is 金牌骑手, next threshold is 50', () => {
    expect(computeRiderTier(20)).toEqual({ label: '金牌骑手', index: 2, nextThreshold: 50 });
  });

  it('50 completed orders is 王牌骑手, no next threshold (max tier)', () => {
    expect(computeRiderTier(50)).toEqual({ label: '王牌骑手', index: 3, nextThreshold: null });
  });

  it('well past the max tier stays at 王牌骑手 with no next threshold', () => {
    expect(computeRiderTier(999)).toEqual({ label: '王牌骑手', index: 3, nextThreshold: null });
  });
});
