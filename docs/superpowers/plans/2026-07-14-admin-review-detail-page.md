# 审核详情页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 审核队列列表点击"查看详情"跳转到独立路由的详情页，展示店铺/商品提交的全部字段，AI 建议区块固定展示（未接入时显式标注"未接入"），并支持在详情页直接完成通过/驳回。

**Architecture:** 后端新增两个只读 GET 接口（`server/src/routes/admin.ts`），复用 `lib/mappers.ts` 已有的 `toRestaurant`/`toMenuItem` 拿到完整"提交内容"，叠加审核/AI 元信息返回。前端新增一个通用详情页组件（`targetType` 区分店铺/商品两种渲染分支），两条新路由；`AdminReview.tsx` 列表卡片加一个跳转链接，并把 AI 徽标从"点击展开"简化为纯展示。

**Tech Stack:** Hono、drizzle-orm、React Router、Tailwind（复用 `AdminReview.tsx`/`MerchantEdit.tsx` 已有的配色/样式约定）。

**设计文档：** `docs/superpowers/specs/2026-07-14-admin-review-detail-page-design.md`

## Global Constraints

- UI 全中文，沿用现有 Tailwind `dark:` 变体与 orange-500 主色调。
- 金额：DB 存分，API/前端一律用元（`fenToYuan`，已由 `toRestaurant`/`toMenuItem` 处理，不需要在本计划的新代码里再转换）。
- TS strict + `verbatimModuleSyntax`：`shared/` 里的类型导入用 `import type`。
- 本仓库前端没有自动化组件测试框架（只有 `server/src/test/*` 的 vitest），前端改动用 `npm run build`（类型检查）+ 手动浏览器验证，不新增测试框架。
- 每个任务结束跑通验证再 commit；commit message 末尾带 `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` 行。

---

### Task 1: 后端详情接口（店铺 + 商品）

**Files:**
- Modify: `shared/src/api.ts`（新增 `ModerationRestaurantDetailDto`/`ModerationItemDetailDto` 类型）
- Modify: `server/src/routes/admin.ts`（新增两个 GET 路由，复用 `lib/mappers.ts`）
- Modify: `server/src/test/moderation.test.ts`（新增测试 describe 块）

**Interfaces:**
- Consumes：`server/src/lib/mappers.ts` 已有的 `toRestaurant(row, items): Restaurant`、`toMenuItem(row): MenuItem`（无需改动这两个函数）。
- Produces：`GET /api/admin/restaurants/:id` → `ModerationRestaurantDetailDto`；`GET /api/admin/restaurants/:id/items/:itemId` → `ModerationItemDetailDto`。这两个类型是 Task 2（前端详情页）唯一依赖的接口契约。

- [ ] **Step 1: 写失败测试**

在 `server/src/test/moderation.test.ts` 文件末尾（`describe('AI 审核路径（注入 reviewer）', ...)` 之后）追加：

