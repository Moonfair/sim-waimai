// 首页“附近餐厅”的会话内稳定随机排序:玩家自制商家与系统商家各自洗牌后按比例均匀穿插。
// 种子在模块加载时生成一次——每次打开/刷新页面重新打散,SPA 内导航保持稳定。

export const HOME_SHUFFLE_SEED = Math.floor(Math.random() * 0x100000000);

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

export function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** 将较小的一组按比例均匀插入较大的一组(Bresenham 式分配),小组不扎堆、不沉底。 */
function proportionalMerge<T>(groupA: T[], groupB: T[]): T[] {
  const [major, minor] = groupA.length >= groupB.length ? [groupA, groupB] : [groupB, groupA];
  const total = major.length + minor.length;
  const out: T[] = [];
  let majorIdx = 0;
  let minorIdx = 0;
  for (let i = 0; i < total; i++) {
    if (minorIdx < minor.length && (i + 1) * minor.length >= (minorIdx + 1) * total) {
      out.push(minor[minorIdx++]!);
    } else {
      out.push(major[majorIdx++]!);
    }
  }
  return out;
}

export function interleaveRestaurants<T extends { isPlayerMade: boolean }>(
  list: readonly T[],
  seed: number,
): T[] {
  const system = list.filter((r) => !r.isPlayerMade);
  const player = list.filter((r) => r.isPlayerMade);
  return proportionalMerge(
    seededShuffle(system, seed),
    // 两组用不同的派生种子,避免共享同一随机序列
    seededShuffle(player, (seed ^ 0x9e3779b9) >>> 0),
  );
}
