import { describe, expect, it } from 'vitest';
import { interleaveRestaurants, seededShuffle } from './homeShuffle';

function makeShops(count: number, isPlayerMade: boolean, prefix: string) {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, isPlayerMade }));
}

describe('seededShuffle', () => {
  const input = Array.from({ length: 30 }, (_, i) => i);

  it('同种子同输入得到完全一致的输出', () => {
    expect(seededShuffle(input, 42)).toEqual(seededShuffle(input, 42));
  });

  it('不同种子得到不同顺序', () => {
    expect(seededShuffle(input, 1)).not.toEqual(seededShuffle(input, 2));
  });

  it('输出是输入的重排,且不修改入参', () => {
    const copy = [...input];
    const out = seededShuffle(input, 7);
    expect(input).toEqual(copy);
    expect([...out].sort((a, b) => a - b)).toEqual(copy);
  });

  it('空数组返回空数组', () => {
    expect(seededShuffle([], 1)).toEqual([]);
  });
});

describe('interleaveRestaurants', () => {
  it('保留全部元素(长度与 id 集合一致)', () => {
    const list = [...makeShops(10, false, 's'), ...makeShops(4, true, 'p')];
    const out = interleaveRestaurants(list, 42);
    expect(out).toHaveLength(14);
    expect(new Set(out.map((r) => r.id)).size).toBe(14);
  });

  it('少数组均匀散布:相邻玩家店之间的间隔差不超过 1', () => {
    const list = [...makeShops(12, false, 's'), ...makeShops(4, true, 'p')];
    const out = interleaveRestaurants(list, 42);
    const positions = out
      .map((r, i) => (r.isPlayerMade ? i : -1))
      .filter((i) => i >= 0);
    expect(positions).toHaveLength(4);
    const gaps = positions.slice(1).map((p, k) => p - positions[k]!);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
  });

  it('同种子结果稳定,不同种子顺序不同', () => {
    const list = [...makeShops(10, false, 's'), ...makeShops(5, true, 'p')];
    expect(interleaveRestaurants(list, 9)).toEqual(interleaveRestaurants(list, 9));
    expect(interleaveRestaurants(list, 9).map((r) => r.id)).not.toEqual(
      interleaveRestaurants(list, 10).map((r) => r.id),
    );
  });

  it('边界:空列表、全系统店、全玩家店', () => {
    expect(interleaveRestaurants([], 1)).toEqual([]);
    const allSystem = makeShops(5, false, 's');
    expect(new Set(interleaveRestaurants(allSystem, 1).map((r) => r.id)).size).toBe(5);
    const allPlayer = makeShops(5, true, 'p');
    expect(new Set(interleaveRestaurants(allPlayer, 1).map((r) => r.id)).size).toBe(5);
  });
});
