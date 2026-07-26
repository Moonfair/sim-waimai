# 已通过页面拆分 AI 审核通过 / 已人工核验 子页签 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the admin review "已通过" tab into two sub-tabs — "AI审核通过" (AI-decided, not yet human-checked) and "已人工核验" (human-confirmed) — and let admins batch/single "复审通过" or "驳回" items in the AI-approved queue.

**Architecture:** No schema changes. The two buckets are derived from the existing `reviewStatus`/`reviewedBy` columns (`reviewedBy === 'ai'` vs not). The backend gains one optional query param (`reviewer=ai|human`) on the existing moderation list endpoint; "复审通过"/"驳回" reuse the existing single/batch decision endpoints verbatim — approving an AI-bucket item just overwrites `reviewedBy` to the admin's username, which is what moves it into the human bucket on next fetch.

**Tech Stack:** Hono + Drizzle ORM + Zod (server), React + react-router-dom `useSearchParams` (client), Vitest for server tests.

## Global Constraints

- No new `ReviewStatus` enum values, no DB migration (per design doc `docs/superpowers/specs/2026-07-26-approved-review-subtabs-design.md`).
- `reviewer` query param only ever sent by the frontend when `status=approved`.
- `LIST_LIMIT = 100` cap must apply per-bucket at the DB query level (not by fetching a mixed list and slicing client-side).
- No new frontend test framework — verify the UI manually via the dev server (per user-approved design doc).

---

### Task 1: Backend — `reviewer` filter on `GET /admin/moderation`

**Files:**
- Modify: `server/src/routes/admin.ts:1` (imports), `server/src/routes/admin.ts:142-152` (add helper near `decisionFields`), `server/src/routes/admin.ts:210-249` (the `.get('/moderation', ...)` handler)
- Test: Create `server/src/test/moderationApprovedSubtabs.test.ts`

**Interfaces:**
- Consumes: existing `restaurants.reviewedBy`, `menuItems.reviewedBy`, `reviews.reviewedBy` Drizzle columns (all `text('reviewed_by')`); existing `applyRestaurantDecision`/`db.update` patterns already used in `server/src/test/moderationBatch.test.ts`.
- Produces: `GET /admin/moderation?status=approved&reviewer=ai|human` — same `ModerationItemDto[]` response shape as today, now filtered. Invalid `reviewer` value → `400 { error: '无效的审核人筛选' }`. No behavior change when `reviewer` is omitted.

- [ ] **Step 1: Write the failing test**

Create `server/src/test/moderationApprovedSubtabs.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { BatchReviewResultDto, MerchantRestaurantDto, ModerationItemDto, UserDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { restaurants, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_sub_a_${stamp}`, password: 'secret123' };
const owner = { username: `t_sub_o_${stamp}`, password: 'secret123' };
let adminCookie = '';
let ownerCookie = '';
let ownerId = '';
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

async function listApproved(reviewer?: string): Promise<Response> {
  const qs = reviewer ? `&reviewer=${reviewer}` : '';
  return req(`/api/admin/moderation?status=approved${qs}`, adminCookie);
}

beforeAll(async () => {
  savedAdmins = process.env.ADMIN_USERNAMES;
  process.env.ADMIN_USERNAMES = [savedAdmins, admin.username].filter(Boolean).join(',');
  const a = await register(admin);
  adminCookie = a.cookie;
  expect(a.user.isAdmin).toBe(true);
  const o = await register(owner);
  ownerCookie = o.cookie;
  ownerId = o.user.id;
});

afterAll(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = savedAdmins;
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId));
  await db.delete(users).where(inArray(users.username, [admin.username, owner.username]));
  await pool.end();
});

