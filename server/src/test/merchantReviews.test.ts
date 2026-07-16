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
import { __awaitReviews } from '../lib/moderation';
import { __setReviewer } from '../lib/moderationProvider';
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

let savedSecretId: string | undefined;
let savedSecretKey: string | undefined;

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

async function merchantReviews(): Promise<MerchantReviewDto[]> {
  const res = await req(`/api/merchant/restaurants/${shopId}/reviews?limit=50`, ownerCookie);
  return ((await res.json()) as Page<MerchantReviewDto>).items;
}

async function publicReviews(): Promise<ReviewDto[]> {
  const page = (await (
    await app.request(`/api/restaurants/${shopId}/reviews?limit=50`)
  ).json()) as Page<ReviewDto>;
  return page.items;
}

beforeAll(async () => {
  // 无凭证：不注入 reviewer 时评价保持 pending，避免测试触网计费（同 reviews.test.ts）
  savedSecretId = process.env.TENCENT_MODERATION_SECRET_ID;
  savedSecretKey = process.env.TENCENT_MODERATION_SECRET_KEY;
  delete process.env.TENCENT_MODERATION_SECRET_ID;
  delete process.env.TENCENT_MODERATION_SECRET_KEY;

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

  // 顾客下单 → 完成 → 评价；AI 桩直接通过（先审后发），店铺聚合变为 sum=4 count=1 rating=4
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
  __setReviewer(async () => ({ verdict: 'approve', reason: '正常评价', confidence: 0.97 }));
  const revRes = await req(`/api/orders/${orderId}/reviews`, customerCookie, {
    method: 'POST',
    body: { rating: RATING, content: '面很筋道，好评' },
  });
  reviewId = ((await revRes.json()) as ReviewDto).id;
  await __awaitReviews();
  __setReviewer(null);
});

afterAll(async () => {
  if (savedSecretId !== undefined) process.env.TENCENT_MODERATION_SECRET_ID = savedSecretId;
  if (savedSecretKey !== undefined) process.env.TENCENT_MODERATION_SECRET_KEY = savedSecretKey;
  await db.delete(reviews).where(eq(reviews.restaurantId, shopId));
  await db.delete(orders).where(eq(orders.restaurantId, shopId));
  await db.delete(restaurants).where(eq(restaurants.id, shopId));
  await db.delete(users).where(eq(users.username, owner.username));
  await db.delete(users).where(eq(users.username, customer.username));
  await db.delete(users).where(eq(users.username, rando.username));
  await pool.end();
});

describe('merchant review list', () => {
  it('owner sees the approved review with hidden=false and username', async () => {
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

  it('unapproved (pending) reviews are not listed for the merchant', async () => {
    await db.update(reviews).set({ reviewStatus: 'pending' }).where(eq(reviews.id, reviewId));
    expect((await merchantReviews()).find((r) => r.id === reviewId)).toBeUndefined();
    await db.update(reviews).set({ reviewStatus: 'approved' }).where(eq(reviews.id, reviewId));
  });

  it('hidden review disappears from the public list but stays in the merchant list', async () => {
    await db.update(reviews).set({ hiddenAt: new Date() }).where(eq(reviews.id, reviewId));

    expect((await publicReviews()).find((r) => r.id === reviewId)).toBeUndefined();
    expect((await merchantReviews()).find((r) => r.id === reviewId)?.hidden).toBe(true);

    // 复原，避免影响后续用例（聚合未动过：这里是直接改 DB，不走接口）
    await db.update(reviews).set({ hiddenAt: null }).where(eq(reviews.id, reviewId));
  });
});
