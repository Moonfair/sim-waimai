# 商家评价管理（隐藏/恢复）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 商家可查看自己店铺的全部评价，并隐藏（软删除）/恢复任意一条，隐藏的评价不在店铺页公开展示且店铺评分同步回滚。

**Architecture:** `reviews` 表加可空 `hidden_at` 时间戳（NULL = 正常展示）。merchant.ts 新增两个路由：keyset 分页的评价列表（含隐藏）、PATCH 隐藏/恢复（事务内同步 `ratingSum/ratingCount/rating`，条件 UPDATE 保证幂等）。公开评价列表加 `hidden_at IS NULL` 过滤；顾客订单详情不过滤。前端新增 `/merchant/:id/reviews` 页面，MerchantEdit 加入口。

**Tech Stack:** Hono + drizzle-orm (PostgreSQL) + zod + vitest（server）；React + react-router + Tailwind（web）；npm workspaces（`server` 是 workspace，共享类型在 `shared/src/api.ts`，包名 `@sim-waimai/shared`）。

**Spec:** `docs/superpowers/specs/2026-07-16-merchant-review-management-design.md`

## Global Constraints

- 所有命令在仓库根目录 `/Users/moonfair/Projects/sim-waimai` 执行。
- server 测试需要本地 Postgres：先 `npm run db:up`，migration 用 `npm run db:migrate`。
- server 测试命令：`npm run test:server`（可加 `-- src/test/merchantReviews.test.ts` 只跑单文件）。
- 金额一律用「分」存储（本功能不涉及新金额字段）。
- 评分聚合规则（与建评价接口一致）：`rating = ROUND(ratingSum::numeric / ratingCount, 1)`；`ratingCount` 为 0 时 rating 回到默认 5。
- 注释用中文、只写代码本身表达不了的约束，风格对齐现有文件。
- 每个 commit message 结尾加：`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: reviews 表新增 hidden_at 列 + migration

**Files:**
- Modify: `server/src/db/schema.ts:158-181`（reviews 表定义）
- Create: `server/drizzle/0004_*.sql`（drizzle-kit 自动生成，勿手写）

**Interfaces:**
- Produces: `reviews.hiddenAt: Date | null`（`typeof reviews.$inferSelect` 里新增字段，后续任务用 `row.hiddenAt !== null` 判断隐藏态）

- [ ] **Step 1: schema 加列**

在 `server/src/db/schema.ts` 的 reviews 表中，`createdAt` 之前加一行：

```ts
    photos: jsonb('photos').$type<string[]>().notNull().default([]),
    /** 非 NULL = 被商家隐藏（软删除），不在店铺页公开展示；顾客本人订单里仍可见。 */
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
```

- [ ] **Step 2: 生成并应用 migration**

```bash
npm -w server run generate
npm run db:up && npm run db:migrate
```

预期：`server/drizzle/` 下新增 `0004_<随机名>.sql`，内容为
`ALTER TABLE "reviews" ADD COLUMN "hidden_at" timestamp with time zone;`；migrate 无报错。

- [ ] **Step 3: typecheck**

```bash
npm -w server run typecheck
```

预期：无错误。

- [ ] **Step 4: Commit**

```bash
git add server/src/db/schema.ts server/drizzle
git commit -m "feat(db): reviews 表新增 hidden_at 软删除字段"
```

---

### Task 2: MerchantReviewDto + 商家评价列表接口 + 公开列表过滤

**Files:**
- Modify: `shared/src/api.ts`（ReviewDto 定义之后，约 117 行）
- Modify: `server/src/lib/mappers.ts`（toReviewDto 之后）
- Modify: `server/src/routes/merchant.ts`（imports + 新路由）
- Modify: `server/src/routes/restaurants.ts:42`（公开评价列表过滤）
- Create: `server/src/test/merchantReviews.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `reviews.hiddenAt`；现有 `ownedRestaurant(user, id)`、`decodeCursor/encodeCursor`（`server/src/lib/cursor.ts`）、`toReviewDto(row, username)`。
- Produces:
  - `interface MerchantReviewDto extends ReviewDto { hidden: boolean }`（shared）
  - `toMerchantReviewDto(row: ReviewRow, username: string): MerchantReviewDto`（mappers）
  - `GET /api/merchant/restaurants/:id/reviews?limit&cursor` → `Page<MerchantReviewDto>`（含隐藏评价，按 created_at desc keyset 分页）

