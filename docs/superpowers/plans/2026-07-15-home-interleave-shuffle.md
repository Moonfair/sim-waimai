# 首页商家穿插随机排列 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首页"附近餐厅"列表将玩家自制商家与系统商家均匀穿插,每次打开/刷新页面随机打散一次,会话内顺序稳定。

**Architecture:** 后端在 `toRestaurantSummary` 增加 `isPlayerMade`(`ownerId !== null`),所有 DTO 经此函数派生,自动继承。前端新增纯函数模块 `src/lib/homeShuffle.ts`(mulberry32 + Fisher–Yates 洗牌、Bresenham 式按比例穿插),种子为模块级常量(JS 重新加载即换),`Home.tsx` 在分类筛选前套用。

**Tech Stack:** TypeScript、Hono + Drizzle(server)、React 19(web)、vitest(server 已有;web 需在根 workspace 新增)。

## Global Constraints

- npm workspaces:根(web)、`shared`、`server`;`@sim-waimai/shared` 直接导出 `./src/index.ts`,类型改动无需构建。
- 服务端测试是集成测试,需要本地 DB 已启动、已迁移、已种子:`npm run db:up && npm run db:migrate && npm run db:seed`(已有环境通常已就绪)。
- 提交信息风格:`feat(scope): 中文描述`,结尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 设计规格:`docs/superpowers/specs/2026-07-15-home-interleave-shuffle-design.md`。

---

### Task 1: 后端 `RestaurantSummary.isPlayerMade`

**Files:**
- Modify: `shared/src/api.ts:24-43`(`RestaurantSummary` 接口)
- Modify: `server/src/lib/mappers.ts:18-36`(`toRestaurantSummary`)
- Test: `server/src/test/restaurants.test.ts`

**Interfaces:**
- Consumes: 现有 `restaurants.ownerId`(uuid | null,种子商家为 null)。
- Produces: `RestaurantSummary.isPlayerMade: boolean`(必填)。列表、详情、商家端、收藏等所有经 `toRestaurantSummary` 派生的响应自动携带。Task 2/3 依赖此字段名。

- [ ] **Step 1: 写失败测试**

在 `server/src/test/restaurants.test.ts` 的 `describe('GET /api/restaurants', ...)` 中:

给已有的 `it('returns the 14 seeded restaurants without menus', ...)` 增加一行断言(加在 `expect(kfc).not.toHaveProperty('menu');` 之后):

```ts
    expect(kfc!.isPlayerMade).toBe(false);
```

在同一个 describe 末尾新增一个测试(复用文件里已有的 `registerAndCreatePendingShop`、`db`、`restaurants`、`users`、`eq` 导入):

```ts
  it('marks player-made shops with isPlayerMade=true once approved', async () => {
    const { userId, shop } = await registerAndCreatePendingShop(`t_interleave_${stamp}`);
    try {
      await db
        .update(restaurants)
        .set({ reviewStatus: 'approved' })
        .where(eq(restaurants.id, shop.id));

      const { body } = await getJson<RestaurantSummary[]>('/api/restaurants');
      const mine = body.find((r) => r.id === shop.id);
      expect(mine).toBeDefined();
      expect(mine!.isPlayerMade).toBe(true);
    } finally {
      await db.delete(restaurants).where(eq(restaurants.id, shop.id));
      await db.delete(users).where(eq(users.id, userId));
    }
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm -w server run test -- src/test/restaurants.test.ts`
Expected: FAIL —— TypeScript 报 `isPlayerMade` 不在 `RestaurantSummary` 上,或运行时 `expected undefined to be false`。

- [ ] **Step 3: 最小实现**

`shared/src/api.ts` — 在 `RestaurantSummary` 的 `tags: string[];` 之后加:

```ts
  /** 玩家自制商家(ownerId 非空);系统种子商家为 false。 */
  isPlayerMade: boolean;
```

`server/src/lib/mappers.ts` — `toRestaurantSummary` 的对象字面量中,`tags: row.tags,` 之后加:

```ts
    isPlayerMade: row.ownerId !== null,
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm -w server run test -- src/test/restaurants.test.ts`
Expected: PASS(全部用例)

