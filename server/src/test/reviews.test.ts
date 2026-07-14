import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { OrderDto, Page, Restaurant, ReviewDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { orders, restaurants, reviews, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

const app = createApp();
const cred = { username: `t_rev_${Date.now().toString(36)}`, password: 'secret123' };
let cookie = '';
let userId = '';
let orderId = '';
const RID = 'kfc';
const RATING = 5;

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

beforeAll(async () => {
  const res = await registerTestUser(app, cred);
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  userId = ((await res.json()) as { id: string }).id;

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
  orderId = ((await orderRes.json()) as OrderDto).id;
});

afterAll(async () => {
  // undo the aggregate bump so reruns don't drift kfc's rating
  const [rev] = await db.select().from(reviews).where(eq(reviews.userId, userId));
  if (rev) {
    await db.transaction(async (tx) => {
      await tx.delete(reviews).where(eq(reviews.id, rev.id));
      await tx
        .update(restaurants)
        .set({
          ratingSum: sql`${restaurants.ratingSum} - ${rev.rating}`,
          ratingCount: sql`${restaurants.ratingCount} - 1`,
          rating: sql`ROUND((${restaurants.ratingSum} - ${rev.rating})::numeric / NULLIF(${restaurants.ratingCount} - 1, 0), 1)`,
        })
        .where(eq(restaurants.id, rev.restaurantId));
    });
  }
  await db.delete(orders).where(eq(orders.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

describe('order reviews', () => {
  it('cannot review before the order completes', async () => {
    const res = await req(`/api/orders/${orderId}/reviews`, {
      method: 'POST',
      body: { rating: RATING, content: '好吃' },
    });
    expect(res.status).toBe(400);
  });

  it('review after completion updates the restaurant aggregate exactly', async () => {
    await req(`/api/orders/${orderId}/status`, { method: 'PATCH', body: { status: 'delivering' } });
    await req(`/api/orders/${orderId}/status`, { method: 'PATCH', body: { status: 'completed' } });

    const before = (await (await app.request(`/api/restaurants/${RID}`)).json()) as Restaurant;

    const res = await req(`/api/orders/${orderId}/reviews`, {
      method: 'POST',
      body: { rating: RATING, content: '汉堡分量很足，好吃！' },
    });
    expect(res.status).toBe(200);
    const review = (await res.json()) as ReviewDto;
    expect(review.rating).toBe(RATING);

    const after = (await (await app.request(`/api/restaurants/${RID}`)).json()) as Restaurant;
    expect(after.ratingCount).toBe(before.ratingCount + 1);
    const expectedRating =
      Math.round(((before.rating * before.ratingCount + RATING) / (before.ratingCount + 1)) * 10) / 10;
    expect(after.rating).toBeCloseTo(expectedRating, 1);
  });

  it('rejects a second review for the same order', async () => {
    const res = await req(`/api/orders/${orderId}/reviews`, {
      method: 'POST',
      body: { rating: 4 },
    });
    expect(res.status).toBe(409);
  });

  it('review appears in the restaurant review list with username', async () => {
    const res = await app.request(`/api/restaurants/${RID}/reviews`);
    expect(res.status).toBe(200);
    const page = (await res.json()) as Page<ReviewDto>;
    const mine = page.items.find((r) => r.orderId === orderId);
    expect(mine).toBeDefined();
    expect(mine!.username).toBe(cred.username);
    expect(mine!.content).toContain('汉堡');
  });

  it('order detail includes the review', async () => {
    const res = await req(`/api/orders/${orderId}`);
    const order = (await res.json()) as OrderDto;
    expect(order.review?.rating).toBe(RATING);
  });

  it('rejects invalid ratings', async () => {
    expect(
      (
        await req(`/api/orders/${orderId}/reviews`, { method: 'POST', body: { rating: 0 } })
      ).status,
    ).toBe(400);
    expect(
      (
        await req(`/api/orders/${orderId}/reviews`, { method: 'POST', body: { rating: 6 } })
      ).status,
    ).toBe(400);
  });
});
