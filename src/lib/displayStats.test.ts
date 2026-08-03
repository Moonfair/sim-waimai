import { describe, expect, it } from 'vitest';
import { formatCount, getDisplayStats } from './displayStats';

describe('getDisplayStats', () => {
  it('同一店铺、同一天多次调用结果完全一致(确定性)', () => {
    const a = getDisplayStats('shop-1', 100, 50);
    const b = getDisplayStats('shop-1', 100, 50);
    expect(a).toEqual(b);
  });

  it('展示值约为真实值的20倍,且落在 ±12% 抖动范围内', () => {
    const { displaySales, displayReviews } = getDisplayStats('shop-2', 100, 50);
    const salesBase = 100 * 20;
    const reviewsBase = 50 * 20;
    expect(displaySales).toBeGreaterThanOrEqual(Math.round(salesBase * 0.88));
    expect(displaySales).toBeLessThanOrEqual(Math.round(salesBase * 1.12));
    expect(displayReviews).toBeGreaterThanOrEqual(Math.round(reviewsBase * 0.88));
    expect(displayReviews).toBeLessThanOrEqual(Math.round(reviewsBase * 1.12));
  });

  it('真实值为 0 时展示值也是 0(不做下限兜底)', () => {
    expect(getDisplayStats('shop-3', 0, 0)).toEqual({ displaySales: 0, displayReviews: 0 });
  });

  it('销量与评论数的抖动互相独立(不同店铺下二者不会永远同步变化)', () => {
    const samples = Array.from({ length: 10 }, (_, i) => getDisplayStats(`shop-${i}`, 100, 100));
    const salesValues = new Set(samples.map((s) => s.displaySales));
    const reviewsValues = new Set(samples.map((s) => s.displayReviews));
    // 真实值相同(100, 100)但种子不同,展示值应该有波动、不是常数
    expect(salesValues.size).toBeGreaterThan(1);
    expect(reviewsValues.size).toBeGreaterThan(1);
    // 同一批店铺里,销量展示值集合和评论数展示值集合不应完全相同(证明二者种子独立)
    expect([...salesValues].sort()).not.toEqual([...reviewsValues].sort());
  });

  it('不同店铺id得到不同的抖动结果', () => {
    const a = getDisplayStats('shop-a', 100, 100);
    const b = getDisplayStats('shop-b', 100, 100);
    expect(a).not.toEqual(b);
  });
});

describe('formatCount', () => {
  it('小于等于1万原样返回数字字符串', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(100)).toBe('100');
    expect(formatCount(10000)).toBe('10000');
  });

  it('大于1万显示为 X.X万', () => {
    expect(formatCount(12345)).toBe('1.2万');
    expect(formatCount(100000)).toBe('10.0万');
  });
});