```ts
describe('审核详情接口（GET /api/admin/restaurants/:id[/items/:itemId]）', () => {
  it('returns full submitted content for a shop, admin-only, 404 for unknown id', async () => {
    const shop = await createShop(`详情店_${stamp}`);

    expect((await app.request(`/api/admin/restaurants/${shop.id}`)).status).toBe(401);
    expect((await req(`/api/admin/restaurants/${shop.id}`, randoCookie)).status).toBe(403);

    const res = await req(`/api/admin/restaurants/${shop.id}`, adminCookie);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as {
      targetType: string;
      restaurant: { deliveryFee: number; bgColor: string; category: string };
      reviewStatus: string;
      ownerUsername: string | null;
      aiVerdict: string | null;
    };
    expect(detail.targetType).toBe('restaurant');
    expect(detail.restaurant.deliveryFee).toBe(3);
    expect(detail.restaurant.bgColor).toBe('#336699');
    expect(detail.restaurant.category).toBe('中式快餐');
    expect(detail.reviewStatus).toBe('pending');
    expect(detail.ownerUsername).toBe(owner.username);
    expect(detail.aiVerdict).toBeNull();

    expect((await req('/api/admin/restaurants/does-not-exist', adminCookie)).status).toBe(404);
  });

  it('returns full submitted content for a menu item, including option groups, 404 for unknown item', async () => {
    const shop = await createShop(`详情商品店_${stamp}`);
    const itemRes = await req(`/api/merchant/restaurants/${shop.id}/items`, ownerCookie, {
      method: 'POST',
      body: {
        name: '详情规格菜',
        price: 18,
        emoji: '🍜',
        menuCategory: '招牌',
        optionGroups: [
          {
            id: 'size',
            name: '规格',
            selectionType: 'single',
            required: true,
            options: [
              { id: 'small', name: '小份', priceDelta: 0 },
              { id: 'large', name: '大份', priceDelta: 5 },
            ],
            defaultOptionIds: ['small'],
          },
        ],
      },
    });
    const item = (await itemRes.json()) as MerchantMenuItemDto;

    const res = await req(`/api/admin/restaurants/${shop.id}/items/${item.id}`, adminCookie);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as {
      targetType: string;
      restaurantName: string;
      item: {
        price: number;
        calories: number;
        menuCategory: string;
        optionGroups?: { name: string; options: { name: string; priceDelta: number }[] }[];
      };
    };
    expect(detail.targetType).toBe('menuItem');
    expect(detail.restaurantName).toBe(shop.name);
    expect(detail.item.price).toBe(18);
    expect(detail.item.menuCategory).toBe('招牌');
    expect(detail.item.optionGroups?.[0]?.name).toBe('规格');
    expect(detail.item.optionGroups?.[0]?.options.map((o) => o.name)).toEqual(['小份', '大份']);
    expect(detail.item.optionGroups?.[0]?.options[1]?.priceDelta).toBe(5);

    expect(
      (await req(`/api/admin/restaurants/${shop.id}/items/does-not-exist`, adminCookie)).status,
    ).toBe(404);
  });

  it('detail reflects the same AI verdict/reason/confidence the list endpoint shows', async () => {
    __setAiReviewer(async () => ({ verdict: 'uncertain', reason: '详情一致性测试', confidence: 0.55 }));
    const shop = await createShop(`详情AI店_${stamp}`);
    await __awaitReviews();

    const res = await req(`/api/admin/restaurants/${shop.id}`, adminCookie);
    const detail = (await res.json()) as {
      aiVerdict: string | null;
      aiReason: string | null;
      aiConfidence: number | null;
    };
    expect(detail.aiVerdict).toBe('uncertain');
    expect(detail.aiReason).toBe('详情一致性测试');
    expect(detail.aiConfidence).toBe(0.55);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm -w server run test -- moderation.test.ts`
Expected: 新增的 3 个用例 FAIL（路由不存在，`app.notFound` 兜底返回 `{error:'接口不存在'}`，导致 `detail.restaurant`/`detail.item` 等属性访问为 `undefined` 断言失败；401/403 断言也会因为路由不存在而拿到 404 从而失败）。已有测试仍应全部 PASS。

- [ ] **Step 3: 加共享类型**

在 `shared/src/api.ts` 顶部的 type-only import 加上 `Restaurant`：

```ts
import type { Category, MenuItem, Restaurant, Rider } from './types';
```

在 `ModerationItemDto` 接口定义结束后（`export type UploadKind = ...` 之前）插入：

```ts
/** Shared review/AI metadata for both detail DTOs below. */
interface ModerationReviewMeta {
  reviewStatus: ReviewStatus;
  rejectReason?: string | null;
  /** ISO timestamp of the last review decision, null while still pending. */
  reviewedAt?: string | null;
  /** 'ai' or the deciding admin's username; null while pending. */
  reviewedBy?: string | null;
  ownerUsername?: string | null;
  aiVerdict?: AiVerdict | null;
  aiReason?: string | null;
  aiConfidence?: number | null;
}

/** Full detail for a single shop under review (admin review detail page). */
export interface ModerationRestaurantDetailDto extends ModerationReviewMeta {
  targetType: 'restaurant';
  restaurant: Restaurant;
}

/** Full detail for a single menu item under review (admin review detail page). */
export interface ModerationItemDetailDto extends ModerationReviewMeta {
  targetType: 'menuItem';
  restaurantId: string;
  restaurantName: string;
  item: MenuItem;
}
```

