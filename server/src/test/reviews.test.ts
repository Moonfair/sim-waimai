import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { OrderDto, Page, Restaurant, ReviewDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { orders, reviews, users } from '../db/schema';
import { __awaitReviews } from '../lib/moderation';
import { __setReviewer } from '../lib/moderationProvider';
import { applyRatingDelta } from '../lib/ratings';
import { registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const cred = { username: `t_rev_${stamp}`, password: 'secret123' };
const adminCred = { username: `t_rev_a_${stamp}`, password: 'secret123' };
let cookie = '';
let adminCookie = '';
let userId = '';
let adminId = '';
const RID = 'kfc';
const RATING = 5;

let savedSecretId: string | undefined;
let savedSecretKey: string | undefined;
let savedAdmins: string | undefined;

function req(path: string, init?: { method?: string; body?: unknown }) {
  return app.request(path, {
    method: init?.method ?? 'GET',
    headers: {
      Cookie: cookie,
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/** 下单（不推进状态）。 */
async function placeOrder(): Promise<string> {
  const detail = (await (await app.request(`/api/restaurants/${RID}`)).json()) as Restaurant;
  const plain = detail.menu.find((m) => !m.optionGroups?.length)!;
  const qty = Math.max(1, Math.ceil(detail.minOrder / plain.price));
  const orderRes = await req('/api/orders', {
    method: 'POST',
    body: {
      restaurantId: RID,
      items: [{ menuItemId: plain.id, quantity: qty }],
      address: { recipientName: '', phone: '', address: '测试地址' },
    },
  });
  return ((await orderRes.json()) as OrderDto).id;
}

async function placeCompletedOrder(): Promise<string> {
  const id = await placeOrder();
  await req(`/api/orders/${id}/status`, { method: 'PATCH', body: { status: 'delivering' } });
  await req(`/api/orders/${id}/status`, { method: 'PATCH', body: { status: 'completed' } });
  return id;
}

async function shopAggregate(): Promise<{ rating: number; ratingCount: number }> {
  const detail = (await (await app.request(`/api/restaurants/${RID}`)).json()) as Restaurant;
  return { rating: detail.rating, ratingCount: detail.ratingCount };
}

/** 匿名视角的店铺评价列表（只含 approved）。 */
async function publicReviews(): Promise<ReviewDto[]> {
  const page = (await (
    await app.request(`/api/restaurants/${RID}/reviews?limit=50`)
  ).json()) as Page<ReviewDto>;
  return page.items;
}

beforeAll(async () => {
  // 无凭证：不注入 reviewer 时评价保持 pending，避免测试触网计费
  savedSecretId = process.env.TENCENT_MODERATION_SECRET_ID;
  savedSecretKey = process.env.TENCENT_MODERATION_SECRET_KEY;
  delete process.env.TENCENT_MODERATION_SECRET_ID;
  delete process.env.TENCENT_MODERATION_SECRET_KEY;

  savedAdmins = process.env.ADMIN_USERNAMES;
  process.env.ADMIN_USERNAMES = [savedAdmins, adminCred.username].filter(Boolean).join(',');

  const res = await registerTestUser(app, cred);
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  userId = ((await res.json()) as { id: string }).id;
  const adminRes = await registerTestUser(app, adminCred);
  adminCookie = (adminRes.headers.get('set-cookie') ?? '').split(';')[0];
  adminId = ((await adminRes.json()) as { id: string }).id;
});

afterAll(async () => {
  if (savedSecretId !== undefined) process.env.TENCENT_MODERATION_SECRET_ID = savedSecretId;
  if (savedSecretKey !== undefined) process.env.TENCENT_MODERATION_SECRET_KEY = savedSecretKey;
  if (savedAdmins === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = savedAdmins;
  // undo the aggregate bumps (only approved reviews were counted) so reruns don't drift kfc's rating
  const mine = await db.select().from(reviews).where(eq(reviews.userId, userId));
  await db.transaction(async (tx) => {
    for (const rev of mine) {
      await tx.delete(reviews).where(eq(reviews.id, rev.id));
      if (rev.reviewStatus === 'approved') {
        await applyRatingDelta(tx, rev.restaurantId, -rev.rating, -1);
      }
    }
  });
  await db.delete(orders).where(eq(orders.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(users).where(eq(users.id, adminId));
  await pool.end();
});

afterEach(() => {
  __setReviewer(null);
});

describe('order reviews（先审后发）', () => {
  it('cannot review before the order completes', async () => {
    const orderId = await placeOrder();
    const res = await req(`/api/orders/${orderId}/reviews`, {
      method: 'POST',
      body: { rating: RATING, content: '好吃' },
    });
    expect(res.status).toBe(400);
  });

  it('无审核结果时评价保持 pending：公开不可见、本人可见、聚合不变', async () => {
    const before = await shopAggregate();
    const orderId = await placeCompletedOrder();

    const res = await req(`/api/orders/${orderId}/reviews`, {
      method: 'POST',
      body: { rating: RATING, content: '汉堡分量很足，好吃！' },
    });
    expect(res.status).toBe(200);
    const review = (await res.json()) as ReviewDto;
    expect(review.reviewStatus).toBe('pending');
    await __awaitReviews();

    // 聚合不变（pending 不计分）
    expect(await shopAggregate()).toEqual(before);
    // 匿名列表不可见
    expect((await publicReviews()).some((r) => r.orderId === orderId)).toBe(false);
    // 本人可见，带审核状态
    const minePage = (await (
      await req(`/api/restaurants/${RID}/reviews?limit=50`)
    ).json()) as Page<ReviewDto>;
    const mine = minePage.items.find((r) => r.orderId === orderId);
    expect(mine).toBeDefined();
    expect(mine!.reviewStatus).toBe('pending');
    expect(mine!.username).toBe(cred.username);

    // 订单详情也带上评价及状态
    const order = (await (await req(`/api/orders/${orderId}`)).json()) as OrderDto;
    expect(order.review?.rating).toBe(RATING);
    expect(order.review?.reviewStatus).toBe('pending');
  });

  it('rejects a second review for the same order', async () => {
    const orderId = await placeCompletedOrder();
    await req(`/api/orders/${orderId}/reviews`, { method: 'POST', body: { rating: 4 } });
    const res = await req(`/api/orders/${orderId}/reviews`, {
      method: 'POST',
      body: { rating: 4 },
    });
    expect(res.status).toBe(409);
  });

  it('AI 通过：评价公开可见且聚合恰好 +1 条', async () => {
    __setReviewer(async () => ({ verdict: 'approve', reason: '正常评价', confidence: 0.97 }));
    const before = await shopAggregate();
    const orderId = await placeCompletedOrder();

    await req(`/api/orders/${orderId}/reviews`, {
      method: 'POST',
      body: { rating: RATING, content: '鸡翅外酥里嫩，值得回购' },
    });
    await __awaitReviews();

    const pub = (await publicReviews()).find((r) => r.orderId === orderId);
    expect(pub).toBeDefined();
    expect(pub!.reviewStatus).toBe('approved');

    const after = await shopAggregate();
    expect(after.ratingCount).toBe(before.ratingCount + 1);
    const expectedRating =
      Math.round(
        ((before.rating * before.ratingCount + RATING) / (before.ratingCount + 1)) * 10,
      ) / 10;
    expect(after.rating).toBeCloseTo(expectedRating, 1);
  });

  it('AI 驳回：公开不可见、本人可见驳回原因、聚合不变', async () => {
    __setReviewer(async () => ({ verdict: 'reject', reason: '文本命中「辱骂」', confidence: 0.95 }));
    const before = await shopAggregate();
    const orderId = await placeCompletedOrder();

    await req(`/api/orders/${orderId}/reviews`, {
      method: 'POST',
      body: { rating: 1, content: '难吃至极（假装是辱骂内容）' },
    });
    await __awaitReviews();

    expect(await shopAggregate()).toEqual(before);
    expect((await publicReviews()).some((r) => r.orderId === orderId)).toBe(false);

    const minePage = (await (
      await req(`/api/restaurants/${RID}/reviews?limit=50`)
    ).json()) as Page<ReviewDto>;
    const mine = minePage.items.find((r) => r.orderId === orderId);
    expect(mine).toBeDefined();
    expect(mine!.reviewStatus).toBe('rejected');
    expect(mine!.rejectReason).toBe('文本命中「辱骂」');
  });

  it('rejects invalid ratings', async () => {
    const orderId = await placeCompletedOrder();
    expect(
      (await req(`/api/orders/${orderId}/reviews`, { method: 'POST', body: { rating: 0 } })).status,
    ).toBe(400);
    expect(
      (await req(`/api/orders/${orderId}/reviews`, { method: 'POST', body: { rating: 6 } })).status,
    ).toBe(400);
  });
});

function adminReq(path: string, init?: { method?: string; body?: unknown }) {
  return app.request(path, {
    method: init?.method ?? 'GET',
    headers: {
      Cookie: adminCookie,
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

describe('admin 人工审核评价', () => {
  it('pending 评价进入队列，详情可见，通过后公开并计入聚合，推翻后回滚', async () => {
    const before = await shopAggregate();
    const orderId = await placeCompletedOrder();
    const submitted = (await (
      await req(`/api/orders/${orderId}/reviews`, {
        method: 'POST',
        body: { rating: RATING, content: '等待人工审核的评价' },
      })
    ).json()) as ReviewDto;
    await __awaitReviews(); // 无凭证：保持 pending

    // 队列可见
    const queue = (await (await adminReq('/api/admin/moderation?status=pending')).json()) as Array<{
      targetType: string;
      reviewId?: string;
      ownerUsername?: string | null;
      description?: string;
    }>;
    const entry = queue.find((m) => m.targetType === 'review' && m.reviewId === submitted.id);
    expect(entry).toBeDefined();
    expect(entry!.ownerUsername).toBe(cred.username);
    expect(entry!.description).toBe('等待人工审核的评价');

    // 详情
    const detailRes = await adminReq(`/api/admin/reviews/${submitted.id}`);
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      targetType: string;
      restaurantName: string;
      review: ReviewDto;
    };
    expect(detail.targetType).toBe('review');
    expect(detail.review.content).toBe('等待人工审核的评价');

    // 驳回必须填原因
    expect(
      (
        await adminReq(`/api/admin/reviews/${submitted.id}/review`, {
          method: 'POST',
          body: { decision: 'rejected' },
        })
      ).status,
    ).toBe(400);

    // 通过 → 公开可见 + 聚合 +1
    const approveRes = await adminReq(`/api/admin/reviews/${submitted.id}/review`, {
      method: 'POST',
      body: { decision: 'approved' },
    });
    expect(approveRes.status).toBe(200);
    expect((await publicReviews()).some((r) => r.id === submitted.id)).toBe(true);
    let agg = await shopAggregate();
    expect(agg.ratingCount).toBe(before.ratingCount + 1);

    // 推翻（approved → rejected）→ 公开不可见 + 聚合回滚
    const rejectRes = await adminReq(`/api/admin/reviews/${submitted.id}/review`, {
      method: 'POST',
      body: { decision: 'rejected', reason: '内容不实' },
    });
    expect(rejectRes.status).toBe(200);
    expect((await publicReviews()).some((r) => r.id === submitted.id)).toBe(false);
    agg = await shopAggregate();
    expect(agg.ratingCount).toBe(before.ratingCount);
    expect(agg.rating).toBeCloseTo(before.rating, 1);

    // 本人可见驳回原因
    const minePage = (await (
      await req(`/api/restaurants/${RID}/reviews?limit=50`)
    ).json()) as Page<ReviewDto>;
    const mine = minePage.items.find((r) => r.id === submitted.id);
    expect(mine!.reviewStatus).toBe('rejected');
    expect(mine!.rejectReason).toBe('内容不实');
  });

  it('admin review endpoints are admin-only and 404 on unknown id', async () => {
    expect((await req('/api/admin/reviews/00000000-0000-0000-0000-000000000000')).status).toBe(403);
    expect(
      (await adminReq('/api/admin/reviews/00000000-0000-0000-0000-000000000000')).status,
    ).toBe(404);
    expect((await adminReq('/api/admin/reviews/not-a-uuid')).status).toBe(404);
  });
});
