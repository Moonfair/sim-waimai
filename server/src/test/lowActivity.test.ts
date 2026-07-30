import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { MerchantRestaurantDto, RestaurantSummary, UserDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { menuItems, restaurants, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

// Own file so the recommendations route's module-level 30s TTL cache starts fresh and bakes in
// the stale/fresh fixtures below on its first load — see recommendations.test.ts for the same note.
const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_lowa_a_${stamp}`, password: 'secret123' };
const owner = { username: `t_lowa_o_${stamp}`, password: 'secret123' };
const STALE = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000); // older than the 3-day threshold

let ownerId = '';
let freshShopId = '';
let staleShopId = '';
let bigMenuShopId = '';
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
  savedAdmins = process.env.ADMIN_USERNAMES;
  process.env.ADMIN_USERNAMES = [savedAdmins, admin.username].filter(Boolean).join(',');
  const a = await register(admin);
  const o = await register(owner);
  ownerId = o.user.id;

  // Fresh: just created, zero products, updatedAt defaults to now — must NOT be low-activity.
  freshShopId = await createApprovedShop(`新鲜店_${stamp}`, o.cookie, a.cookie);

  // Stale: zero products, but its updatedAt is backdated past the 3-day threshold — low-activity.
  staleShopId = await createApprovedShop(`冷门店_${stamp}`, o.cookie, a.cookie);
  await db.update(restaurants).set({ updatedAt: STALE }).where(eq(restaurants.id, staleShopId));

  // Stale but with 11 approved products (> 10) — must NOT be low-activity despite being stale.
  bigMenuShopId = await createApprovedShop(`大菜单店_${stamp}`, o.cookie, a.cookie);
  await addApprovedItems(bigMenuShopId, o.cookie, 11);
  await db.update(restaurants).set({ updatedAt: STALE }).where(eq(restaurants.id, bigMenuShopId));
  await db.update(menuItems).set({ updatedAt: STALE }).where(eq(menuItems.restaurantId, bigMenuShopId));
});

afterAll(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = savedAdmins;
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId));
  await db.delete(users).where(inArray(users.username, [admin.username, owner.username]));
  await pool.end();
});

describe('GET /api/restaurants — low-activity sink', () => {
  it('flags a stale, small-menu shop as lowActivity and sorts it after a fresh shop', async () => {
    const res = await app.request('/api/restaurants');
    const body = (await res.json()) as RestaurantSummary[];
    const staleIdx = body.findIndex((r) => r.id === staleShopId);
    const freshIdx = body.findIndex((r) => r.id === freshShopId);
    expect(staleIdx).toBeGreaterThanOrEqual(0);
    expect(freshIdx).toBeGreaterThanOrEqual(0);
    expect(body[staleIdx]!.lowActivity).toBe(true);
    expect(staleIdx).toBeGreaterThan(freshIdx);
  });

  it('does not flag a fresh shop with zero products', async () => {
    const res = await app.request('/api/restaurants');
    const body = (await res.json()) as RestaurantSummary[];
    const fresh = body.find((r) => r.id === freshShopId);
    expect(fresh!.lowActivity).toBe(false);
  });

  it('does not flag a stale shop that has more than 10 products', async () => {
    const res = await app.request('/api/restaurants');
    const body = (await res.json()) as RestaurantSummary[];
    const bigMenu = body.find((r) => r.id === bigMenuShopId);
    expect(bigMenu!.lowActivity).toBe(false);
  });
});

describe('GET /api/recommendations — low-activity exclusion', () => {
  it('never recommends a stale, small-menu shop even with a top rating', async () => {
    const counts = await sampleInclusionCounts([staleShopId, freshShopId]);
    expect(counts.get(staleShopId)).toBe(0);
    expect(counts.get(freshShopId)).toBeGreaterThan(0);
  });
});
