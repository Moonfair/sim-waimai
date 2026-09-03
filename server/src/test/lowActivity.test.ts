import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { MerchantRestaurantDto, RestaurantSummary, UserDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { menuItems, restaurants, users } from '../db/schema';
import { grantRole, registerTestUser } from './testHelpers';

// Own file so the recommendations route's module-level 30s TTL cache starts fresh and bakes in
// the fixtures below on its first load — see recommendations.test.ts for the same note.
//
// Low-activity = <=10 customer-visible products, full stop.
const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_lowa_a_${stamp}`, password: 'secret123' };
const owner = { username: `t_lowa_o_${stamp}`, password: 'secret123' };

let ownerId = '';
let smallMenuShopId = '';
let bigMenuShopId = '';

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

async function createApprovedShop(name: string, ownerCookie: string, adminCookie: string) {
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
  const shop = (await res.json()) as MerchantRestaurantDto;
  const approve = await req(`/api/admin/restaurants/${shop.id}/review`, adminCookie, {
    method: 'POST',
    body: { decision: 'approved' },
  });
  expect(approve.status).toBe(200);
  // High rating so the shop would be a strong recommendation candidate absent the activity filter.
  await db.update(restaurants).set({ rating: 5 }).where(eq(restaurants.id, shop.id));
  return shop.id;
}

async function addApprovedItems(shopId: string, ownerCookie: string, count: number) {
  for (let i = 0; i < count; i++) {
    const res = await req(`/api/merchant/restaurants/${shopId}/items`, ownerCookie, {
      method: 'POST',
      body: { name: `菜品${i}`, price: 18, emoji: '🍜', menuCategory: '招牌' },
    });
    expect(res.status).toBe(200);
  }
  await db.update(menuItems).set({ reviewStatus: 'approved' }).where(eq(menuItems.restaurantId, shopId));
}

async function sampleInclusionCounts(ids: string[]): Promise<Map<string, number>> {
  const counts = new Map(ids.map((id) => [id, 0]));
  for (let i = 0; i < 100; i++) {
    const res = await app.request('/api/recommendations', {
      headers: { 'X-Forwarded-For': `test-lowactivity-${stamp}-${i}-${Math.random()}` },
    });
    const items = (await res.json()) as RestaurantSummary[];
    const present = new Set(items.map((it) => it.id));
    for (const id of ids) {
      if (present.has(id)) counts.set(id, counts.get(id)! + 1);
    }
  }
  return counts;
}

beforeAll(async () => {
  const a = await register(admin);
  await grantRole(admin.username, 'admin');
  const o = await register(owner);
  ownerId = o.user.id;

  smallMenuShopId = await createApprovedShop(`小菜单店_${stamp}`, o.cookie, a.cookie);

  bigMenuShopId = await createApprovedShop(`大菜单店_${stamp}`, o.cookie, a.cookie);
  await addApprovedItems(bigMenuShopId, o.cookie, 11);
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId));
  await db.delete(users).where(inArray(users.username, [admin.username, owner.username]));
  await pool.end();
});

describe('GET /api/restaurants — low-activity sink (<=10 products)', () => {
  it('flags a shop with <=10 products', async () => {
    const res = await app.request('/api/restaurants');
    const body = (await res.json()) as RestaurantSummary[];
    const shop = body.find((r) => r.id === smallMenuShopId);
    expect(shop!.lowActivity).toBe(true);
  });

  it('does not flag a shop with more than 10 products', async () => {
    const res = await app.request('/api/restaurants');
    const body = (await res.json()) as RestaurantSummary[];
    const shop = body.find((r) => r.id === bigMenuShopId);
    expect(shop!.lowActivity).toBe(false);
  });

  it('sorts a flagged shop after an unflagged one', async () => {
    const res = await app.request('/api/restaurants');
    const body = (await res.json()) as RestaurantSummary[];
    const flaggedIdx = body.findIndex((r) => r.id === smallMenuShopId);
    const unflaggedIdx = body.findIndex((r) => r.id === bigMenuShopId);
    expect(flaggedIdx).toBeGreaterThan(unflaggedIdx);
  });
});

describe('GET /api/recommendations — low-activity exclusion', () => {
  it('recommends a shop with more than 10 products, but never a small-menu shop', async () => {
    const counts = await sampleInclusionCounts([smallMenuShopId, bigMenuShopId]);
    expect(counts.get(smallMenuShopId)).toBe(0);
    expect(counts.get(bigMenuShopId)).toBeGreaterThan(0);
  });
});
