# 首页推荐加权随机抽取 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `GET /api/recommendations` 从确定性的"优先级优先、评分次要"排序，改为加权随机抽样——高 `recommendPriority` 只放大被抽中的概率，不再保证绝对置顶。

**Architecture:** 新增一个不依赖 db/Hono 的纯函数 `weightedSample`（Efraimidis–Spirakis 加权无放回抽样算法），在 `recommendations.ts` 路由里用它替换现有的 `.sort().slice()`。权重 = `质量分 × 优先级倍率`，倍率固定为 `1 + recommendPriority/50`。

**Tech Stack:** TypeScript, Hono, Drizzle ORM, Vitest（现有 server 工作区约定不变）。

## Global Constraints

- 权重公式：`weight = Math.max(qualityScore, 0.01) * (1 + recommendPriority / 50)`，`qualityScore` 计算逻辑不变（`分类偏好*10 + rating + log10(monthlyOrders+1)`）。
- 抽样算法：`key = rng() ** (1 / Math.max(weight, 1e-6))`，按 `key` 降序取前 `LIMIT`（6）个。`rng` 默认 `Math.random`，必须可注入以便单测。
- 候选池：不预筛选，`isActive && approved` 的全部店铺都参与抽样。
- 统计测试 N 值：cold-start / personalized 用 N=100，priority 用 N=200；断言用"次数明显更多"而非精确置信区间。
- 不改动前端：`Home.tsx` 已经每次挂载都重新请求 `/recommendations`。

---

### Task 1: `weightedSample` 纯函数 + 单测

**Files:**
- Create: `server/src/lib/weightedSample.ts`
- Test: `server/src/test/weightedSample.test.ts`

**Interfaces:**
- Produces: `weightedSample<T>(items: T[], weight: (item: T) => number, k: number, rng?: () => number): T[]` — 供 Task 2 的 `recommendations.ts` 使用。

- [ ] **Step 1: 写失败测试**

创建 `server/src/test/weightedSample.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npm -w server exec vitest run src/test/weightedSample.test.ts`
Expected: FAIL — `Cannot find module '../lib/weightedSample'`（文件还不存在）。

- [ ] **Step 3: 写最小实现**

创建 `server/src/lib/weightedSample.ts`：

```ts
/**
 * Weighted random sampling without replacement (Efraimidis–Spirakis key method):
 * each item gets key = rng() ** (1/weight); the k items with the largest keys win.
 * Higher weight makes an item more likely to win, but never guarantees it.
 */
export function weightedSample<T>(
  items: T[],
  weight: (item: T) => number,
  k: number,
  rng: () => number = Math.random,
): T[] {
  return items
    .map((item) => ({ item, key: rng() ** (1 / Math.max(weight(item), 1e-6)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, k)
    .map(({ item }) => item);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm -w server exec vitest run src/test/weightedSample.test.ts`