- [ ] **Step 4: 实现两个 GET 路由**

`server/src/routes/admin.ts` 顶部把这一行：

```ts
import type { ModerationItemDto, ReviewStatus } from '@sim-waimai/shared';
```

改成：

```ts
import type {
  ModerationItemDetailDto,
  ModerationItemDto,
  ModerationRestaurantDetailDto,
  ReviewStatus,
} from '@sim-waimai/shared';
```

并在 `import { validateJson } from '../lib/validate';` 上面新增一行：

```ts
import { toMenuItem, toRestaurant } from '../lib/mappers';
```

在 `.get('/moderation', requireAdmin, async (c) => { ... })` 之后、`.post('/restaurants/:id/review', ...)` 之前插入两个新路由：

```ts
  .get('/restaurants/:id', requireAdmin, async (c) => {
    const [row] = await db.select().from(restaurants).where(eq(restaurants.id, c.req.param('id')));
    if (!row) return c.json({ error: '店铺不存在' }, 404);
    const [owner] = row.ownerId
      ? await db.select({ username: users.username }).from(users).where(eq(users.id, row.ownerId))
      : [];
    const detail: ModerationRestaurantDetailDto = {
      targetType: 'restaurant',
      restaurant: toRestaurant(row, []),
      reviewStatus: row.reviewStatus,
      rejectReason: row.rejectReason,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewedBy: row.reviewedBy,
      ownerUsername: owner?.username ?? null,
      aiVerdict: row.aiVerdict,
      aiReason: row.aiReason,
      aiConfidence: row.aiConfidence,
    };
    return c.json(detail);
  })
  .get('/restaurants/:id/items/:itemId', requireAdmin, async (c) => {
    const restaurantId = c.req.param('id');
    const itemId = c.req.param('itemId');
    const [row] = await db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.restaurantId, restaurantId), eq(menuItems.id, itemId)));
    if (!row) return c.json({ error: '菜品不存在' }, 404);
    const [shop] = await db
      .select({ name: restaurants.name, ownerId: restaurants.ownerId })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId));
    const [owner] = shop?.ownerId
      ? await db.select({ username: users.username }).from(users).where(eq(users.id, shop.ownerId))
      : [];
    const detail: ModerationItemDetailDto = {
      targetType: 'menuItem',
      restaurantId,
      restaurantName: shop?.name ?? '',
      item: toMenuItem(row),
      reviewStatus: row.reviewStatus,
      rejectReason: row.rejectReason,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewedBy: row.reviewedBy,
      ownerUsername: owner?.username ?? null,
      aiVerdict: row.aiVerdict,
      aiReason: row.aiReason,
      aiConfidence: row.aiConfidence,
    };
    return c.json(detail);
  })
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm -w server run test -- moderation.test.ts`
Expected: 全部 PASS（含新增 3 个用例）。

- [ ] **Step 6: typecheck**

Run: `npm -w server run typecheck`
Expected: 无报错。

- [ ] **Step 7: Commit**

```bash
git add shared/src/api.ts server/src/routes/admin.ts server/src/test/moderation.test.ts
git commit -m "$(cat <<'EOF'
feat(server): add admin review detail endpoints for shops and menu items

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 前端详情页组件 + 路由

**Files:**
- Create: `src/lib/reviewBadges.ts`（`STATUS_BADGE`/`AI_VERDICT_BADGE` 共享常量，供本任务和 Task 3 复用，避免同一份配色映射在两个文件里各写一遍）
- Create: `src/pages/AdminReviewDetail.tsx`
- Modify: `src/App.tsx`（新增两条路由）

**Interfaces:**
- Consumes：Task 1 产出的 `ModerationRestaurantDetailDto`/`ModerationItemDetailDto`（`@sim-waimai/shared`）、`GET /admin/restaurants/:id`、`GET /admin/restaurants/:id/items/:itemId`、`POST /admin/restaurants/:id/review`、`POST /admin/restaurants/:id/items/:itemId/review`（已存在，无需改动）；`useApi`（`src/hooks/useApi.ts`）；`assetUrl`（`src/lib/assetUrl.ts`）。
- Produces：`STATUS_BADGE`/`AI_VERDICT_BADGE`（`src/lib/reviewBadges.ts`），Task 3 会把 `AdminReview.tsx` 里现有的同名本地常量删掉，改成从这里导入。`<AdminReviewDetail targetType="restaurant" | "menuItem" />` 组件，挂载在 `/admin/review/restaurant/:id` 与 `/admin/review/item/:id/:itemId` 两条路由上，供 Task 3 的列表页链接过去。

- [ ] **Step 1: 提取共享徽标常量**

写入 `src/lib/reviewBadges.ts`（内容跟 `AdminReview.tsx` 里现有的 `STATUS_BADGE`/`AI_VERDICT_BADGE` 定义逐字一致，只是挪了个位置）：

```ts
import type { AiVerdict, ReviewStatus } from '@sim-waimai/shared';

