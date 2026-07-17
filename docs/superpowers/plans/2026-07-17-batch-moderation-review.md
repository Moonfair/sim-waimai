# 审批列表批量审批 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 审核管理页「待审核」Tab 支持勾选多条后批量通过/批量驳回，后端新增一个批量审批接口。

**Architecture:** 后端把 `server/src/routes/admin.ts` 现有三个单条审批 handler 的核心更新逻辑抽成 `applyRestaurantDecision` / `applyMenuItemDecision` / `applyUserReviewDecision` 三个函数，新增 `POST /admin/moderation/review` 逐条独立调用它们（非整体原子），返回 `{ succeeded, failed[] }`。前端 `src/pages/AdminReview.tsx` 在 pending Tab 加 checkbox + 全选 + 底部固定批量操作栏。

**Tech Stack:** Hono + drizzle + zod（server）、vitest 集成测试（需本地 Postgres）、React + Tailwind（web）、npm workspaces（shared 类型包 `@sim-waimai/shared`）。

**Spec:** `docs/superpowers/specs/2026-07-17-batch-moderation-review-design.md`

## Global Constraints

- 所有用户可见文案为中文；错误消息与现有单条接口一致：`店铺不存在` / `菜品不存在` / `评价不存在` / `驳回必须填写原因`。
- 批量 targets 数量 1~50；reason 最长 200，`rejected` 时必填（trim 后非空）。
- 评价审批必须保留现有事务 + `FOR UPDATE` 行锁 + 旧→新状态转移调用 `applyRatingDelta` 的聚合逻辑，含「hiddenAt 非空不计入聚合」规则。
- server 测试是打真实 Postgres 的集成测试：运行前确保 `npm run db:up` 的数据库可用（已迁移、已 seed，`kfc` 等种子数据存在）。
- 不修改单条审批接口的对外行为（路径、请求/响应、状态码）。

---

### Task 1: shared 批量审批类型

**Files:**
- Modify: `shared/src/api.ts`（在 `ModerationItemDto` 定义之后、`ModerationReviewMeta` 之前，约 192 行处插入）

**Interfaces:**
- Produces: `ModerationTargetDto`（三种目标的判别联合）、`BatchReviewRequestDto`、`BatchReviewResultDto` — Task 3 的服务端和 Task 4 的前端都 import 这三个类型。

- [ ] **Step 1: 添加类型**

在 `shared/src/api.ts` 中 `ModerationItemDto` 接口的右花括号之后插入：

```ts
/** One target of a batch moderation decision (POST /admin/moderation/review). */
export type ModerationTargetDto =
  | { targetType: 'restaurant'; restaurantId: string }
  | { targetType: 'menuItem'; restaurantId: string; itemId: string }
  | { targetType: 'review'; reviewId: string };

/** Request body of POST /admin/moderation/review. */
export interface BatchReviewRequestDto {
  /** 1~50 条。 */
  targets: ModerationTargetDto[];
  decision: 'approved' | 'rejected';
  /** rejected 时必填，统一应用到所有目标。 */
  reason?: string;
}

/** Result of a batch moderation decision; 逐条独立处理，失败按条返回。 */
export interface BatchReviewResultDto {
  succeeded: number;
  failed: { target: ModerationTargetDto; error: string }[];
}
```

- [ ] **Step 2: 类型检查通过**

Run: `npx tsc -b`
Expected: 无输出（exit 0）

- [ ] **Step 3: Commit**

```bash
git add shared/src/api.ts
git commit -m "feat(shared): 批量审批请求/结果 DTO"
```

---

### Task 2: server 重构——抽取三个审批核心函数（行为不变）

**Files:**
- Modify: `server/src/routes/admin.ts`