describe('GET /api/admin/moderation reviewer 子页签过滤', () => {
  it('rejects an invalid reviewer value', async () => {
    const res = await req('/api/admin/moderation?status=approved&reviewer=bogus', adminCookie);
    expect(res.status).toBe(400);
  });

  it('splits AI-approved, human-approved, and never-reviewed-but-approved rows correctly', async () => {
    const aiShop = await createShop(`子页签AI店_${stamp}`);
    await db
      .update(restaurants)
      .set({ reviewStatus: 'approved', reviewedBy: 'ai', aiVerdict: 'approve', aiReason: '测试' })
      .where(eq(restaurants.id, aiShop.id));

    const humanShop = await createShop(`子页签人工店_${stamp}`);
    const approveRes = await req(`/api/admin/restaurants/${humanShop.id}/review`, adminCookie, {
      method: 'POST',
      body: { decision: 'approved' },
    });
    expect(approveRes.status).toBe(200);

    const seedShop = await createShop(`子页签种子店_${stamp}`);
    // 模拟从未走过审核流程、直接标记 approved 的平台种子数据：reviewedBy 保持 null。
    await db.update(restaurants).set({ reviewStatus: 'approved' }).where(eq(restaurants.id, seedShop.id));

    const aiList = (await (await listApproved('ai')).json()) as ModerationItemDto[];
    const aiIds = aiList.filter((i) => i.targetType === 'restaurant').map((i) => i.restaurantId);
    expect(aiIds).toContain(aiShop.id);
    expect(aiIds).not.toContain(humanShop.id);
    expect(aiIds).not.toContain(seedShop.id);

    const humanList = (await (await listApproved('human')).json()) as ModerationItemDto[];
    const humanIds = humanList.filter((i) => i.targetType === 'restaurant').map((i) => i.restaurantId);
    expect(humanIds).toContain(humanShop.id);
    expect(humanIds).toContain(seedShop.id);
    expect(humanIds).not.toContain(aiShop.id);

    // 复审通过（同一条批量决策接口，仅覆盖 reviewedBy）后应从 AI 桶移入人工桶
    const batchRes = await req('/api/admin/moderation/review', adminCookie, {
      method: 'POST',
      body: { targets: [{ targetType: 'restaurant', restaurantId: aiShop.id }], decision: 'approved' },
    });
    expect(batchRes.status).toBe(200);
    expect(((await batchRes.json()) as BatchReviewResultDto).succeeded).toBe(1);

    const aiListAfter = (await (await listApproved('ai')).json()) as ModerationItemDto[];
    expect(aiListAfter.some((i) => i.targetType === 'restaurant' && i.restaurantId === aiShop.id)).toBe(false);
    const humanListAfter = (await (await listApproved('human')).json()) as ModerationItemDto[];
    const movedRow = humanListAfter.find((i) => i.targetType === 'restaurant' && i.restaurantId === aiShop.id);
    expect(movedRow?.reviewedBy).toBe(admin.username);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w server run test -- moderationApprovedSubtabs`

Expected: FAIL — `reviewer=bogus` currently returns 200 (param is silently ignored), so the first assertion (`expect(res.status).toBe(400)`) fails; and/or the AI/human bucket assertions fail because today's endpoint returns the same mixed list for both.

- [ ] **Step 3: Implement the `reviewer` filter**

In `server/src/routes/admin.ts`, change the import line (line 1) to:

```ts
import { and, asc, desc, eq, isNull, ne, or } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';
```

Add `reviewerSchema` next to `statusSchema` (near line 21):

```ts
const statusSchema = z.enum(['pending', 'approved', 'rejected']);
const reviewerSchema = z.enum(['ai', 'human']).optional();
```

Add a helper right after `decisionFields` (after line 152, before `applyRestaurantDecision`):

```ts
/** AI 桶：reviewedBy === 'ai'；人工桶：reviewedBy 为空（从未审核过的种子数据）或不是 'ai'。 */
function reviewerCondition(reviewedByColumn: AnyColumn, reviewer: 'ai' | 'human' | undefined) {
  if (reviewer === 'ai') return eq(reviewedByColumn, 'ai');
  if (reviewer === 'human') return or(isNull(reviewedByColumn), ne(reviewedByColumn, 'ai'));
  return undefined;
}
```

Replace the `.get('/moderation', ...)` handler (lines 211-249) with:

```ts
  .get('/moderation', requireAdmin, async (c) => {
    const parsed = statusSchema.safeParse(c.req.query('status') ?? 'pending');
    if (!parsed.success) return c.json({ error: '无效的审核状态' }, 400);
    const status: ReviewStatus = parsed.data;

    const reviewerParsed = reviewerSchema.safeParse(c.req.query('reviewer'));
    if (!reviewerParsed.success) return c.json({ error: '无效的审核人筛选' }, 400);
    const reviewer = reviewerParsed.data;

    // 店铺和商品合并为一个列表；演示场景不做游标分页，各取前 LIST_LIMIT 条。
    const shopReviewerCond = reviewerCondition(restaurants.reviewedBy, reviewer);
    const shopRows = await db
      .select({ restaurant: restaurants, ownerUsername: users.username })
      .from(restaurants)
      .leftJoin(users, eq(users.id, restaurants.ownerId))
      .where(
        shopReviewerCond ? and(eq(restaurants.reviewStatus, status), shopReviewerCond) : eq(restaurants.reviewStatus, status),
      )
      .orderBy(desc(restaurants.createdAt))
      .limit(LIST_LIMIT);

    const itemReviewerCond = reviewerCondition(menuItems.reviewedBy, reviewer);
    const itemRows = await db
      .select({ item: menuItems, restaurantName: restaurants.name, ownerUsername: users.username })
      .from(menuItems)
      .innerJoin(restaurants, eq(restaurants.id, menuItems.restaurantId))
      .leftJoin(users, eq(users.id, restaurants.ownerId))
      .where(
        itemReviewerCond ? and(eq(menuItems.reviewStatus, status), itemReviewerCond) : eq(menuItems.reviewStatus, status),
      )
      .orderBy(asc(menuItems.restaurantId), asc(menuItems.sortOrder))
      .limit(LIST_LIMIT);

    const reviewReviewerCond = reviewerCondition(reviews.reviewedBy, reviewer);
    const reviewRows = await db
      .select({ review: reviews, restaurantName: restaurants.name, authorUsername: users.username })
      .from(reviews)
      .innerJoin(restaurants, eq(restaurants.id, reviews.restaurantId))
      .innerJoin(users, eq(users.id, reviews.userId))
      .where(
        reviewReviewerCond ? and(eq(reviews.reviewStatus, status), reviewReviewerCond) : eq(reviews.reviewStatus, status),
      )
      .orderBy(desc(reviews.createdAt))
      .limit(LIST_LIMIT);

    const list: ModerationItemDto[] = [
      ...shopRows.map((r) => toRestaurantModerationItem(r.restaurant, r.ownerUsername)),
      ...itemRows.map((r) => toItemModerationItem(r.item, r.restaurantName, r.ownerUsername)),
      ...reviewRows.map((r) => toUserReviewModerationItem(r.review, r.restaurantName, r.authorUsername)),
    ];
    return c.json(list);
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w server run test -- moderationApprovedSubtabs`

Expected: PASS (all assertions green).

- [ ] **Step 5: Run the full server test suite to check for regressions**

Run: `npm -w server run test`

Expected: PASS (no regressions in `moderationBatch.test.ts` or others — the `reviewer` param is optional and defaults to no-op).

- [ ] **Step 6: Typecheck**

Run: `npm -w server run typecheck`

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/admin.ts server/src/test/moderationApprovedSubtabs.test.ts
git commit -m "feat(admin): GET /admin/moderation 支持 reviewer=ai|human 子页签过滤"
```

---

### Task 2: Frontend — AI审核通过 / 已人工核验 sub-tabs in `AdminReview.tsx`

**Files:**
- Modify: `src/pages/AdminReview.tsx`

**Interfaces:**
- Consumes: `GET /admin/moderation?status=approved&reviewer=ai|human` from Task 1 (same `ModerationItemDto[]` shape as before — `reviewer` is purely a server-side filter, no new response fields).
- Produces: no exported interface change — this is a leaf page component.

No new automated test here (per design doc — no existing frontend test harness for this page; verified manually in Task 4). Steps are direct edits, each followed by a build check.

- [ ] **Step 1: Add the `REVIEWER_TABS` constant and reviewer state**

Directly below the existing `STATUS_TABS` constant (`src/pages/AdminReview.tsx:14-18`), add:

```ts
const REVIEWER_TABS: { value: 'ai' | 'human'; label: string }[] = [
  { value: 'ai', label: 'AI审核通过' },
  { value: 'human', label: '已人工核验' },
];
```

Inside the component, right after the existing `status` derivation (`src/pages/AdminReview.tsx:50-53`), add:

```ts
  const reviewerParam = searchParams.get('reviewer');
  const reviewer: 'ai' | 'human' = REVIEWER_TABS.some((t) => t.value === reviewerParam)
    ? (reviewerParam as 'ai' | 'human')
    : 'ai';
  const isAiApprovedTab = status === 'approved' && reviewer === 'ai';
```

- [ ] **Step 2: Wire `reviewer` into the list fetch URL**

Replace the `useApi` call (`src/pages/AdminReview.tsx:54-56`):

```ts
  const { data: items, loading, error, reload } = useApi<ModerationItemDto[]>(
    status === 'approved' ? `/admin/moderation?status=${status}&reviewer=${reviewer}` : `/admin/moderation?status=${status}`,
  );
```

- [ ] **Step 3: Widen the selection/batch-bar gate to include the AI审核通过 sub-tab**

Replace line `src/pages/AdminReview.tsx:68`:

```ts
  const showBatchBar = (status === 'pending' || isAiApprovedTab) && selectedKeys.size > 0;
```

- [ ] **Step 4: Render the second-level tab bar**

Directly after the closing `</div>` of the existing status-tab bar (`src/pages/AdminReview.tsx:144-162`, i.e. right after the `{/* Status filter */}` block, still inside the header `<div>`), add:

```tsx
        {status === 'approved' && (
          <div className="flex gap-2 mt-2">
            {REVIEWER_TABS.map((tab) => (
              <button
                key={tab.value}
                className={`text-xs px-3 py-1.5 rounded-full font-medium ${
                  reviewer === tab.value
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                }`}
                onClick={() => {
                  setSearchParams({ status, reviewer: tab.value }, { replace: true });
                  setRejectingKey(null);
                  clearSelection();
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
```

Also update the existing top-level tab `onClick` (`src/pages/AdminReview.tsx:153-157`) so switching *into* 已通过 always resets to the AI审核通过 sub-tab, and switching *away* drops the stale `reviewer` param:

```tsx
              onClick={() => {
                setSearchParams(
                  tab.value === 'approved' ? { status: tab.value, reviewer: 'ai' } : { status: tab.value },
                  { replace: true },
                );
                setRejectingKey(null);
                clearSelection();
              }}
```

- [ ] **Step 5: Show checkboxes on the AI审核通过 sub-tab**

Replace the two `status === 'pending'` conditions that gate the checkbox UI:

`src/pages/AdminReview.tsx:187` (select-all row):
```tsx
            {(status === 'pending' || isAiApprovedTab) && (
```

`src/pages/AdminReview.tsx:211` (per-row checkbox):
```tsx
                    {(status === 'pending' || isAiApprovedTab) && (
```

- [ ] **Step 6: Relabel the per-item "通过"/"复审通过" button**

Replace the approve-button block (`src/pages/AdminReview.tsx:329-337`):

```tsx
                      {(item.reviewStatus !== 'approved' || isAiApprovedTab) && (
                        <button
                          className="flex-1 bg-green-500 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
                          disabled={busy}
                          onClick={() => review(item, 'approved')}
                        >
                          {busy ? '提交中…' : isAiApprovedTab ? '复审通过' : '通过'}
                        </button>
                      )}
```

- [ ] **Step 7: Relabel the batch-bar "批量通过"/"批量复审通过" button**

Replace the batch approve button (`src/pages/AdminReview.tsx:388-394`):

```tsx
                <button
                  className="flex-1 bg-green-500 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
                  disabled={batchSubmitting}
                  onClick={() => batchReview('approved')}
                >
                  {batchSubmitting
                    ? '提交中…'
                    : `${isAiApprovedTab ? '批量复审通过' : '批量通过'} ${selectedKeys.size} 条`}
                </button>
```

- [ ] **Step 8: Typecheck and lint**

Run: `npm run build` (runs `tsc -b && vite build`) and `npm run lint`

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/pages/AdminReview.tsx
git commit -m "feat(admin): 已通过 Tab 拆分 AI审核通过/已人工核验 子页签，支持复审通过/驳回"
```

---

### Task 3: Frontend — "复审通过" button on the detail page

**Files:**
- Modify: `src/pages/AdminReviewDetail.tsx`

**Interfaces:**
- Consumes: `ModerationRestaurantDetailDto | ModerationItemDetailDto | ModerationUserReviewDetailDto` (unchanged, already includes `reviewStatus` and `reviewedBy`).
- Produces: no interface change.

- [ ] **Step 1: Show and relabel the approve button for AI-approved items**

Replace the approve-button block (`src/pages/AdminReviewDetail.tsx:276-284`):

```tsx
            {(data.reviewStatus !== 'approved' || data.reviewedBy === 'ai') && (
              <button
                className="flex-1 bg-green-500 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
                disabled={submitting}
                onClick={() => review('approved')}
              >
                {submitting ? '提交中…' : data.reviewStatus === 'approved' ? '复审通过' : '通过'}
              </button>
            )}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run build` and `npm run lint`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/AdminReviewDetail.tsx
git commit -m "feat(admin): 审核详情页对 AI 通过项目展示复审通过按钮"
```

---

### Task 4: Manual verification via dev server

**Files:** none (verification only, no code changes expected — if a bug is found, fix it in the relevant file from Task 1-3 and re-run the affected step).

- [ ] **Step 1: Start Postgres and the app**

```bash
npm run db:up
npm run db:migrate
npm run dev
```

Confirm `.env` has `ADMIN_USERNAMES` set to a username you control (add yourself if not already set, then restart `npm run dev`).

- [ ] **Step 2: Create two test shops as a normal (non-admin) user**

In the browser: register/login as a non-admin user, use "我要开店" (merchant onboarding) to create two shops, e.g. "AI通过测试店" and "AI驳回测试店". Both land `pending`.

- [ ] **Step 3: Simulate AI approval for both shops via psql**

```bash
docker exec -it sim-waimai-db psql -U postgres -d sim_waimai -c \
  "UPDATE restaurants SET review_status='approved', reviewed_by='ai', ai_verdict='approve', ai_reason='测试' WHERE name IN ('AI通过测试店','AI驳回测试店');"
```

- [ ] **Step 4: Verify the AI审核通过 sub-tab**

Login as the admin user, go to `/admin/review`, click 已通过. Confirm:
- It defaults to the "AI审核通过" sub-tab (highlighted orange).
- Both test shops appear, each showing "审核人：AI" and a green "复审通过" button (not "通过").
- A checkbox appears on each row and a "全选" row appears above the list (same as on 待审核).

- [ ] **Step 5: Batch 复审通过 one shop**

Select "AI通过测试店" via its checkbox. Confirm the bottom action bar appears with "批量复审通过 1 条" / "批量驳回". Click "批量复审通过 1 条". Confirm:
- A success flash appears and the shop disappears from the AI审核通过 list.
- Switch to the "已人工核验" sub-tab — the shop now appears there, showing "审核人：`<your admin username>`" instead of AI.
- Open the shop's public restaurant page (or the homepage list) and confirm it's still visible to customers (approval didn't change visibility).

- [ ] **Step 6: Single-item 驳回 the other shop**

Back on the AI审核通过 sub-tab, find "AI驳回测试店", click its "驳回" button, type a reason, confirm. Confirm:
- The shop disappears from AI审核通过.
- Switch to the top-level "已驳回" tab — the shop appears there with the reason shown.
- Confirm it's no longer visible in the public restaurant list (its `reviewStatus` is now `rejected`).

- [ ] **Step 7: Verify the detail page's 复审通过 button**

Simulate one more AI-approved shop the same way as Step 3. From the AI审核通过 list, click "查看详情" on it. Confirm the detail page also shows a "复审通过" button (not hidden), and clicking it navigates back to the list with the shop now gone from AI审核通过.

- [ ] **Step 8: Clean up test data**

```bash
docker exec -it sim-waimai-db psql -U postgres -d sim_waimai -c \
  "DELETE FROM restaurants WHERE name IN ('AI通过测试店','AI驳回测试店');"
```

(Adjust the `DELETE` to also cover any additional shop created in Step 7.)

No commit for this task — it's verification only.