export const STATUS_BADGE: Record<ReviewStatus, { label: string; className: string }> = {
  pending: { label: '待审核', className: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10' },
  approved: { label: '已通过', className: 'text-green-600 bg-green-50 dark:bg-green-500/10' },
  rejected: { label: '已驳回', className: 'text-red-500 bg-red-50 dark:bg-red-500/10' },
};

export const AI_VERDICT_BADGE: Record<AiVerdict, { label: string; className: string }> = {
  approve: { label: 'AI建议：通过', className: 'text-green-600 bg-green-50 dark:bg-green-500/10' },
  reject: { label: 'AI建议：驳回', className: 'text-red-500 bg-red-50 dark:bg-red-500/10' },
  uncertain: { label: 'AI存疑，待人工判断', className: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10' },
};
```

- [ ] **Step 2: 创建详情页组件**

写入 `src/pages/AdminReviewDetail.tsx`：

```tsx
import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { ModerationItemDetailDto, ModerationRestaurantDetailDto, ReviewStatus } from '@sim-waimai/shared';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';
import { assetUrl } from '../lib/assetUrl';
import { AI_VERDICT_BADGE, STATUS_BADGE } from '../lib/reviewBadges';

type Detail = ModerationRestaurantDetailDto | ModerationItemDetailDto;

interface Props {
  targetType: 'restaurant' | 'menuItem';
}

export default function AdminReviewDetail({ targetType }: Props) {
  const { id, itemId } = useParams<{ id: string; itemId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const returnStatus = (location.state as { status?: ReviewStatus } | null)?.status ?? 'pending';

  const fetchPath =
    targetType === 'restaurant' ? `/admin/restaurants/${id}` : `/admin/restaurants/${id}/items/${itemId}`;
  const { data, loading, error } = useApi<Detail>(fetchPath);

  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const goBack = () => navigate('/admin/review', { state: { status: returnStatus } });

  const review = async (decision: 'approved' | 'rejected', reason?: string) => {
    const reviewPath =
      targetType === 'restaurant'
        ? `/admin/restaurants/${id}/review`
        : `/admin/restaurants/${id}/items/${itemId}/review`;
    setSubmitting(true);
    try {
      await api.post(reviewPath, { decision, ...(reason ? { reason } : {}) });
      goBack();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '操作失败，请稍后重试');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900 pb-10">
        <div className="px-4 pt-10 space-y-3">
          <div className="bg-white dark:bg-gray-800 rounded-2xl h-40 animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900 pb-10 flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-gray-400 dark:text-gray-500">{error ?? '该内容不存在或已变更'}</p>
        <button className="text-orange-500 text-sm" onClick={goBack}>
          返回列表
        </button>
      </div>
    );
  }

  const badge = STATUS_BADGE[data.reviewStatus];
  const emoji = data.targetType === 'restaurant' ? data.restaurant.emoji : data.item.emoji;
  const name = data.targetType === 'restaurant' ? data.restaurant.name : data.item.name;

  return (
    <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900 pb-28">
      <div className="bg-white dark:bg-gray-800 px-4 pt-10 pb-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
        <button
          className="w-8 h-8 flex items-center justify-center text-gray-600 dark:text-gray-300"
          onClick={goBack}
        >
          ←
        </button>
        <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg truncate">
          {emoji} {name}
        </h1>
      </div>

      {message && (
        <p className="text-center text-xs text-orange-500 py-2 bg-orange-50 dark:bg-orange-500/10">{message}</p>
      )}

      <div className="px-4 pt-4 space-y-3">
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 space-y-2">
          <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}>
            {badge.label}
          </span>

          {data.targetType === 'restaurant' ? (
            <>
              <p className="text-sm text-gray-900 dark:text-gray-100">品类：{data.restaurant.category}</p>
              {data.restaurant.tags.length > 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  标签：{data.restaurant.tags.join(' / ')}
                </p>
              )}
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                色值：
                <span
                  className="inline-block w-4 h-4 rounded-full border border-gray-200 dark:border-gray-700"
                  style={{ backgroundColor: data.restaurant.bgColor }}
                />
                {data.restaurant.bgColor}
              </div>
              {data.restaurant.bannerImage && (
                <img
                  src={assetUrl(data.restaurant.bannerImage)}
                  alt="横幅"
                  className="w-full h-32 object-cover rounded-xl"
                />
              )}
              <p className="text-sm text-gray-500 dark:text-gray-400">
                配送费 ¥{data.restaurant.deliveryFee} · 起送 ¥{data.restaurant.minOrder} · 约
                {data.restaurant.deliveryTime}分钟
              </p>
              {data.restaurant.menuCategories.length > 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  菜单分类：{data.restaurant.menuCategories.join(' / ')}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-gray-500 dark:text-gray-400">所属店铺：{data.restaurantName}</p>
              {data.item.description && (
                <p className="text-sm text-gray-900 dark:text-gray-100">{data.item.description}</p>
              )}
              <p className="text-sm text-gray-500 dark:text-gray-400">
                ¥{data.item.price} · {data.item.calories}kcal · {data.item.menuCategory}
                {data.item.popular ? ' · 人气' : ''}
              </p>
              {data.item.image && (
                <img
                  src={assetUrl(data.item.image)}
                  alt={data.item.name}
                  className="w-32 h-32 object-cover rounded-xl"
                />
              )}
              {data.item.optionGroups?.map((group) => (
                <div key={group.id} className="text-sm text-gray-500 dark:text-gray-400">
                  {group.name}（{group.selectionType === 'single' ? '单选' : '多选'}）：
                  {group.options.map((o) => `${o.name}${o.priceDelta ? `+¥${o.priceDelta}` : ''}`).join('、')}
                </div>
              ))}
            </>
          )}

          <p className="text-xs text-gray-400 dark:text-gray-500">
            发布者：{data.ownerUsername ?? '平台'}
            {data.reviewedBy && ` · 审核人：${data.reviewedBy === 'ai' ? 'AI' : data.reviewedBy}`}
          </p>
          {data.reviewedAt && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              审核时间：{new Date(data.reviewedAt).toLocaleString('zh-CN')}
            </p>
          )}
          {data.reviewStatus === 'rejected' && data.rejectReason && (
            <p className="text-red-500 text-xs">驳回原因：{data.rejectReason}</p>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 space-y-2">
          <p className="font-bold text-sm text-gray-900 dark:text-gray-100">🤖 AI 审核建议</p>
          {data.aiVerdict ? (
            <>
              <span
                className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${AI_VERDICT_BADGE[data.aiVerdict].className}`}
              >
                {AI_VERDICT_BADGE[data.aiVerdict].label}
                {data.aiConfidence != null && ` · ${Math.round(data.aiConfidence * 100)}%`}
              </span>
              <p className="text-sm text-gray-500 dark:text-gray-400">{data.aiReason}</p>
            </>
          ) : (
            <span className="inline-block text-xs px-2 py-0.5 rounded-full font-medium text-gray-500 bg-gray-100 dark:bg-gray-700">
              AI 审核：未接入
            </span>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 app-container bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 p-4">
        {rejecting ? (
          <div className="space-y-2">
            <input
              className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-red-400 text-sm"
              placeholder="填写驳回原因（将展示给商家）"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 py-2.5 rounded-xl text-sm"
                onClick={() => {
                  setRejecting(false);
                  setRejectReason('');
                }}
              >
                取消
              </button>
              <button
                className="flex-1 bg-red-500 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
                disabled={submitting || !rejectReason.trim()}
                onClick={() => review('rejected', rejectReason.trim())}
              >
                {submitting ? '提交中…' : '确认驳回'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            {data.reviewStatus !== 'rejected' && (
              <button
                className="flex-1 border border-red-200 dark:border-red-500/30 text-red-500 py-2.5 rounded-xl text-sm disabled:opacity-50"
                disabled={submitting}
                onClick={() => {
                  setRejecting(true);
                  setRejectReason('');
                }}
              >
                驳回
              </button>
            )}
            {data.reviewStatus !== 'approved' && (
              <button
                className="flex-1 bg-green-500 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
                disabled={submitting}
                onClick={() => review('approved')}
              >
                {submitting ? '提交中…' : '通过'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 接入路由**

`src/App.tsx`：在 `import AdminReview from './pages/AdminReview';` 下面加一行：

```tsx
import AdminReviewDetail from './pages/AdminReviewDetail';
```

在 `<Route path="/admin/review" element={<RequireAdmin><AdminReview /></RequireAdmin>} />` 之后加两条：

```tsx
                <Route
                  path="/admin/review/restaurant/:id"
                  element={
                    <RequireAdmin>
                      <AdminReviewDetail targetType="restaurant" />
                    </RequireAdmin>
                  }
                />
                <Route
                  path="/admin/review/item/:id/:itemId"
                  element={
                    <RequireAdmin>
                      <AdminReviewDetail targetType="menuItem" />
                    </RequireAdmin>
                  }
                />
```

- [ ] **Step 4: typecheck + build**

Run: `npm run build`
Expected: 通过（`tsc -b && vite build` 无报错）。

- [ ] **Step 5: 手动验证（浏览器）**

前提：`npm run dev` 已在跑，且已有 `ADMIN_USERNAMES` 里的管理员账号登录。

1. 直接在地址栏访问 `/admin/review/restaurant/<某个待审核店铺id>`（可从 `curl -s -H "Cookie: <adminCookie>" localhost:3001/api/admin/moderation?status=pending` 或直接看 DB 里 `review_status='pending'` 的一行拿 id）。
2. 确认页面正常渲染：emoji/店名/品类/标签/色值色块/配送参数/菜单分类都显示；如果该店铺有横幅图能看到真图。
3. 确认 AI 建议区块：没配 `ANTHROPIC_API_KEY` 的情况下应显示"AI 审核：未接入"。
4. 点底部"通过"按钮，确认跳回 `/admin/review` 且该项状态变化。
5. 用同样方式访问一个 `/admin/review/item/:id/:itemId`，确认商品字段（价格/卡路里/规格组，如果该商品有规格组）显示正确。
6. 访问一个不存在的 id（如 `/admin/review/restaurant/does-not-exist`），确认显示"该内容不存在或已变更" + 返回列表链接，不白屏/不报错。

- [ ] **Step 6: Commit**

```bash
git add src/pages/AdminReviewDetail.tsx src/App.tsx
git commit -m "$(cat <<'EOF'
feat: add admin review detail page for shops and menu items

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 列表页联动（"查看详情"链接 + 简化 AI 徽标）

**Files:**
- Modify: `src/pages/AdminReview.tsx`

**Interfaces:**
- Consumes：Task 2 的路由 `/admin/review/restaurant/:id`、`/admin/review/item/:id/:itemId`。
- Produces：无新接口，列表页行为变化。

- [ ] **Step 1: 加 detailPath helper，移除 AI 点击展开逻辑，加"查看详情"链接，接入 tab 状态回传**

在 `src/pages/AdminReview.tsx` 里：

1. 把顶部这一行：

```tsx
import { useNavigate } from 'react-router-dom';
```

改成：

```tsx
import { useLocation, useNavigate } from 'react-router-dom';
```

把这一行：

```tsx
import type { AiVerdict, ModerationItemDto, ReviewStatus } from '@sim-waimai/shared';
```

改成（不再需要 `AiVerdict`，改成从共享徽标模块拿颜色映射）：

```tsx
import type { ModerationItemDto, ReviewStatus } from '@sim-waimai/shared';
```

并在 `import { api } from '../lib/api';` 下面新增一行：

```tsx
import { AI_VERDICT_BADGE, STATUS_BADGE } from '../lib/reviewBadges';
```

2. 删除文件里这两段本地常量定义（现在从 Step 1 里改好的 import 拿）：

```tsx
const STATUS_BADGE: Record<ReviewStatus, { label: string; className: string }> = {
  pending: { label: '待审核', className: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10' },
  approved: { label: '已通过', className: 'text-green-600 bg-green-50 dark:bg-green-500/10' },
  rejected: { label: '已驳回', className: 'text-red-500 bg-red-50 dark:bg-red-500/10' },
};

const AI_VERDICT_BADGE: Record<AiVerdict, { label: string; className: string }> = {
  approve: { label: 'AI建议：通过', className: 'text-green-600 bg-green-50 dark:bg-green-500/10' },
  reject: { label: 'AI建议：驳回', className: 'text-red-500 bg-red-50 dark:bg-red-500/10' },
  uncertain: { label: 'AI存疑，待人工判断', className: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10' },
};
```

3. 在 `reviewPath` 函数下面加一个新 helper：

```tsx
function detailPath(item: ModerationItemDto): string {
  return item.targetType === 'restaurant'
    ? `/admin/review/restaurant/${item.restaurantId}`
    : `/admin/review/item/${item.restaurantId}/${item.itemId}`;
}
```

4. 组件内，`const navigate = useNavigate();` 下面加：

```tsx
  const location = useLocation();
```

5. 把 `const [status, setStatus] = useState<ReviewStatus>('pending');` 改成从 `location.state` 读回上次的 tab：

```tsx
  const [status, setStatus] = useState<ReviewStatus>(
    () => (location.state as { status?: ReviewStatus } | null)?.status ?? 'pending',
  );
```

6. 删除 `const [expandedKey, setExpandedKey] = useState<string | null>(null);` 这一行（不再需要）。

7. 把现有的 AI 徽标 `<button>`（可点击展开）：

```tsx
                      {item.aiVerdict && (
                        <button
                          type="button"
                          className={`mt-1.5 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${AI_VERDICT_BADGE[item.aiVerdict].className}`}
                          onClick={() => setExpandedKey(expandedKey === key ? null : key)}
                        >
                          🤖 {AI_VERDICT_BADGE[item.aiVerdict].label}
                          {item.aiConfidence != null && ` · ${Math.round(item.aiConfidence * 100)}%`}
                        </button>
                      )}
                      {expandedKey === key && item.aiVerdict && (
                        <p className="text-gray-500 dark:text-gray-400 text-xs mt-1.5 bg-gray-50 dark:bg-gray-900 rounded-lg p-2">
                          {item.aiReason}
                        </p>
                      )}
```

改成纯展示的 `<span>` + 一行"查看详情 ›"链接：

```tsx
                      {item.aiVerdict && (
                        <span
                          className={`mt-1.5 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${AI_VERDICT_BADGE[item.aiVerdict].className}`}
                        >
                          🤖 {AI_VERDICT_BADGE[item.aiVerdict].label}
                          {item.aiConfidence != null && ` · ${Math.round(item.aiConfidence * 100)}%`}
                        </span>
                      )}
                      <button
                        type="button"
                        className="block mt-1.5 text-xs text-orange-500"
                        onClick={() => navigate(detailPath(item), { state: { status } })}
                      >
                        查看详情 ›
                      </button>
```

- [ ] **Step 2: typecheck + build**

Run: `npm run build`
Expected: 通过。

- [ ] **Step 3: 手动验证（浏览器）**

1. 打开 `/admin/review`，切到"已通过"或其他非默认 tab。
2. 点某一条的"查看详情 ›"，确认跳转到对应详情页且内容正确。
3. 在详情页点返回箭头（或做出通过/驳回决定），确认回到 `/admin/review` 时**还停在刚才那个 tab**，不是被重置回"待审核"。
4. 确认 AI 徽标现在不可点击（没有展开/收起交互），列表卡片上已有的"通过"/"驳回"按钮仍正常工作。

- [ ] **Step 4: Commit**

```bash
git add src/pages/AdminReview.tsx
git commit -m "$(cat <<'EOF'
feat: link admin review list items to the new detail page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
