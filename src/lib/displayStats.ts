// 首页店铺卡片展示用的“放大版”销量/评论数——只影响展示,不改变真实数据。
// 复用 homeShuffle.ts 里的 mulberry32 数字种子 PRNG 写法,额外加一个字符串→数字种子的 hash。

function hashStringToSeed(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

const AMPLIFY_FACTOR = 20;
const JITTER_RANGE = 0.24; // ±12%

function jitterFor(restaurantId: string, metric: 'sales' | 'reviews', dateStr: string): number {
  const seed = hashStringToSeed(`${restaurantId}:${metric}:${dateStr}`);
  const rng = mulberry32(seed);
  return 1 + (rng() - 0.5) * JITTER_RANGE;
}

/** 首页卡片展示用的放大后销量/评论数。同一店铺同一天内结果稳定,跨天自然变化。 */
export function getDisplayStats(
  restaurantId: string,
  monthlyOrders: number,
  ratingCount: number,
): { displaySales: number; displayReviews: number } {
  const dateStr = new Date().toISOString().slice(0, 10);
  return {
    displaySales: Math.round(monthlyOrders * AMPLIFY_FACTOR * jitterFor(restaurantId, 'sales', dateStr)),
    displayReviews: Math.round(ratingCount * AMPLIFY_FACTOR * jitterFor(restaurantId, 'reviews', dateStr)),
  };
}

/** 超过1万显示为 "X.X万",否则原样返回数字字符串。 */
export function formatCount(n: number): string {
  return n > 10000 ? `${(n / 10000).toFixed(1)}万` : `${n}`;
}