Expected: PASS（7 个用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add server/src/lib/weightedSample.ts server/src/test/weightedSample.test.ts
git commit -m "feat(server): add weightedSample, a pure weighted-random-without-replacement helper"
```

---

### Task 2: 把 `recommendations.ts` 换成加权随机抽取

**Files:**
- Modify: `server/src/routes/recommendations.ts`

**Interfaces:**
- Consumes: `weightedSample<T>(items, weight, k, rng?)` from Task 1（`../lib/weightedSample`）。
- 不产生新的对外接口；`GET /recommendations` 响应形状不变（`RestaurantSummary[]`，长度仍为 `LIMIT`）。

当前文件（`server/src/routes/recommendations.ts`）第 42-52 行是：

```ts
  // cold start (anonymous or no history): quality only; otherwise taste dominates
  const scored = active
    .map((r) => ({
      row: r,
      score:
        (weights.get(r.category) ?? 0) * 10 +
        r.rating +
        Math.log10(r.monthlyOrders + 1),
    }))
    .sort((a, b) => b.row.recommendPriority - a.row.recommendPriority || b.score - a.score)
    .slice(0, LIMIT);

  return c.json(scored.map(({ row }) => toRestaurantSummary(row)));
});
```

- [ ] **Step 1: 替换排序逻辑为加权随机抽取**

把上面那段整体替换为：

```ts
  // cold start (anonymous or no history): quality only; otherwise taste dominates.
  // recommendPriority only tilts the odds (weightedSample below) — it never guarantees a slot.
  const qualityScore = (r: (typeof active)[number]) =>
    (weights.get(r.category) ?? 0) * 10 + r.rating + Math.log10(r.monthlyOrders + 1);

  const picked = weightedSample(
    active,
    (r) => Math.max(qualityScore(r), 0.01) * (1 + r.recommendPriority / 50),
    LIMIT,
  );

  return c.json(picked.map(toRestaurantSummary));
});
```

并在文件顶部的 import 区加一行：

```ts
import { weightedSample } from '../lib/weightedSample';
```

- [ ] **Step 2: typecheck**

Run: `npm -w server run typecheck`
Expected: 通过，无类型错误。

- [ ] **Step 3: 跑一次现有测试，确认旧的确定性断言按预期失败**

Run: `npm -w server exec vitest run src/test/recommendations.test.ts src/test/recommendationsPriority.test.ts`
Expected: FAIL — 这是预期的回归，因为这两个文件还在断言"结果完全确定"。Task 3、Task 4 会把它们改写成统计式断言。**不要在这一步尝试让它们变绿**，只需确认失败原因确实是顺序不再确定（而不是 500 报错之类的意外问题）。

- [ ] **Step 4: 提交**

```bash
git add server/src/routes/recommendations.ts
git commit -m "feat(server): recommendations route uses weighted random sampling instead of a hard sort"
```

（此时 CI/测试仍是红的，属于计划内的中间状态；Task 3-4 会修复。）

---

### Task 3: 重写 `recommendations.test.ts` 为统计式断言

**Files:**
- Modify: `server/src/test/recommendations.test.ts`（整体重写）

**Interfaces:**
- Consumes: `POST /api/merchant/restaurants`、`POST /api/admin/restaurants/:id/review`（已存在的路由，用法参照 `server/src/test/adminShops.test.ts` 里的 `req()` helper 和 `registerTestUser`）。

- [ ] **Step 1: 用整体重写替换文件内容**

把 `server/src/test/recommendations.test.ts` 整个替换为：

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { MerchantRestaurantDto, RestaurantSummary, UserDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { orders, restaurants, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

// Own file so the recommendations route's module-level 30s TTL cache starts fresh:
// the shops created below must be visible on the first /api/recommendations call this process makes.
const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_rec_a_${stamp}`, password: 'secret123' };
const owner = { username: `t_rec_o_${stamp}`, password: 'secret123' };
let ownerCookie = '';
let ownerId = '';
let historyOwnerId = '';
let cookie = '';
let highRatingId = '';
let lowRatingId = '';
let tasteShopId = '';
let savedAdmins: string | undefined;

async function register(cred: { username: string; password: string }) {
  const res = await registerTestUser(app, cred);
  return {
    cookie: (res.headers.get('set-cookie') ?? '').split(';')[0],
    user: (await res.json()) as UserDto,
  };
}