- [ ] **Step 1: 写失败的测试**

新建 `server/src/test/merchantReviews.test.ts`（setup 会被 Task 3 复用）：

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type {
  MerchantRestaurantDto,
  MerchantReviewDto,
  OrderDto,
  Page,
  ReviewDto,
} from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { menuItems, orders, restaurants, reviews, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const owner = { username: `t_mrv_o_${stamp}`, password: 'secret123' };
const customer = { username: `t_mrv_c_${stamp}`, password: 'secret123' };
const rando = { username: `t_mrv_r_${stamp}`, password: 'secret123' };
let ownerCookie = '';
let customerCookie = '';
let randoCookie = '';
let shopId = '';
let orderId = '';
let reviewId = '';
const RATING = 4;

async function register(cred: { username: string; password: string }) {
  const res = await registerTestUser(app, cred);
  return { cookie: (res.headers.get('set-cookie') ?? '').split(';')[0]! };
}

function req(path: string, cookie: string, init?: { method?: string; body?: unknown }) {
  return app.request(path, {
    method: init?.method ?? 'GET',
    headers: {
      Cookie: cookie,
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/** 商家视角读店铺聚合（rating/ratingCount 随隐藏/恢复变化）。 */
async function shopSummary() {
  const res = await req(`/api/merchant/restaurants/${shopId}`, ownerCookie);
  return (await res.json()) as MerchantRestaurantDto;
}

beforeAll(async () => {
  ownerCookie = (await register(owner)).cookie;
  customerCookie = (await register(customer)).cookie;
  randoCookie = (await register(rando)).cookie;

  // 店主开店 + 加菜；新内容默认待审核，直接在 DB 里批准（同 merchant.test.ts 的做法）
  const shopRes = await req('/api/merchant/restaurants', ownerCookie, {
    method: 'POST',
    body: {
      name: '评价测试小馆',
      category: '中式快餐',
      emoji: '🍜',
      bgColor: '#cc7733',
      deliveryFee: 0,
      minOrder: 0,
      deliveryTime: 30,
      tags: [],
      menuCategories: ['招牌'],
    },
  });
  shopId = ((await shopRes.json()) as MerchantRestaurantDto).id;
  const itemRes = await req(`/api/merchant/restaurants/${shopId}/items`, ownerCookie, {
    method: 'POST',
    body: { name: '招牌面', price: 20, emoji: '🍜', menuCategory: '招牌' },
  });
  const itemId = ((await itemRes.json()) as { id: string }).id;
  await db.update(restaurants).set({ reviewStatus: 'approved' }).where(eq(restaurants.id, shopId));
  await db.update(menuItems).set({ reviewStatus: 'approved' }).where(eq(menuItems.restaurantId, shopId));

  // 顾客下单 → 完成 → 评价（rating=4，店铺聚合变为 sum=4 count=1 rating=4）
  const orderRes = await req('/api/orders', customerCookie, {
    method: 'POST',
    body: {
      restaurantId: shopId,
      items: [{ menuItemId: itemId, quantity: 1 }],
      address: { recipientName: '', phone: '', address: '测试地址' },
    },
  });
  orderId = ((await orderRes.json()) as OrderDto).id;
  await req(`/api/orders/${orderId}/status`, customerCookie, { method: 'PATCH', body: { status: 'delivering' } });
  await req(`/api/orders/${orderId}/status`, customerCookie, { method: 'PATCH', body: { status: 'completed' } });
  const revRes = await req(`/api/orders/${orderId}/reviews`, customerCookie, {
    method: 'POST',
    body: { rating: RATING, content: '面很筋道，好评' },
  });
  reviewId = ((await revRes.json()) as ReviewDto).id;
});

afterAll(async () => {
  await db.delete(reviews).where(eq(reviews.restaurantId, shopId));
  await db.delete(orders).where(eq(orders.restaurantId, shopId));
  await db.delete(restaurants).where(eq(restaurants.id, shopId));
  await db.delete(users).where(eq(users.username, owner.username));
  await db.delete(users).where(eq(users.username, customer.username));
  await db.delete(users).where(eq(users.username, rando.username));
  await pool.end();
});

describe('merchant review list', () => {
  it('owner sees the review with hidden=false and username', async () => {
    const res = await req(`/api/merchant/restaurants/${shopId}/reviews`, ownerCookie);
    expect(res.status).toBe(200);
    const page = (await res.json()) as Page<MerchantReviewDto>;
    const mine = page.items.find((r) => r.id === reviewId);
    expect(mine).toBeDefined();
    expect(mine!.hidden).toBe(false);
    expect(mine!.username).toBe(customer.username);
  });

  it('non-owner gets 403', async () => {
    const res = await req(`/api/merchant/restaurants/${shopId}/reviews`, randoCookie);
    expect(res.status).toBe(403);
  });

  it('hidden review disappears from the public list but stays in the merchant list', async () => {
    await db.update(reviews).set({ hiddenAt: new Date() }).where(eq(reviews.id, reviewId));

    const pub = (await (await app.request(`/api/restaurants/${shopId}/reviews`)).json()) as Page<ReviewDto>;
    expect(pub.items.find((r) => r.id === reviewId)).toBeUndefined();

    const merchant = (await (
      await req(`/api/merchant/restaurants/${shopId}/reviews`, ownerCookie)
    ).json()) as Page<MerchantReviewDto>;
    expect(merchant.items.find((r) => r.id === reviewId)?.hidden).toBe(true);

    // 复原，避免影响后续用例（聚合未动过：这里是直接改 DB，不走接口）
    await db.update(reviews).set({ hiddenAt: null }).where(eq(reviews.id, reviewId));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm run db:up && npm run test:server -- src/test/merchantReviews.test.ts
```

预期：FAIL —— `owner sees the review` 断言 `res.status` 为 404（路由不存在）。

- [ ] **Step 3: shared 加 DTO**

`shared/src/api.ts`，紧跟 `ReviewDto` 定义之后加：

```ts
/** Merchant-view review: includes hidden (soft-deleted) state. */
export interface MerchantReviewDto extends ReviewDto {
  hidden: boolean;
}
```

- [ ] **Step 4: mappers 加转换函数**

`server/src/lib/mappers.ts`：import 类型列表加 `MerchantReviewDto`（来自 `@sim-waimai/shared`），在 `toReviewDto` 之后加：

```ts
export function toMerchantReviewDto(row: ReviewRow, username: string): MerchantReviewDto {
  return { ...toReviewDto(row, username), hidden: row.hiddenAt !== null };
}
```

- [ ] **Step 5: merchant.ts 加列表路由**

`server/src/routes/merchant.ts` 改 imports：

```ts
import { and, asc, desc, eq, sql } from 'drizzle-orm';           // 不变
import { menuItems, restaurants, reviews, users } from '../db/schema';  // 加 reviews, users
import { decodeCursor, encodeCursor } from '../lib/cursor';       // 新增
import {
  toMenuItem,
  toMerchantReviewDto,                                            // 新增
  toRestaurantSummary,
  type MenuItemRow,
  type RestaurantRow,
} from '../lib/mappers';
```

在 `.get('/restaurants/:id', ...)` 路由之后插入（分页逻辑对齐 `restaurants.ts` 的公开评价列表）：

```ts
  .get('/restaurants/:id/reviews', requireAuth, async (c) => {
    const owned = await ownedRestaurant(c.get('user'), c.req.param('id'));
    if ('error' in owned) return c.json({ error: owned.error }, owned.status);
    const limitRaw = Number(c.req.query('limit') ?? 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 10, 1), 50);

    const filters = [eq(reviews.restaurantId, owned.row.id)];
    const cursorParam = c.req.query('cursor');
    if (cursorParam) {
      const cursor = decodeCursor(cursorParam);
      if (!cursor) return c.json({ error: '无效的分页游标' }, 400);
      filters.push(
        sql`(${reviews.createdAt}, ${reviews.id}) < (${cursor.createdAt}, ${cursor.id}::uuid)`,
      );
    }

    const rows = await db
      .select({ review: reviews, username: users.username })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.userId))
      .where(and(...filters))
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return c.json({
      items: page.map((r) => toMerchantReviewDto(r.review, r.username)),
      nextCursor: hasMore && last ? encodeCursor(last.review.createdAt, last.review.id) : null,
    });
  })
```

- [ ] **Step 6: 公开列表过滤已隐藏**

`server/src/routes/restaurants.ts`：drizzle-orm import 加 `isNull`，`GET /:id/reviews` 里：

```ts
    const filters = [eq(reviews.restaurantId, id), isNull(reviews.hiddenAt)];
```

- [ ] **Step 7: 跑测试确认通过**

```bash
npm run test:server -- src/test/merchantReviews.test.ts
```

预期：PASS（3 个用例）。再跑一次全量防回归：

```bash
npm run test:server && npm -w server run typecheck
```

预期：全部 PASS、无类型错误。

- [ ] **Step 8: Commit**

```bash
git add shared/src/api.ts server/src/lib/mappers.ts server/src/routes/merchant.ts server/src/routes/restaurants.ts server/src/test/merchantReviews.test.ts
git commit -m "feat(api): 商家评价列表接口，公开列表过滤已隐藏评价"
```

---

### Task 3: PATCH 隐藏/恢复接口（评分回滚 + 幂等）

**Files:**
- Modify: `server/src/routes/merchant.ts`（Task 2 列表路由之后插入 PATCH 路由）
- Modify: `server/src/test/merchantReviews.test.ts`（追加 describe 块）

**Interfaces:**
- Consumes: Task 2 的 `toMerchantReviewDto`、测试 setup（`shopId/reviewId/RATING/shopSummary`）。
- Produces: `PATCH /api/merchant/restaurants/:id/reviews/:reviewId`，body `{ hidden: boolean }` → `MerchantReviewDto`。隐藏时 `ratingSum -= rating, ratingCount -= 1`，恢复时加回；count 归 0 时 rating 回 5；重复请求不重复调整聚合。

- [ ] **Step 1: 追加失败的测试**

在 `merchantReviews.test.ts` 末尾追加：

```ts
describe('merchant hides / restores a review', () => {
  it('hiding rolls back the aggregate (single review → count 0, rating back to 5)', async () => {
    const before = await shopSummary();
    expect(before.ratingCount).toBe(1);
    expect(before.rating).toBe(RATING);

    const res = await req(`/api/merchant/restaurants/${shopId}/reviews/${reviewId}`, ownerCookie, {
      method: 'PATCH',
      body: { hidden: true },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as MerchantReviewDto).hidden).toBe(true);

    const after = await shopSummary();
    expect(after.ratingCount).toBe(0);
    expect(after.rating).toBe(5);
    const [row] = await db.select().from(restaurants).where(eq(restaurants.id, shopId));
    expect(row!.ratingSum).toBe(0);
  });

  it('hiding again is a no-op (aggregate not double-subtracted)', async () => {
    const res = await req(`/api/merchant/restaurants/${shopId}/reviews/${reviewId}`, ownerCookie, {
      method: 'PATCH',
      body: { hidden: true },
    });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(restaurants).where(eq(restaurants.id, shopId));
    expect(row!.ratingSum).toBe(0);
    expect(row!.ratingCount).toBe(0);
  });

  it('customer still sees their own review on the order detail while hidden', async () => {
    const res = await req(`/api/orders/${orderId}`, customerCookie);
    const order = (await res.json()) as OrderDto;
    expect(order.review?.id).toBe(reviewId);
  });

  it('restoring adds the aggregate back', async () => {
    const res = await req(`/api/merchant/restaurants/${shopId}/reviews/${reviewId}`, ownerCookie, {
      method: 'PATCH',
      body: { hidden: false },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as MerchantReviewDto).hidden).toBe(false);

    const after = await shopSummary();
    expect(after.ratingCount).toBe(1);
    expect(after.rating).toBe(RATING);

    const pub = (await (await app.request(`/api/restaurants/${shopId}/reviews`)).json()) as Page<ReviewDto>;
    expect(pub.items.find((r) => r.id === reviewId)).toBeDefined();
  });

  it('restoring again is a no-op', async () => {
    const res = await req(`/api/merchant/restaurants/${shopId}/reviews/${reviewId}`, ownerCookie, {
      method: 'PATCH',
      body: { hidden: false },
    });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(restaurants).where(eq(restaurants.id, shopId));
    expect(row!.ratingSum).toBe(RATING);
    expect(row!.ratingCount).toBe(1);
  });

  it('non-owner gets 403, unknown review gets 404', async () => {
    const forbidden = await req(`/api/merchant/restaurants/${shopId}/reviews/${reviewId}`, randoCookie, {
      method: 'PATCH',
      body: { hidden: true },
    });
    expect(forbidden.status).toBe(403);

    const missing = await req(
      `/api/merchant/restaurants/${shopId}/reviews/00000000-0000-4000-8000-000000000000`,
      ownerCookie,
      { method: 'PATCH', body: { hidden: true } },
    );
    expect(missing.status).toBe(404);

    const badId = await req(`/api/merchant/restaurants/${shopId}/reviews/not-a-uuid`, ownerCookie, {
      method: 'PATCH',
      body: { hidden: true },
    });
    expect(badId.status).toBe(404);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm run test:server -- src/test/merchantReviews.test.ts
```

预期：Task 2 的用例 PASS，新 describe 全部 FAIL（PATCH 返回 404，路由不存在）。

- [ ] **Step 3: 实现 PATCH 路由**

`server/src/routes/merchant.ts`：

imports 再加两个：drizzle-orm 的 `isNull, isNotNull`；`../lib/validate` 改为 `import { UUID_RE, validateJson } from '../lib/validate';`。

schema 区（`itemPatchSchema` 之后）加：

```ts
const reviewHiddenSchema = z.object({ hidden: z.boolean() });
```

Task 2 的列表路由之后插入：

```ts
  .patch(
    '/restaurants/:id/reviews/:reviewId',
    requireAuth,
    validateJson(reviewHiddenSchema),
    async (c) => {
      const owned = await ownedRestaurant(c.get('user'), c.req.param('id'));
      if ('error' in owned) return c.json({ error: owned.error }, owned.status);
      const reviewId = c.req.param('reviewId');
      if (!UUID_RE.test(reviewId)) return c.json({ error: '评价不存在' }, 404);
      const [found] = await db
        .select({ review: reviews, username: users.username })
        .from(reviews)
        .innerJoin(users, eq(users.id, reviews.userId))
        .where(and(eq(reviews.id, reviewId), eq(reviews.restaurantId, owned.row.id)));
      if (!found) return c.json({ error: '评价不存在' }, 404);

      const { hidden } = c.req.valid('json');
      const updated = await db.transaction(async (tx) => {
        // 条件 UPDATE 保证幂等：已处于目标状态则命中 0 行、不动聚合，重复点击不会把评分扣两次
        const [row] = await tx
          .update(reviews)
          .set({ hiddenAt: hidden ? new Date() : null })
          .where(
            and(
              eq(reviews.id, reviewId),
              hidden ? isNull(reviews.hiddenAt) : isNotNull(reviews.hiddenAt),
            ),
          )
          .returning();
        if (!row) return null;
        const ratingDelta = hidden ? -found.review.rating : found.review.rating;
        const countDelta = hidden ? -1 : 1;
        await tx
          .update(restaurants)
          .set({
            ratingSum: sql`${restaurants.ratingSum} + ${ratingDelta}`,
            ratingCount: sql`${restaurants.ratingCount} + ${countDelta}`,
            // 全部评价被隐藏时评分回到默认 5（玩家店的初始值；种子店无 owner，不会走到这里）
            rating: sql`CASE WHEN ${restaurants.ratingCount} + ${countDelta} <= 0 THEN 5 ELSE ROUND((${restaurants.ratingSum} + ${ratingDelta})::numeric / (${restaurants.ratingCount} + ${countDelta}), 1) END`,
          })
          .where(eq(restaurants.id, owned.row.id));
        return row;
      });
      return c.json(toMerchantReviewDto(updated ?? found.review, found.username));
    },
  )
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npm run test:server -- src/test/merchantReviews.test.ts
```

预期：PASS（9 个用例）。再全量：

```bash
npm run test:server && npm -w server run typecheck
```

预期：全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/merchant.ts server/src/test/merchantReviews.test.ts
git commit -m "feat(api): 商家隐藏/恢复评价，事务内回滚店铺评分并保证幂等"
```

---

### Task 4: 前端评价管理页 + 路由 + 入口

**Files:**
- Create: `src/pages/MerchantReviews.tsx`
- Modify: `src/App.tsx`（import + 路由，46 行 `/merchant/:id` 之后）
- Modify: `src/pages/MerchantEdit.tsx:163-172`（头部快捷入口行）

**Interfaces:**
- Consumes: Task 2/3 的 `GET/PATCH /merchant/restaurants/:id/reviews*`、`MerchantReviewDto`；现有 `useApi`（`{ data, loading, error, reload }`）、`api.get/patch`、`assetUrl`。
- Produces: 路由 `/merchant/:id/reviews`（RequireAuth）。

- [ ] **Step 1: 新建页面**

`src/pages/MerchantReviews.tsx`（列表样式对齐 `ReviewList.tsx`，页面骨架对齐 `MerchantEdit.tsx`；「隐藏」用行内二次确认，避免弹窗）：

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { MerchantRestaurantDto, MerchantReviewDto, Page } from '@sim-waimai/shared';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';
import { assetUrl } from '../lib/assetUrl';

export default function MerchantReviews() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: shop, reload: reloadShop } = useApi<MerchantRestaurantDto>(
    id ? `/merchant/restaurants/${id}` : null,
  );
  const [items, setItems] = useState<MerchantReviewDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** 点了「隐藏」等待二次确认的评价 id */
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const loadPage = useCallback(
    async (cursor: string | null) => {
      const qs = cursor ? `?limit=10&cursor=${encodeURIComponent(cursor)}` : '?limit=10';
      const page = await api.get<Page<MerchantReviewDto>>(
        `/merchant/restaurants/${id}/reviews${qs}`,
      );
      setItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    },
    [id],
  );

  useEffect(() => {
    loadPage(null)
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [loadPage]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await loadPage(nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleToggleHidden = async (review: MerchantReviewDto, hidden: boolean) => {
    setBusyId(review.id);
    try {
      const updated = await api.patch<MerchantReviewDto>(
        `/merchant/restaurants/${id}/reviews/${review.id}`,
        { hidden },
      );
      setItems((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setConfirmId(null);
      reloadShop(); // 评分/条数以后端为准
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
      setTimeout(() => setError(null), 2500);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900 pb-10">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 px-4 pt-10 pb-4 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <button
            className="w-8 h-8 flex items-center justify-center text-gray-600 dark:text-gray-300"
            onClick={() => navigate(-1)}
          >
            ←
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg">评价管理</h1>
            {shop && (
              <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                {shop.emoji} {shop.name} · ⭐ {shop.rating}（{shop.ratingCount}条）
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 mt-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4">
          {error && (
            <div className="mb-3 bg-red-50 dark:bg-red-500/10 text-red-500 text-xs rounded-xl px-3 py-2">
              {error}
            </div>
          )}
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="bg-gray-50 dark:bg-gray-700 rounded-xl h-16 animate-pulse" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="text-gray-300 dark:text-gray-600 text-sm text-center py-6">
              还没有收到评价
            </p>
          ) : (
            <div className="space-y-4">
              {items.map((review) => (
                <div
                  key={review.id}
                  className={`border-b border-gray-50 dark:border-gray-700 pb-3 last:border-0 ${
                    review.hidden ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-gray-800 dark:text-gray-200 text-sm font-medium truncate">
                        {review.username}
                      </span>
                      {review.hidden && (
                        <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                          已隐藏
                        </span>
                      )}
                    </div>
                    <span className="text-gray-300 dark:text-gray-600 text-xs flex-shrink-0">
                      {new Date(review.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                  <div className="text-yellow-400 text-xs mt-0.5">
                    {'★'.repeat(review.rating)}
                    <span className="text-gray-200 dark:text-gray-600">{'★'.repeat(5 - review.rating)}</span>
                  </div>
                  {review.content && (
                    <p className="text-gray-600 dark:text-gray-300 text-sm mt-1">{review.content}</p>
                  )}
                  {review.photos.length > 0 && (
                    <div className="flex gap-2 mt-2 overflow-x-auto">
                      {review.photos.map((photo) => (
                        <img
                          key={photo}
                          src={assetUrl(photo)}
                          alt="评价图片"
                          className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                        />
                      ))}
                    </div>
                  )}
                  <div className="flex justify-end gap-3 mt-2">
                    {review.hidden ? (
                      <button
                        className="text-xs text-green-500 px-2 py-1 disabled:opacity-50"
                        disabled={busyId === review.id}
                        onClick={() => handleToggleHidden(review, false)}
                      >
                        {busyId === review.id ? '恢复中…' : '恢复展示'}
                      </button>
                    ) : confirmId === review.id ? (
                      <>
                        <button
                          className="text-xs text-gray-400 px-2 py-1"
                          onClick={() => setConfirmId(null)}
                        >
                          取消
                        </button>
                        <button
                          className="text-xs text-red-400 px-2 py-1 disabled:opacity-50"
                          disabled={busyId === review.id}
                          onClick={() => handleToggleHidden(review, true)}
                        >
                          {busyId === review.id ? '隐藏中…' : '确认隐藏'}
                        </button>
                      </>
                    ) : (
                      <button
                        className="text-xs text-red-400 px-2 py-1"
                        onClick={() => setConfirmId(review.id)}
                      >
                        隐藏
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {nextCursor && (
                <button
                  className="w-full py-2 text-sm text-gray-500 dark:text-gray-400"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? '加载中…' : '加载更多评价'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 注册路由**

`src/App.tsx`：import 区（`MerchantEdit` 之后）加

```tsx
import MerchantReviews from './pages/MerchantReviews';
```

路由区 `/merchant/:id` 一行之后加

```tsx
<Route path="/merchant/:id/reviews" element={<RequireAuth><MerchantReviews /></RequireAuth>} />
```

- [ ] **Step 3: MerchantEdit 加入口**

`src/pages/MerchantEdit.tsx` 头部快捷入口行（`查看顾客视角` 按钮之后、分享按钮之前）加：

```tsx
          <button className="text-xs text-orange-500" onClick={() => navigate(`/merchant/${shop.id}/reviews`)}>
            💬 评价管理
          </button>
```

- [ ] **Step 4: 构建 + lint 验证**

```bash
npm run build && npm run lint
```

预期：tsc 与 vite build 通过，oxlint 无新增报错。

- [ ] **Step 5: 端到端手动验证（可选但推荐）**

```bash
npm run dev
```

商家账号进入 店铺编辑 → 「💬 评价管理」：能看到评价列表；点「隐藏」→「确认隐藏」后该条置灰、头部评分/条数变化；顾客视角店铺页看不到该评价；点「恢复展示」后一切复原。

- [ ] **Step 6: Commit**

```bash
git add src/pages/MerchantReviews.tsx src/pages/MerchantEdit.tsx src/App.tsx
git commit -m "feat(web): 商家评价管理页，支持隐藏/恢复评价"
```