**Interfaces:**
- Produces（Task 3 依赖，签名必须一致）:
  - `type ReviewDecision = { decision: 'approved' | 'rejected'; reason?: string }`
  - `applyRestaurantDecision(restaurantId: string, body: ReviewDecision, adminUsername: string): Promise<RestaurantRow | null>`
  - `applyMenuItemDecision(restaurantId: string, itemId: string, body: ReviewDecision, adminUsername: string): Promise<MenuItemRow | null>`
  - `applyUserReviewDecision(reviewId: string, body: ReviewDecision, adminUsername: string): Promise<UserReviewRow | null>`
  - 三者目标不存在（含 reviewId 非 UUID）都返回 `null`，不抛错。模块内私有函数，无需 export。

- [ ] **Step 1: 添加核心函数**

在 `admin.ts` 的 `toUserReviewModerationItem` 函数之后、`export const adminRoutes` 之前插入：

```ts
type ReviewDecision = { decision: 'approved' | 'rejected'; reason?: string };

/** 审批裁决写入的公共字段。 */
function decisionFields(body: ReviewDecision, adminUsername: string) {
  return {
    reviewStatus: body.decision,
    rejectReason: body.decision === 'rejected' ? body.reason!.trim() : null,
    reviewedAt: new Date(),
    reviewedBy: adminUsername,
  };
}

/** 店铺审批核心。不加 WHERE pending：管理员可覆盖任何状态（含推翻 AI 结论）。目标不存在返回 null。 */
async function applyRestaurantDecision(
  restaurantId: string,
  body: ReviewDecision,
  adminUsername: string,
): Promise<RestaurantRow | null> {
  const [row] = await db
    .update(restaurants)
    .set(decisionFields(body, adminUsername))
    .where(eq(restaurants.id, restaurantId))
    .returning();
  return row ?? null;
}

/** 菜品审批核心。目标不存在返回 null。 */
async function applyMenuItemDecision(
  restaurantId: string,
  itemId: string,
  body: ReviewDecision,
  adminUsername: string,
): Promise<MenuItemRow | null> {
  const [row] = await db
    .update(menuItems)
    .set(decisionFields(body, adminUsername))
    .where(and(eq(menuItems.restaurantId, restaurantId), eq(menuItems.id, itemId)))
    .returning();
  return row ?? null;
}

/**
 * 用户评价审批核心。FOR UPDATE 锁行取旧状态：与在途的 AI 审核（WHERE pending）串行化，
 * 聚合按旧→新状态转移（只有 approved 计入店铺评分）。目标不存在返回 null。
 */
async function applyUserReviewDecision(
  reviewId: string,
  body: ReviewDecision,
  adminUsername: string,
): Promise<UserReviewRow | null> {
  if (!UUID_RE.test(reviewId)) return null;
  return await db.transaction(async (tx) => {
    const [old] = await tx.select().from(reviews).where(eq(reviews.id, reviewId)).for('update');
    if (!old) return null;
    const [updated] = await tx
      .update(reviews)
      .set(decisionFields(body, adminUsername))
      .where(eq(reviews.id, reviewId))
      .returning();
    // 被商家隐藏的评价不计入聚合：隐藏那一刻商家侧已回滚，裁决翻转时不能再动聚合
    const wasCounted = old.reviewStatus === 'approved' && old.hiddenAt === null;
    const nowCounted = body.decision === 'approved' && old.hiddenAt === null;
    if (!wasCounted && nowCounted) await applyRatingDelta(tx, old.restaurantId, old.rating, 1);
    else if (wasCounted && !nowCounted) await applyRatingDelta(tx, old.restaurantId, -old.rating, -1);
    return updated ?? null;
  });
}
```

- [ ] **Step 2: 三个单条 handler 改为调用核心函数**

`POST /reviews/:reviewId/review` handler 整体替换为：

```ts
.post('/reviews/:reviewId/review', requireAdmin, validateJson(reviewSchema), async (c) => {
  const row = await applyUserReviewDecision(
    c.req.param('reviewId'),
    c.req.valid('json'),
    c.get('user').username,
  );
  if (!row) return c.json({ error: '评价不存在' }, 404);
  const [meta] = await db
    .select({ restaurantName: restaurants.name, authorUsername: users.username })
    .from(reviews)
    .innerJoin(restaurants, eq(restaurants.id, reviews.restaurantId))
    .innerJoin(users, eq(users.id, reviews.userId))
    .where(eq(reviews.id, row.id));
  return c.json(toUserReviewModerationItem(row, meta?.restaurantName ?? '', meta?.authorUsername ?? null));
})
```