function req(path: string, cred: string, init?: { method?: string; body?: unknown }) {
  return app.request(path, {
    method: init?.method ?? 'GET',
    headers: {
      ...(cred ? { Cookie: cred } : {}),
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

async function createApprovedShop(name: string, category: string, ownerCred: string, adminCred: string) {
  const res = await req('/api/merchant/restaurants', ownerCred, {
    method: 'POST',
    body: {
      name,
      category,
      emoji: '🍱',
      bgColor: '#336699',
      deliveryFee: 3,
      minOrder: 15,
      deliveryTime: 30,
      tags: ['测试'],
      menuCategories: ['招牌'],
    },
  });
  expect(res.status).toBe(200);
  const shop = (await res.json()) as MerchantRestaurantDto;
  const approve = await req(`/api/admin/restaurants/${shop.id}/review`, adminCred, {
    method: 'POST',
    body: { decision: 'approved' },
  });
  expect(approve.status).toBe(200);
  return shop.id;
}

/** Runs GET /api/recommendations `n` times and counts how often each given id shows up. */
async function sampleInclusionCounts(ids: string[], headers?: HeadersInit): Promise<Map<string, number>> {
  const counts = new Map(ids.map((id) => [id, 0]));
  for (let i = 0; i < 100; i++) {
    const res = await app.request('/api/recommendations', headers ? { headers } : undefined);
    const items = (await res.json()) as RestaurantSummary[];
    const present = new Set(items.map((it) => it.id));
    for (const id of ids) {
      if (present.has(id)) counts.set(id, counts.get(id)! + 1);
    }
  }
  return counts;
}

beforeAll(async () => {
  savedAdmins = process.env.ADMIN_USERNAMES;
  process.env.ADMIN_USERNAMES = [savedAdmins, admin.username].filter(Boolean).join(',');
  const a = await register(admin);
  const o = await register(owner);
  ownerCookie = o.cookie;
  ownerId = o.user.id;

  const h = await register({ username: `t_rec_h_${stamp}`, password: 'secret123' });
  cookie = h.cookie;
  historyOwnerId = h.user.id;

  // Two shops with equal monthlyOrders (0) and forced ratings 5 vs 1: cold-start weight is rating-only,
  // so this isolates "does quality tilt the odds" from priority/taste effects.
  highRatingId = await createApprovedShop(`高分店_${stamp}`, '中式快餐', ownerCookie, a.cookie);
  lowRatingId = await createApprovedShop(`低分店_${stamp}`, '中式快餐', ownerCookie, a.cookie);
  await db.update(restaurants).set({ rating: 5 }).where(eq(restaurants.id, highRatingId));
  await db.update(restaurants).set({ rating: 1 }).where(eq(restaurants.id, lowRatingId));

  // A mediocre 汉堡炸鸡 shop that needs the personalization boost to compete.
  tasteShopId = await createApprovedShop(`口味店_${stamp}`, '汉堡炸鸡', ownerCookie, a.cookie);
  await db.update(restaurants).set({ rating: 3 }).where(eq(restaurants.id, tasteShopId));

  // history heavily biased to 汉堡炸鸡
  await db.insert(orders).values(
    Array.from({ length: 5 }, (_, i) => ({
      userId: historyOwnerId,
      restaurantId: 'kfc',
      restaurantSnapshot: { name: '开封菜', emoji: '🍔', bgColor: '#e4002b' },
      status: 'completed' as const,
      items: [
        { key: `k${i}`, menuItemId: 'x', name: '汉堡', emoji: '🍔', quantity: 1, unitPrice: 20, calories: 500, lineTotal: 20 },
      ],
      subtotalFen: 2000,
      deliveryFeeFen: 500,
      totalFen: 2500,
      totalCalories: 500,
      addressSnapshot: { recipientName: '', phone: '', address: 'x' },
    })),
  );
});

afterAll(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = savedAdmins;
  await db.delete(orders).where(eq(orders.userId, historyOwnerId));
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId));
  await db.delete(users).where(inArray(users.username, [admin.username, owner.username, `t_rec_h_${stamp}`]));
  await pool.end();
});

describe('GET /api/recommendations', () => {
  it('cold start: higher-rated shop gets selected more often than a lower-rated one', async () => {
    const counts = await sampleInclusionCounts([highRatingId, lowRatingId]);
    expect(counts.get(highRatingId)!).toBeGreaterThan(counts.get(lowRatingId)!);
  });

  it('personalized: burger-heavy history makes the 汉堡炸鸡 shop show up more often than anonymous', async () => {
    const anonymous = await sampleInclusionCounts([tasteShopId]);
    const personalized = await sampleInclusionCounts([tasteShopId], { Cookie: cookie });
    expect(personalized.get(tasteShopId)!).toBeGreaterThan(anonymous.get(tasteShopId)!);
  });

  it('response shape: always 6 unique, valid restaurant ids', async () => {
    const res = await app.request('/api/recommendations');
    expect(res.status).toBe(200);
    const items = (await res.json()) as RestaurantSummary[];
    expect(items).toHaveLength(6);
    expect(new Set(items.map((it) => it.id)).size).toBe(6);
  });
});
```

- [ ] **Step 2: 运行确认通过**

Run: `npm -w server exec vitest run src/test/recommendations.test.ts`
Expected: PASS（3 个用例全绿）。如果 `cold start` 或 `personalized` 用例偶发失败，先重跑一次确认不是真回归——如果稳定失败，说明 Task 2 的权重公式或 `qualityScore` 计算有 bug，回去检查，不要放大 N 掩盖问题。

- [ ] **Step 3: 提交**

```bash
git add server/src/test/recommendations.test.ts
git commit -m "test(server): rewrite recommendations tests as statistical assertions for weighted sampling"
```

---

### Task 4: 重写 `recommendationsPriority.test.ts` 为统计式断言

**Files:**
- Modify: `server/src/test/recommendationsPriority.test.ts`（整体重写）

**Interfaces:**
- Consumes: `POST /api/admin/shops/:id/priority`（已存在，见 `server/src/routes/adminShops.ts`）。

- [ ] **Step 1: 用整体重写替换文件内容**

把 `server/src/test/recommendationsPriority.test.ts` 整个替换为：

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { MerchantRestaurantDto, RestaurantSummary, UserDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { restaurants, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

// Own file so the recommendations route's module-level 30s TTL cache starts fresh:
// the shops below must be visible on the first /api/recommendations call this process makes.
const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_recp_a_${stamp}`, password: 'secret123' };
const owner = { username: `t_recp_o_${stamp}`, password: 'secret123' };
let ownerId = '';
let boostedId = '';
let baselineId = '';
let savedAdmins: string | undefined;

async function register(cred: { username: string; password: string }) {
  const res = await registerTestUser(app, cred);
  return {
    cookie: (res.headers.get('set-cookie') ?? '').split(';')[0],
    user: (await res.json()) as UserDto,
  };
}

