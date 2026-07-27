import { describe, expect, it } from 'vitest';
import { weightedSample } from '../lib/weightedSample';

/** Returns a fixed sequence of "random" values, one per call, in order. */
function fakeRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i];
    i++;
    if (v === undefined) throw new Error('fakeRng exhausted');
    return v;
  };
}

describe('weightedSample', () => {
  it('equal weights: higher rng draw wins (order = key desc)', () => {
    const items = ['a', 'b', 'c'];
    // key = rng ** (1/1) = rng itself when weight is 1 for all.
    const result = weightedSample(items, () => 1, 2, fakeRng([0.5, 0.9, 0.1]));
    expect(result).toEqual(['b', 'a']);
  });

  it('higher weight can beat a lower rng draw', () => {
    // A: weight 10, rng 0.1  -> key = 0.1 ** 0.1 ≈ 0.7943
    // B: weight 1,  rng 0.5  -> key = 0.5 ** 1   = 0.5
    const items = [
      { id: 'A', weight: 10 },
      { id: 'B', weight: 1 },
    ];
    const result = weightedSample(items, (x) => x.weight, 1, fakeRng([0.1, 0.5]));
    expect(result.map((x) => x.id)).toEqual(['A']);
  });

  it('near-zero weight is clamped, not NaN, and loses to any positive weight', () => {
    const items = [
      { id: 'zero', weight: 0 },
      { id: 'small', weight: 1 },
    ];
    // zero gets a huge rng draw, small gets a tiny one — zero should still lose
    // because its clamped weight (1e-6) makes key ≈ rng ** 1e6 ≈ 0 for any rng < 1.
    const result = weightedSample(items, (x) => x.weight, 2, fakeRng([0.99, 0.01]));
    expect(result.map((x) => x.id)).toEqual(['small', 'zero']);
  });

  it('k > items.length returns all items (same set, same length)', () => {
    const items = ['x', 'y', 'z'];
    const result = weightedSample(items, () => 1, 10, fakeRng([0.3, 0.6, 0.9]));
    expect(result).toHaveLength(3);
    expect(new Set(result)).toEqual(new Set(items));
  });

  it('k = 0 returns an empty array', () => {
    const result = weightedSample(['a', 'b'], () => 1, 0, fakeRng([0.5, 0.5]));
    expect(result).toEqual([]);
  });

  it('empty items returns an empty array without calling rng', () => {
    const result = weightedSample([], () => 1, 5, () => {
      throw new Error('should not be called');
    });
    expect(result).toEqual([]);
  });

  it('defaults to Math.random when rng is omitted', () => {
    const result = weightedSample([1, 2, 3], () => 1, 2);
    expect(result).toHaveLength(2);
  });
});
