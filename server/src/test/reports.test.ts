import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type {
  AdminReportDto,
  MerchantMenuItemDto,
  MerchantRestaurantDto,
  OrderDto,
  ResolveReportsResultDto,
  ReviewDto,
  UserDto,
} from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { orders, reports, restaurants, reviews, users } from '../db/schema';
import { grantRole, registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_rpt_a_${stamp}`, password: 'secret123' };
const owner = { username: `t_rpt_o_${stamp}`, password: 'secret123' };
const customer = { username: `t_rpt_c_${stamp}`, password: 'secret123' };
let adminCookie = '';
let ownerCookie = '';
let customerCookie = '';
let ownerId = '';
let customerId = '';

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
  await req(`/api/orders/${orderId}/status`, customerCookie, { method: 'PATCH', body: { status: 'delivering' } });
  await req(`/api/orders/${orderId}/status`, customerCookie, { method: 'PATCH', body: { status: 'completed' } });
  const revRes = await req(`/api/orders/${orderId}/reviews`, customerCookie, {
    method: 'POST',
    body: { rating, content: '举报测试评价' },
  });
  expect(revRes.status).toBe(200);
  return ((await revRes.json()) as ReviewDto).id;
}

function createReport(body: unknown, cookie = customerCookie) {
  return req('/api/reports', cookie, { method: 'POST', body });
}

function listReports(cookie = adminCookie) {
  return req('/api/admin/reports', cookie);
}

function resolveReports(body: unknown, cookie = adminCookie) {
  return req('/api/admin/reports/resolve', cookie, { method: 'POST', body });
}

async function shopAggregate(shopId: string): Promise<{ ratingSum: number; ratingCount: number }> {
  const [row] = await db
    .select({ ratingSum: restaurants.ratingSum, ratingCount: restaurants.ratingCount })
    .from(restaurants)
    .where(eq(restaurants.id, shopId));
  return row!;
}

beforeAll(async () => {
  savedSecretId = process.env.TENCENT_MODERATION_SECRET_ID;
  savedSecretKey = process.env.TENCENT_MODERATION_SECRET_KEY;
  delete process.env.TENCENT_MODERATION_SECRET_ID;
  delete process.env.TENCENT_MODERATION_SECRET_KEY;

  const a = await register(admin);
  adminCookie = a.cookie;
  await grantRole(admin.username, 'admin');
  const o = await register(owner);
  ownerCookie = o.cookie;
  ownerId = o.user.id;
  const cu = await register(customer);
  customerCookie = cu.cookie;
  customerId = cu.user.id;
});

afterAll(async () => {
  if (savedSecretId !== undefined) process.env.TENCENT_MODERATION_SECRET_ID = savedSecretId;
  if (savedSecretKey !== undefined) process.env.TENCENT_MODERATION_SECRET_KEY = savedSecretKey;
  await db.delete(reports).where(eq(reports.reporterId, customerId));
  await db.delete(reviews).where(eq(reviews.userId, customerId));
  await db.delete(orders).where(eq(orders.userId, customerId));
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId)); // cascades menu_items + reports
  await db.delete(users).where(inArray(users.username, [admin.username, owner.username, customer.username]));
  await pool.end();
});

describe('POST /api/reports', () => {
  it('rejects anonymous (401)', async () => {
    const res = await app.request('/api/reports', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('validates the request body (missing/blank reason, unknown targetType)', async () => {
    const shop = await createShop(`举报校验店_${stamp}`);
    expect((await createReport({ targetType: 'restaurant', restaurantId: shop.id })).status).toBe(400);
    expect(
      (await createReport({ targetType: 'restaurant', restaurantId: shop.id, reason: '   ' })).status,
    ).toBe(400);
    expect((await createReport({ targetType: 'unknown', reason: '不存在的类型' })).status).toBe(400);
  });

  it('404s when the target does not exist', async () => {
    expect(
      (await createReport({ targetType: 'restaurant', restaurantId: 'does-not-exist', reason: '测试' })).status,
    ).toBe(404);
    expect(
      (
        await createReport({
          targetType: 'menuItem',
          restaurantId: 'does-not-exist',
          itemId: 'x',
          reason: '测试',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await createReport({
          targetType: 'review',
          reviewId: '00000000-0000-4000-8000-000000000000',
          reason: '测试',
        })
      ).status,
    ).toBe(404);
  });

  it('creates a report for an existing restaurant/menuItem/review', async () => {
    const shop = await createShop(`举报创建店_${stamp}`);
    const shopRes = await createReport({ targetType: 'restaurant', restaurantId: shop.id, reason: '涉嫌售假' });
    expect(shopRes.status).toBe(201);
    expect(typeof ((await shopRes.json()) as { id: string }).id).toBe('string');

    const item = await createItem(shop.id, '举报测试菜');
    const itemRes = await createReport({
      targetType: 'menuItem',
      restaurantId: shop.id,
      itemId: item.id,
      reason: '图文不符',
    });
    expect(itemRes.status).toBe(201);

    await approveShop(shop.id);
    await approveItem(shop.id, item.id);
    const reviewId = await createPendingReview(shop.id, item.id, 5);
    const reviewRes = await createReport({ targetType: 'review', reviewId, reason: '恶意刷分' });
    expect(reviewRes.status).toBe(201);
  });
});

describe('GET /api/admin/reports', () => {
  it('rejects anonymous (401) and non-admin (403)', async () => {
    expect((await app.request('/api/admin/reports')).status).toBe(401);
    expect((await listReports(customerCookie)).status).toBe(403);
  });

  it('lists reports with joined target/reporter info for all three target types', async () => {
    const shop = await createShop(`举报列表店_${stamp}`);
    const item = await createItem(shop.id, '举报列表菜');
    await approveShop(shop.id);
    await approveItem(shop.id, item.id);
    const reviewId = await createPendingReview(shop.id, item.id, 3);

    await createReport({ targetType: 'restaurant', restaurantId: shop.id, reason: '店铺举报原因' });
    await createReport({ targetType: 'menuItem', restaurantId: shop.id, itemId: item.id, reason: '菜品举报原因' });
    await createReport({ targetType: 'review', reviewId, reason: '评价举报原因' });

    const res = await listReports();
    expect(res.status).toBe(200);
    const list = (await res.json()) as AdminReportDto[];

    const shopReport = list.find((r) => r.targetType === 'restaurant' && r.restaurantId === shop.id);
    expect(shopReport?.name).toBe(shop.name);
    expect(shopReport?.reason).toBe('店铺举报原因');
    expect(shopReport?.reporterUsername).toBe(customer.username);

    const itemReport = list.find((r) => r.targetType === 'menuItem' && r.itemId === item.id);
    expect(itemReport?.name).toBe('举报列表菜');
    expect(itemReport?.restaurantName).toBe(shop.name);
    expect(itemReport?.reason).toBe('菜品举报原因');

    const reviewReport = list.find((r) => r.targetType === 'review' && r.reviewId === reviewId);
    expect(reviewReport?.name).toBe(customer.username);
    expect(reviewReport?.rating).toBe(3);
    expect(reviewReport?.reason).toBe('评价举报原因');
  });
});

describe('POST /api/admin/reports/resolve', () => {
  it('rejects anonymous (401) and non-admin (403)', async () => {
    expect((await app.request('/api/admin/reports/resolve', { method: 'POST' })).status).toBe(401);
    expect((await resolveReports({ reportIds: ['x'], decision: 'approved' }, customerCookie)).status).toBe(403);
  });

  it('approved: pushes the target through the 审核失败 path using the report reason, then deletes the report row', async () => {
    const shop = await createShop(`举报通过店_${stamp}`);
    await approveShop(shop.id);
    const created = await createReport({ targetType: 'restaurant', restaurantId: shop.id, reason: '实锤售假' });
    const { id: reportId } = (await created.json()) as { id: string };

    const res = await resolveReports({ reportIds: [reportId], decision: 'approved' });
    expect(res.status).toBe(200);
    const result = (await res.json()) as ResolveReportsResultDto;
    expect(result.succeeded).toBe(1);
    expect(result.failed).toEqual([]);

    const [shopRow] = await db.select().from(restaurants).where(eq(restaurants.id, shop.id));
    expect(shopRow!.reviewStatus).toBe('rejected');
    expect(shopRow!.rejectReason).toBe('实锤售假');
    expect(shopRow!.reviewedBy).toBe(admin.username);

    const [reportRow] = await db.select().from(reports).where(eq(reports.id, reportId));
    expect(reportRow).toBeUndefined();

    const list = (await (await listReports()).json()) as AdminReportDto[];
    expect(list.some((r) => r.id === reportId)).toBe(false);
  });

  it('rejected: leaves the target untouched and deletes the report row', async () => {
    const shop = await createShop(`举报驳回店_${stamp}`);
    await approveShop(shop.id);
    const created = await createReport({ targetType: 'restaurant', restaurantId: shop.id, reason: '恶意举报' });
    const { id: reportId } = (await created.json()) as { id: string };

    const res = await resolveReports({ reportIds: [reportId], decision: 'rejected' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ResolveReportsResultDto).succeeded).toBe(1);

    const [shopRow] = await db.select().from(restaurants).where(eq(restaurants.id, shop.id));
    expect(shopRow!.reviewStatus).toBe('approved');
    expect(shopRow!.rejectReason).toBeNull();

    const [reportRow] = await db.select().from(reports).where(eq(reports.id, reportId));
    expect(reportRow).toBeUndefined();
  });

  it('approving a review report rolls back the shop rating aggregate like normal moderation', async () => {
    const shop = await createShop(`举报评分回滚店_${stamp}`);
    const item = await createItem(shop.id, '举报评分回滚菜');
    await approveShop(shop.id);
    await approveItem(shop.id, item.id);
    const reviewId = await createPendingReview(shop.id, item.id, 4);
    // 先人工通过评价，计入聚合
    await req(`/api/admin/reviews/${reviewId}/review`, adminCookie, {
      method: 'POST',
      body: { decision: 'approved' },
    });
    const before = await shopAggregate(shop.id);

    const created = await createReport({ targetType: 'review', reviewId, reason: '刷好评' });
    const { id: reportId } = (await created.json()) as { id: string };
    await resolveReports({ reportIds: [reportId], decision: 'approved' });

    const [revRow] = await db.select().from(reviews).where(eq(reviews.id, reviewId));
    expect(revRow!.reviewStatus).toBe('rejected');
    expect(revRow!.rejectReason).toBe('刷好评');

    const after = await shopAggregate(shop.id);
    expect(after.ratingCount).toBe(before.ratingCount - 1);
    expect(after.ratingSum).toBe(before.ratingSum - 4);
  });

  it('reports per-report failures and still processes the rest', async () => {
    const shop = await createShop(`举报部分失败店_${stamp}`);
    await approveShop(shop.id);
    const created = await createReport({ targetType: 'restaurant', restaurantId: shop.id, reason: '正常举报' });
    const { id: reportId } = (await created.json()) as { id: string };

    const res = await resolveReports({
      reportIds: [reportId, '00000000-0000-4000-8000-000000000000'],
      decision: 'approved',
    });
    expect(res.status).toBe(200);
    const result = (await res.json()) as ResolveReportsResultDto;
    expect(result.succeeded).toBe(1);
    expect(result.failed).toEqual([{ reportId: '00000000-0000-4000-8000-000000000000', error: '举报不存在' }]);
  });
});
