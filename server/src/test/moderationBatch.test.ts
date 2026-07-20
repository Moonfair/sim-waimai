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

  it('batch reject without a reason succeeds and leaves rejectReason null', async () => {
    const shop = await createShop(`批量驳回无原因店_${stamp}`);
    const res = await batchReview({
      targets: [{ targetType: 'restaurant', restaurantId: shop.id }],
      decision: 'rejected',
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as BatchReviewResultDto).succeeded).toBe(1);
    const [shopRow] = await db.select().from(restaurants).where(eq(restaurants.id, shop.id));
    expect(shopRow!.reviewStatus).toBe('rejected');
    expect(shopRow!.rejectReason).toBeNull();
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