`POST /restaurants/:id/review` handler 整体替换为：

```ts
.post('/restaurants/:id/review', requireAdmin, validateJson(reviewSchema), async (c) => {
  const row = await applyRestaurantDecision(
    c.req.param('id'),
    c.req.valid('json'),
    c.get('user').username,
  );
  if (!row) return c.json({ error: '店铺不存在' }, 404);
  return c.json(toRestaurantModerationItem(row, await lookupOwnerUsername(row.ownerId)));
})
```

`POST /restaurants/:id/items/:itemId/review` handler 整体替换为：

```ts
.post('/restaurants/:id/items/:itemId/review', requireAdmin, validateJson(reviewSchema), async (c) => {
  const row = await applyMenuItemDecision(
    c.req.param('id'),
    c.req.param('itemId'),
    c.req.valid('json'),
    c.get('user').username,
  );
  if (!row) return c.json({ error: '菜品不存在' }, 404);
  const [shop] = await db
    .select({ name: restaurants.name, ownerId: restaurants.ownerId })
    .from(restaurants)
    .where(eq(restaurants.id, row.restaurantId));
  return c.json(
    toItemModerationItem(row, shop?.name ?? '', await lookupOwnerUsername(shop?.ownerId ?? null)),
  );
})
```

注意：原单条 handler 中的注释（FOR UPDATE 说明、「不加 WHERE pending」说明）已随核心函数迁移，替换后不要在 handler 里保留重复注释。

- [ ] **Step 3: 回归现有测试（重构不改行为）**

Run: `npm -w server run test -- moderation reviews merchantReviews`
Expected: 全部 PASS（moderation.test.ts、moderationProvider.test.ts、reviews.test.ts、merchantReviews.test.ts、usernameModeration.test.ts 等被匹配到的文件全绿）

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/admin.ts
git commit -m "refactor(api): 抽取店铺/菜品/评价审批核心函数供批量接口复用"
```

---

### Task 3: server 批量审批接口（TDD）

**Files:**
- Create: `server/src/test/moderationBatch.test.ts`
- Modify: `server/src/routes/admin.ts`

**Interfaces:**
- Consumes: Task 1 的 `BatchReviewResultDto`；Task 2 的 `applyRestaurantDecision` / `applyMenuItemDecision` / `applyUserReviewDecision`。
- Produces: `POST /api/admin/moderation/review`（requireAdmin），请求体 `BatchReviewRequestDto`，响应 `BatchReviewResultDto` — Task 4 前端调用。

- [ ] **Step 1: 写失败测试**

创建 `server/src/test/moderationBatch.test.ts`：

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type {
  BatchReviewResultDto,
  MerchantMenuItemDto,
  MerchantRestaurantDto,
  OrderDto,
  ReviewDto,
  UserDto,
} from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { menuItems, orders, restaurants, reviews, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_bat_a_${stamp}`, password: 'secret123' };
const owner = { username: `t_bat_o_${stamp}`, password: 'secret123' };
const customer = { username: `t_bat_c_${stamp}`, password: 'secret123' };
let adminCookie = '';
let ownerCookie = '';
let customerCookie = '';
let ownerId = '';
let customerId = '';

let savedAdmins: string | undefined;
let savedSecretId: string | undefined;
let savedSecretKey: string | undefined;

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

async function createShop(name: string): Promise<MerchantRestaurantDto> {
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
  return (await res.json()) as MerchantRestaurantDto;
}