- [ ] **Step 5: 跑全部服务端测试防回归**

Run: `npm run test:server`
Expected: PASS(`moderation`/`merchant`/`favorites` 等使用 summary 派生 DTO 的测试不受影响)

- [ ] **Step 6: Commit**

```bash
git add shared/src/api.ts server/src/lib/mappers.ts server/src/test/restaurants.test.ts
git commit -m "feat(api): RestaurantSummary 增加 isPlayerMade 字段

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 前端 `homeShuffle` 纯函数模块(含 web 侧 vitest 基建)

**Files:**
- Modify: `package.json`(根 —— 新增 vitest devDependency 与 `test:web` 脚本)
- Create: `src/lib/homeShuffle.ts`
- Test: `src/lib/homeShuffle.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `isPlayerMade: boolean`(以泛型约束 `T extends { isPlayerMade: boolean }` 解耦,不直接依赖 shared)。
- Produces:
  - `HOME_SHUFFLE_SEED: number` — 模块加载时生成一次的随机种子。
  - `seededShuffle<T>(arr: readonly T[], seed: number): T[]` — 确定性洗牌,不修改入参。
  - `interleaveRestaurants<T extends { isPlayerMade: boolean }>(list: readonly T[], seed: number): T[]` — Task 3 在 `Home.tsx` 中调用。

- [ ] **Step 1: 安装 vitest 并加脚本**

```bash
npm install -D vitest
```

根 `package.json` 的 `scripts` 中新增(放在 `test:server` 旁):

```json
    "test:web": "vitest run --dir src",
```

- [ ] **Step 2: 写失败测试**

创建 `src/lib/homeShuffle.test.ts`:

```ts
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
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm run test:web`
Expected: FAIL —— `Cannot find module './homeShuffle'`(或等价的解析错误)

- [ ] **Step 4: 实现 `src/lib/homeShuffle.ts`**

```ts
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
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm run test:web`
Expected: PASS(8 个用例全绿)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/homeShuffle.ts src/lib/homeShuffle.test.ts
git commit -m "feat(web): homeShuffle 洗牌与均匀穿插纯函数 + web 侧 vitest

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `Home.tsx` 接入穿插排序

**Files:**
- Modify: `src/pages/Home.tsx:1,26-28`

**Interfaces:**
- Consumes: Task 2 的 `interleaveRestaurants`、`HOME_SHUFFLE_SEED`;Task 1 的 `isPlayerMade`(经 `RestaurantSummary` 类型)。
- Produces: 无新接口 —— 仅首页"附近餐厅"网格的展示顺序变化。"为你推荐"横滑栏、收藏页不受影响。

- [ ] **Step 1: 修改 `Home.tsx`**

第 1 行导入 `useMemo`:

```ts
import { useMemo, useState } from 'react';
```

新增导入(与其他 `../lib` 导入放一起):

```ts
import { HOME_SHUFFLE_SEED, interleaveRestaurants } from '../lib/homeShuffle';
```

把现有的:

```ts
  const filtered = (restaurants ?? []).filter(
    r => activeCategory === '全部' || r.category === activeCategory
  );
```

改为:

```ts
  const shuffled = useMemo(
    () => interleaveRestaurants(restaurants ?? [], HOME_SHUFFLE_SEED),
    [restaurants]
  );
  const filtered = shuffled.filter(
    r => activeCategory === '全部' || r.category === activeCategory
  );
```

- [ ] **Step 2: 类型与 lint 检查**

Run: `npm run build && npm run lint`
Expected: 两者均无错误(`tsc -b` 会同时校验 shared/server 类型引用)

- [ ] **Step 3: 真机验证**

启动 `npm run dev`,浏览器打开首页,确认:
1. 玩家自制商家不再沉底,均匀混在系统商家中;
2. 点进一家餐厅再返回首页,顺序不变;
3. 刷新页面后顺序变化;
4. 切换分类 tab,再切回"全部",相对顺序稳定。

- [ ] **Step 4: Commit**

```bash
git add src/pages/Home.tsx
git commit -m "feat(web): 首页商家玩家店与系统店穿插随机排列

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
