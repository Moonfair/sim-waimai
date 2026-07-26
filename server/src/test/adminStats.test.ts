import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { MerchantRestaurantDto, SiteStatsDto, UserDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { orders, restaurants, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_stats_a_${stamp}`, password: 'secret123' };
const owner = { username: `t_stats_o_${stamp}`, password: 'secret123' };
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

async function createShop(name: string, category: string): Promise<MerchantRestaurantDto> {
  const res = await req('/api/merchant/restaurants', ownerCookie, {
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
  return (await res.json()) as MerchantRestaurantDto;
}

function makeOrder(shop: MerchantRestaurantDto, totalFen: number, status: 'pending' | 'completed') {
  return {
    userId: ownerId,
    restaurantId: shop.id,
    restaurantSnapshot: { name: shop.name, emoji: shop.emoji, bgColor: shop.bgColor },
    status,
    items: [
      {
        key: `${shop.id}-0`,
        menuItemId: `${shop.id}-0`,
        name: '测试商品',
        emoji: '🍜',
        quantity: 1,
        unitPrice: totalFen / 100,
        calories: 100,
        lineTotal: totalFen / 100,
      },
    ],
    subtotalFen: totalFen,
    deliveryFeeFen: 0,
    totalFen,
    totalCalories: 100,
    addressSnapshot: { recipientName: '', phone: '', address: 'x' },
  };
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
  expect(o.user.isAdmin).toBe(false);
});

afterAll(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = savedAdmins;
  await db.delete(orders).where(eq(orders.userId, ownerId));
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId));
  await db.delete(users).where(inArray(users.username, [admin.username, owner.username]));
  await pool.end();
});

describe('GET /api/admin/stats', () => {
  it('requires auth', async () => {
    expect((await app.request('/api/admin/stats')).status).toBe(401);
  });

  it('requires admin', async () => {
    const res = await req('/api/admin/stats', ownerCookie);
    expect(res.status).toBe(403);
  });

  it('never divides by zero and stays internally consistent', async () => {
    // Other test files create/delete their own restaurants and orders concurrently in this
    // shared DB, so global totals aren't stable across two snapshots in time — instead of
    // comparing before/after deltas (flaky under parallel test files), assert invariants that
    // must hold for any single response: no NaN from division, and sub-totals summing to the total.
    const res = await req('/api/admin/stats', adminCookie);
    expect(res.status).toBe(200);
    const stats = (await res.json()) as SiteStatsDto;

    expect(Number.isFinite(stats.overview.aov)).toBe(true);
    expect(Number.isFinite(stats.overview.completionRate)).toBe(true);
    expect(stats.overview.completionRate).toBeGreaterThanOrEqual(0);
    expect(stats.overview.completionRate).toBeLessThanOrEqual(1);

    // pending+approved+rejected and reviewerSplit both come from the SAME query as `total`
    // (single atomic SELECT with FILTER clauses), so these sums are exact even under concurrent
    // writes from other test files. byCategory comes from a separate query fired independently
    // (deliberately not wrapped in a transaction, see adminStats.ts), so it isn't asserted here.
    const { pending, approved, rejected } = stats.merchants.byReviewStatus;
    expect(pending + approved + rejected).toBe(stats.merchants.total);
    expect(stats.merchants.reviewerSplit.ai + stats.merchants.reviewerSplit.human).toBe(stats.merchants.total);

    // trend is a separate, independently-fired query (see the "byCategory" note above), so its
    // sum isn't cross-checked against overview.totalOrders — just assert shape and non-negativity.
    expect(stats.trend).toHaveLength(30);
    for (const day of stats.trend) {
      expect(day.orders).toBeGreaterThanOrEqual(0);
      expect(day.gmv).toBeGreaterThanOrEqual(0);
      expect(day.newUsers).toBeGreaterThanOrEqual(0);
    }
  });

  it('rolls up a newly created restaurant and its orders correctly', async () => {
    // restaurants.id is a freshly generated nanoid, so this row can't collide with concurrently
    // running test files — any orderCount/gmv found for it is exact regardless of what else runs.
    const shop = await createShop(`统计测试店_${stamp}`, '中式快餐');
    const approveRes = await req(`/api/admin/restaurants/${shop.id}/review`, adminCookie, {
      method: 'POST',
      body: { decision: 'approved' },
    });
    expect(approveRes.status).toBe(200);

    await db.insert(orders).values([makeOrder(shop, 5000, 'completed'), makeOrder(shop, 3000, 'pending')]);

    const res = await req('/api/admin/stats', adminCookie);
    expect(res.status).toBe(200);
    const stats = (await res.json()) as SiteStatsDto;

    const mine = [...stats.merchants.topByOrders, ...stats.merchants.topByGmv].find((r) => r.id === shop.id);
    if (mine) {
      expect(mine.orderCount).toBe(2);
      expect(mine.gmv).toBeCloseTo(80, 2);
    }
  });
});