async function createItem(shopId: string, name: string): Promise<MerchantMenuItemDto> {
  const res = await req(`/api/merchant/restaurants/${shopId}/items`, ownerCookie, {
    method: 'POST',
    body: { name, price: 18, emoji: '🍜', menuCategory: '招牌' },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as MerchantMenuItemDto;
}

function batchReview(body: unknown, cookie = adminCookie) {
  return req('/api/admin/moderation/review', cookie, { method: 'POST', body });
}

function approveShop(shopId: string) {
  return req(`/api/admin/restaurants/${shopId}/review`, adminCookie, {
    method: 'POST',
    body: { decision: 'approved' },
  });
}

function approveItem(shopId: string, itemId: string) {
  return req(`/api/admin/restaurants/${shopId}/items/${itemId}/review`, adminCookie, {
    method: 'POST',
    body: { decision: 'approved' },
  });
}

/** 在已过审店铺下完成一单并发表评价（无 AI 凭证 → 保持 pending），返回评价 id。 */
async function createPendingReview(shopId: string, itemId: string, rating: number): Promise<string> {
  const orderRes = await req('/api/orders', customerCookie, {
    method: 'POST',
    body: {
      restaurantId: shopId,
      items: [{ menuItemId: itemId, quantity: 1 }],
      address: { address: '测试地址1号' },
    },
  });
  expect(orderRes.status).toBe(200);
  const orderId = ((await orderRes.json()) as OrderDto).id;
  await req(`/api/orders/${orderId}/status`, customerCookie, {
    method: 'PATCH',
    body: { status: 'delivering' },
  });
  await req(`/api/orders/${orderId}/status`, customerCookie, {
    method: 'PATCH',
    body: { status: 'completed' },
  });
  const revRes = await req(`/api/orders/${orderId}/reviews`, customerCookie, {
    method: 'POST',
    body: { rating, content: '批量审核测试评价' },
  });
  expect(revRes.status).toBe(200);
  return ((await revRes.json()) as ReviewDto).id;
}

async function shopAggregate(shopId: string): Promise<{ ratingSum: number; ratingCount: number }> {
  const [row] = await db
    .select({ ratingSum: restaurants.ratingSum, ratingCount: restaurants.ratingCount })
    .from(restaurants)
    .where(eq(restaurants.id, shopId));
  return row!;
}

beforeAll(async () => {
  // 无凭证：默认走人工队列，避免测试触网计费；ADMIN_USERNAMES 运行期设置即可生效
  savedAdmins = process.env.ADMIN_USERNAMES;
  savedSecretId = process.env.TENCENT_MODERATION_SECRET_ID;
  savedSecretKey = process.env.TENCENT_MODERATION_SECRET_KEY;
  delete process.env.TENCENT_MODERATION_SECRET_ID;
  delete process.env.TENCENT_MODERATION_SECRET_KEY;
  process.env.ADMIN_USERNAMES = [savedAdmins, admin.username].filter(Boolean).join(',');

  const a = await register(admin);
  adminCookie = a.cookie;
  expect(a.user.isAdmin).toBe(true);
  const o = await register(owner);
  ownerCookie = o.cookie;
  ownerId = o.user.id;
  const cu = await register(customer);
  customerCookie = cu.cookie;
  customerId = cu.user.id;
});

afterAll(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = savedAdmins;
  if (savedSecretId !== undefined) process.env.TENCENT_MODERATION_SECRET_ID = savedSecretId;
  if (savedSecretKey !== undefined) process.env.TENCENT_MODERATION_SECRET_KEY = savedSecretKey;
  await db.delete(reviews).where(eq(reviews.userId, customerId));
  await db.delete(orders).where(eq(orders.userId, customerId));
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId)); // cascades menu_items
  await db
    .delete(users)
    .where(inArray(users.username, [admin.username, owner.username, customer.username]));
  await pool.end();
});