function req(path: string, cookie: string, init?: { method?: string; body?: unknown }) {
  return app.request(path, {
    method: init?.method ?? 'GET',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

async function createApprovedShop(name: string, ownerCookie: string, adminCookie: string) {
  const res = await req('/api/merchant/restaurants', ownerCookie, {
    method: 'POST',
    body: {
      name,
      category: '中式快餐',
      emoji: '🍱',
      bgColor: '#336699',
      deliveryFee: 3,
      minOrder: 15,
      deliveryTime: 30,
      tags: ['测试'],
      menuCategories: ['招牌'],
    },
  });
  expect(res.status).toBe(200);
  const shop = (await res.json()) as MerchantRestaurantDto;
  const approve = await req(`/api/admin/restaurants/${shop.id}/review`, adminCookie, {
    method: 'POST',
    body: { decision: 'approved' },
  });
  expect(approve.status).toBe(200);
  return shop.id;
}

beforeAll(async () => {
  savedAdmins = process.env.ADMIN_USERNAMES;
  process.env.ADMIN_USERNAMES = [savedAdmins, admin.username].filter(Boolean).join(',');
  const a = await register(admin);
  const o = await register(owner);
  ownerId = o.user.id;

  // Two otherwise-identical shops (same defaults: rating 5, monthlyOrders 0) so the only
  // difference in weight comes from recommendPriority, isolating the priority effect.
  boostedId = await createApprovedShop(`置顶店_${stamp}`, o.cookie, a.cookie);
  baselineId = await createApprovedShop(`普通店_${stamp}`, o.cookie, a.cookie);

  const priorityRes = await req(`/api/admin/shops/${boostedId}/priority`, a.cookie, {
    method: 'POST',
    body: { priority: 100 },
  });
  expect(priorityRes.status).toBe(200);
});

afterAll(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = savedAdmins;
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId));
  await db.delete(users).where(inArray(users.username, [admin.username, owner.username]));
  await pool.end();
});

describe('GET /api/recommendations honors admin-set recommendPriority as a weight, not a hard sort', () => {
  it('a boosted shop is selected into the top 6 more often than an identical unboosted one', async () => {
    let boostedCount = 0;
    let baselineCount = 0;
    let boostedAlwaysFirst = true;

    for (let i = 0; i < 200; i++) {
      const res = await app.request('/api/recommendations');
      const items = (await res.json()) as RestaurantSummary[];
      const ids = items.map((it) => it.id);
      if (ids.includes(boostedId)) boostedCount++;
      if (ids.includes(baselineId)) baselineCount++;
      if (items[0]?.id !== boostedId) boostedAlwaysFirst = false;
    }

    expect(boostedCount).toBeGreaterThan(baselineCount);
    // Priority tilts the odds; it must not be a disguised hard sort that always wins position 1.
    expect(boostedAlwaysFirst).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认通过**

Run: `npm -w server exec vitest run src/test/recommendationsPriority.test.ts`
Expected: PASS。如果 `boostedAlwaysFirst` 断言失败（即 200 次全部排第一），先重跑一次；如果稳定复现，说明权重公式/抽样实现退化成了硬排序，回去检查 Task 1/2，不要删掉这个断言。

- [ ] **Step 3: 提交**

```bash
git add server/src/test/recommendationsPriority.test.ts
git commit -m "test(server): rewrite recommendationsPriority test to assert weighted odds, not a guaranteed rank"
```

---

### Task 5: 全量验证

**Files:** 无新文件；只跑既有的验证命令。

- [ ] **Step 1: server 完整测试套件**

Run: `npm -w server run test`
Expected: 全部通过（包括 Task 1-4 新增/重写的文件，以及其余未改动的既有测试）。

- [ ] **Step 2: server typecheck**

Run: `npm -w server run typecheck`
Expected: 无错误。

- [ ] **Step 3: 根目录 lint + build**

Run: `npm run lint && npm run build`
Expected: lint 无新增错误（现有 4 条 `only-export-components` 警告是历史遗留，无需处理）；build 成功。

- [ ] **Step 4: 提交（如果前面步骤有任何遗留改动)**

若 Step 1-3 未产生新的文件改动，跳过本步——Task 1-4 的提交已经覆盖全部改动。

---

## Self-Review Notes

- **Spec coverage**：核心算法（Task 1）、路由改动（Task 2）、三类测试改写（Task 3、4 覆盖 cold-start/personalized/priority）、验证步骤（Task 5）均对应 spec 里的对应章节，无遗漏。
- **Placeholder scan**：所有代码块均为完整可运行代码，无 TBD/TODO。
- **Type consistency**：`weightedSample<T>(items, weight, k, rng?)` 的签名在 Task 1 定义、Task 2 消费，参数顺序和类型一致；测试文件里的 `req()`/`register()`/`createApprovedShop()` helper 与仓库里 `adminShops.test.ts` 已有写法保持一致。