describe('批量审批 POST /api/admin/moderation/review', () => {
  it('rejects anonymous (401) and non-admin (403)', async () => {
    expect(
      (await app.request('/api/admin/moderation/review', { method: 'POST' })).status,
    ).toBe(401);
    const res = await batchReview(
      { targets: [{ targetType: 'restaurant', restaurantId: 'x' }], decision: 'approved' },
      customerCookie,
    );
    expect(res.status).toBe(403);
  });

  it('validates the request body', async () => {
    // rejected 缺 reason
    const noReason = await batchReview({
      targets: [{ targetType: 'restaurant', restaurantId: 'x' }],
      decision: 'rejected',
    });
    expect(noReason.status).toBe(400);
    // targets 为空
    expect((await batchReview({ targets: [], decision: 'approved' })).status).toBe(400);
    // 超过 50 条
    const tooMany = await batchReview({
      targets: Array.from({ length: 51 }, () => ({ targetType: 'restaurant', restaurantId: 'x' })),
      decision: 'approved',
    });
    expect(tooMany.status).toBe(400);
  });

  it('mixed batch approve updates all three target types and bumps the shop aggregate', async () => {
    // 基础店铺+菜品先走单条审批通过，用于承载订单评价
    const baseShop = await createShop(`批量基础店_${stamp}`);
    await approveShop(baseShop.id);
    const baseItem = await createItem(baseShop.id, '批量基础菜');
    await approveItem(baseShop.id, baseItem.id);
    const reviewId = await createPendingReview(baseShop.id, baseItem.id, 5);

    const newShop = await createShop(`批量新店_${stamp}`);
    const newItem = await createItem(baseShop.id, '批量新菜');
    const before = await shopAggregate(baseShop.id);

    const res = await batchReview({
      targets: [
        { targetType: 'restaurant', restaurantId: newShop.id },
        { targetType: 'menuItem', restaurantId: baseShop.id, itemId: newItem.id },
        { targetType: 'review', reviewId },
      ],
      decision: 'approved',
    });
    expect(res.status).toBe(200);
    const result = (await res.json()) as BatchReviewResultDto;
    expect(result.succeeded).toBe(3);
    expect(result.failed).toEqual([]);

    const [shopRow] = await db.select().from(restaurants).where(eq(restaurants.id, newShop.id));
    expect(shopRow!.reviewStatus).toBe('approved');
    expect(shopRow!.reviewedBy).toBe(admin.username);
    const [itemRow] = await db.select().from(menuItems).where(eq(menuItems.id, newItem.id));
    expect(itemRow!.reviewStatus).toBe('approved');
    const [revRow] = await db.select().from(reviews).where(eq(reviews.id, reviewId));
    expect(revRow!.reviewStatus).toBe('approved');

    const after = await shopAggregate(baseShop.id);
    expect(after.ratingCount).toBe(before.ratingCount + 1);
    expect(after.ratingSum).toBe(before.ratingSum + 5);
  });

  it('batch reject writes the unified reason to every target', async () => {
    const shop = await createShop(`批量驳回店_${stamp}`);
    const item = await createItem(shop.id, '批量驳回菜');
    const res = await batchReview({
      targets: [
        { targetType: 'restaurant', restaurantId: shop.id },
        { targetType: 'menuItem', restaurantId: shop.id, itemId: item.id },
      ],
      decision: 'rejected',
      reason: '批量测试驳回',
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as BatchReviewResultDto).succeeded).toBe(2);
    const [shopRow] = await db.select().from(restaurants).where(eq(restaurants.id, shop.id));
    expect(shopRow!.reviewStatus).toBe('rejected');
    expect(shopRow!.rejectReason).toBe('批量测试驳回');
    expect(shopRow!.reviewedBy).toBe(admin.username);
    const [itemRow] = await db.select().from(menuItems).where(eq(menuItems.id, item.id));
    expect(itemRow!.reviewStatus).toBe('rejected');
    expect(itemRow!.rejectReason).toBe('批量测试驳回');
  });

  it('reports per-target failures and still processes the rest', async () => {
    const shop = await createShop(`批量部分店_${stamp}`);
    const res = await batchReview({
      targets: [
        { targetType: 'restaurant', restaurantId: shop.id },
        { targetType: 'restaurant', restaurantId: 'does-not-exist' },
        { targetType: 'review', reviewId: '00000000-0000-4000-8000-000000000000' },
      ],
      decision: 'approved',
    });
    expect(res.status).toBe(200);
    const result = (await res.json()) as BatchReviewResultDto;
    expect(result.succeeded).toBe(1);
    expect(result.failed).toHaveLength(2);
    expect(result.failed.map((f) => f.error)).toEqual(['店铺不存在', '评价不存在']);
    const [shopRow] = await db.select().from(restaurants).where(eq(restaurants.id, shop.id));
    expect(shopRow!.reviewStatus).toBe('approved');
  });

  it('does not touch the aggregate when flipping a merchant-hidden review', async () => {
    const shop = await createShop(`批量隐藏店_${stamp}`);
    await approveShop(shop.id);
    const item = await createItem(shop.id, '批量隐藏菜');
    await approveItem(shop.id, item.id);
    const reviewId = await createPendingReview(shop.id, item.id, 4);
    // 通过 → 计入聚合
    await batchReview({ targets: [{ targetType: 'review', reviewId }], decision: 'approved' });
    // 商家隐藏 → 聚合回滚，hiddenAt 置位
    const hideRes = await req(`/api/merchant/restaurants/${shop.id}/reviews/${reviewId}`, ownerCookie, {
      method: 'PATCH',
      body: { hidden: true },
    });
    expect(hideRes.status).toBe(200);
    const beforeFlip = await shopAggregate(shop.id);

    // 隐藏中的评价：批量驳回、再批量通过，状态翻转但聚合不动
    await batchReview({
      targets: [{ targetType: 'review', reviewId }],
      decision: 'rejected',
      reason: '隐藏评价改判',
    });
    expect(await shopAggregate(shop.id)).toEqual(beforeFlip);
    await batchReview({ targets: [{ targetType: 'review', reviewId }], decision: 'approved' });
    expect(await shopAggregate(shop.id)).toEqual(beforeFlip);
    const [revRow] = await db.select().from(reviews).where(eq(reviews.id, reviewId));
    expect(revRow!.reviewStatus).toBe('approved');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm -w server run test -- moderationBatch`
Expected: FAIL — 批量接口尚不存在，`/api/admin/moderation/review` 一律返回 404（requireAdmin 挂在路由上，路由不存在时轮不到它返回 401/403），6 个用例应全部 FAIL

- [ ] **Step 3: 实现批量接口**

在 `server/src/routes/admin.ts`：

3a. 顶部 import 类型处，向 `@sim-waimai/shared` 的 type import 中加入 `BatchReviewResultDto`。

3b. 在 `reviewSchema` 定义之后添加：

```ts
const BATCH_LIMIT = 50;

const moderationTargetSchema = z.discriminatedUnion('targetType', [
  z.object({ targetType: z.literal('restaurant'), restaurantId: z.string().min(1) }),
  z.object({ targetType: z.literal('menuItem'), restaurantId: z.string().min(1), itemId: z.string().min(1) }),
  z.object({ targetType: z.literal('review'), reviewId: z.string().regex(UUID_RE, '评价不存在') }),
]);

const batchReviewSchema = z
  .object({
    targets: z.array(moderationTargetSchema).min(1, '至少选择一条').max(BATCH_LIMIT, `单次最多 ${BATCH_LIMIT} 条`),
    decision: z.enum(['approved', 'rejected']),
    reason: z.string().max(200).optional(),
  })
  .refine((b) => b.decision !== 'rejected' || !!b.reason?.trim(), {
    message: '驳回必须填写原因',
  });
```

3c. 在 `adminRoutes` 链上、`.get('/moderation', ...)` 之后添加：

```ts
.post('/moderation/review', requireAdmin, validateJson(batchReviewSchema), async (c) => {
  const admin = c.get('user');
  const body = c.req.valid('json');
  // 逐条独立处理（非整体原子）：单条失败不影响其余，符合清空审核队列场景。
  const failed: BatchReviewResultDto['failed'] = [];
  let succeeded = 0;
  for (const target of body.targets) {
    let ok = false;
    let error = '';
    if (target.targetType === 'restaurant') {
      ok = (await applyRestaurantDecision(target.restaurantId, body, admin.username)) !== null;
      error = '店铺不存在';
    } else if (target.targetType === 'menuItem') {
      ok = (await applyMenuItemDecision(target.restaurantId, target.itemId, body, admin.username)) !== null;
      error = '菜品不存在';
    } else {
      ok = (await applyUserReviewDecision(target.reviewId, body, admin.username)) !== null;
      error = '评价不存在';
    }
    if (ok) succeeded += 1;
    else failed.push({ target, error });
  }
  const result: BatchReviewResultDto = { succeeded, failed };
  return c.json(result);
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm -w server run test -- moderationBatch`
Expected: PASS（6 个用例全绿）

- [ ] **Step 5: 全量 server 测试回归**

Run: `npm run test:server`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/admin.ts server/src/test/moderationBatch.test.ts
git commit -m "feat(api): 批量审批接口，逐条独立处理并返回每条成败"
```

---

### Task 4: web 前端——勾选与批量操作栏

**Files:**
- Modify: `src/pages/AdminReview.tsx`

**Interfaces:**
- Consumes: Task 1 的 `ModerationTargetDto` / `BatchReviewResultDto`；Task 3 的 `POST /admin/moderation/review`（经 `api.post`，路径前缀 `/api` 由 `src/lib/api.ts` 添加）。

- [ ] **Step 1: 修改 AdminReview.tsx**

1a. 更新 shared 类型 import（文件顶部）：

```ts
import type {
  BatchReviewResultDto,
  ModerationItemDto,
  ModerationTargetDto,
  ReviewStatus,
} from '@sim-waimai/shared';
```

1b. 在 `itemKey` 函数之后添加：

```ts
function toTarget(item: ModerationItemDto): ModerationTargetDto {
  if (item.targetType === 'review') return { targetType: 'review', reviewId: item.reviewId! };
  if (item.targetType === 'menuItem')
    return { targetType: 'menuItem', restaurantId: item.restaurantId, itemId: item.itemId! };
  return { targetType: 'restaurant', restaurantId: item.restaurantId };
}
```

1c. 组件内，现有 `message` state 之后添加批量相关 state 与逻辑：

```ts
const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
const [batchRejecting, setBatchRejecting] = useState(false);
const [batchReason, setBatchReason] = useState('');
const [batchSubmitting, setBatchSubmitting] = useState(false);

const allSelected =
  (items ?? []).length > 0 && (items ?? []).every((it) => selectedKeys.has(itemKey(it)));
const showBatchBar = status === 'pending' && selectedKeys.size > 0;

const clearSelection = () => {
  setSelectedKeys(new Set());
  setBatchRejecting(false);
  setBatchReason('');
};

const toggleSelect = (key: string) => {
  setSelectedKeys((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
};

const batchReview = async (decision: 'approved' | 'rejected', reason?: string) => {
  const targets = (items ?? []).filter((it) => selectedKeys.has(itemKey(it))).map(toTarget);
  if (targets.length === 0) return;
  setBatchSubmitting(true);
  try {
    const result = await api.post<BatchReviewResultDto>('/admin/moderation/review', {
      targets,
      decision,
      ...(reason ? { reason } : {}),
    });
    flash(
      result.failed.length === 0
        ? `${decision === 'approved' ? '已通过' : '已驳回'} ${result.succeeded} 条 ✓`
        : `成功 ${result.succeeded} 条，失败 ${result.failed.length} 条`,
    );
    clearSelection();
    reload();
  } catch (err) {
    // 整个请求失败：不清空勾选，便于修正后重试
    flash(err instanceof Error ? err.message : '操作失败，请稍后重试');
  } finally {
    setBatchSubmitting(false);
  }
};
```

1d. Tab 切换按钮的 `onClick` 中追加清空勾选（现有基础上加一行 `clearSelection();`）：

```ts
onClick={() => {
  setSearchParams({ status: tab.value }, { replace: true });
  setRejectingKey(null);
  clearSelection();
}}
```

1e. 页面容器 className 改为选中时加大底部留白，避免固定操作栏遮挡最后一张卡片：

```tsx
<div className={`app-container min-h-screen bg-gray-50 dark:bg-gray-900 ${showBatchBar ? 'pb-32' : 'pb-10'}`}>
```

1f. 列表非空分支（原 `<div className="space-y-3 mt-4">` 处）改为 fragment，前面加全选行：

```tsx
) : (
  <>
    {status === 'pending' && (
      <label className="flex items-center gap-2 mt-4 px-1 text-sm text-gray-600 dark:text-gray-300">
        <input
          type="checkbox"
          className="w-4 h-4 accent-orange-500"
          checked={allSelected}
          onChange={() =>
            setSelectedKeys(allSelected ? new Set() : new Set(items!.map(itemKey)))
          }
        />
        全选
        {selectedKeys.size > 0 && (
          <span className="text-xs text-orange-500">已选 {selectedKeys.size} 条</span>
        )}
      </label>
    )}
    <div className="space-y-3 mt-3">
      {/* 原 items!.map(...) 卡片列表原样保留 */}
    </div>
  </>
)
```

1g. 卡片内 `<div className="flex items-start gap-3">` 的第一个子元素前插入勾选框（仅 pending Tab 渲染）：

```tsx
{status === 'pending' && (
  <input
    type="checkbox"
    className="w-4 h-4 mt-0.5 accent-orange-500 flex-shrink-0"
    checked={selectedKeys.has(key)}
    onChange={() => toggleSelect(key)}
  />
)}
```

1h. 页面容器闭合 `</div>` 之前（`px-4` 内容区之后）添加底部固定批量操作栏（样式对齐 `AdminReviewDetail.tsx:233` 的固定底栏与本页现有按钮）：

```tsx
{showBatchBar && (
  <div className="fixed bottom-0 left-0 right-0 app-container bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 p-3 space-y-2">
    {batchRejecting && (
      <input
        className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-red-400 text-sm"
        placeholder="填写统一驳回原因（将展示给发布者）"
        value={batchReason}
        onChange={(e) => setBatchReason(e.target.value)}
        autoFocus
      />
    )}
    <div className="flex gap-2">
      {batchRejecting ? (
        <>
          <button
            className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 py-2.5 rounded-xl text-sm"
            onClick={() => {
              setBatchRejecting(false);
              setBatchReason('');
            }}
          >
            取消
          </button>
          <button
            className="flex-1 bg-red-500 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
            disabled={batchSubmitting || !batchReason.trim()}
            onClick={() => batchReview('rejected', batchReason.trim())}
          >
            {batchSubmitting ? '提交中…' : `确认驳回 ${selectedKeys.size} 条`}
          </button>
        </>
      ) : (
        <>
          <button
            className="flex-1 border border-red-200 dark:border-red-500/30 text-red-500 py-2.5 rounded-xl text-sm disabled:opacity-50"
            disabled={batchSubmitting}
            onClick={() => setBatchRejecting(true)}
          >
            批量驳回
          </button>
          <button
            className="flex-1 bg-green-500 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
            disabled={batchSubmitting}
            onClick={() => batchReview('approved')}
          >
            {batchSubmitting ? '提交中…' : `批量通过 ${selectedKeys.size} 条`}
          </button>
        </>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 2: 构建与 lint 验证**

Run: `npm run build && npm run lint`
Expected: tsc + vite build 成功，oxlint 无新增告警

- [ ] **Step 3: 实际运行验证**

启动 `npm run dev`，以管理员账号登录进入「审核管理」页验证：
1. 待审核 Tab 出现全选行与卡片勾选框；已通过/已驳回 Tab 无勾选框、无底栏。
2. 勾选 2 条以上 → 底部出现操作栏；「批量通过 N 条」后 flash「已通过 N 条 ✓」且列表刷新、勾选清空。
3. 「批量驳回」展开统一原因输入，空原因时确认按钮禁用；填写后驳回成功，切到已驳回 Tab 可见统一驳回原因。
4. 切换 Tab 后勾选状态清空。

- [ ] **Step 4: Commit**

```bash
git add src/pages/AdminReview.tsx
git commit -m "feat(web): 审核列表待审 Tab 勾选批量通过/驳回"
```
