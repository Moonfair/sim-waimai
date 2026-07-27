import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { MerchantRestaurantDto, RestaurantSummary, UserDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { orders, restaurants, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

// Own file so the recommendations route's module-level 30s TTL cache starts fresh:
// the shops created below must be visible on the first /api/recommendations call this process makes.
const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_rec_a_${stamp}`, password: 'secret123' };
const owner = { username: `t_rec_o_${stamp}`, password: 'secret123' };
let ownerCookie = '';
let ownerId = '';
let historyOwnerId = '';
let cookie = '';
let highRatingId = '';
let lowRatingId = '';
let tasteShopId = '';
let savedAdmins: string | undefined;

async function register(cred: { username: string; password: string }) {
  const res = await registerTestUser(app, cred);
  return {
    cookie: (res.headers.get('set-cookie') ?? '').split(';')[0],
    user: (await res.json()) as UserDto,
  };
}

function req(path: string, cred: string, init?: { method?: string; body?: unknown }) {
  return app.request(path, {
    method: init?.method ?? 'GET',
    headers: {
      ...(cred ? { Cookie: cred } : {}),
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

async function createApprovedShop(name: string, category: string, ownerCred: string, adminCred: string) {
  const res = await req('/api/merchant/restaurants', ownerCred, {
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
  const shop = (await res.json()) as MerchantRestaurantDto;
  const approve = await req(`/api/admin/restaurants/${shop.id}/review`, adminCred, {
    method: 'POST',
    body: { decision: 'approved' },
  });
  expect(approve.status).toBe(200);
  return shop.id;
}

/**
 * Runs GET /api/recommendations 100 times and counts how often each given id shows up.
 * Each call carries a unique X-Forwarded-For so the global per-IP rate limiter (300 req/60s,
 * keyed by client IP — see server/src/middleware/rateLimit.ts) treats every sampled request as
 * a distinct caller instead of bucketing all of them under the fallback 'unknown' key.
 */
async function sampleInclusionCounts(
  ids: string[],
  extraHeaders?: Record<string, string>,
): Promise<Map<string, number>> {
  const counts = new Map(ids.map((id) => [id, 0]));
  for (let i = 0; i < 100; i++) {
    const res = await app.request('/api/recommendations', {
      headers: { 'X-Forwarded-For': `test-sample-${stamp}-${i}-${Math.random()}`, ...extraHeaders },
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
  ownerCookie = o.cookie;
  ownerId = o.user.id;

  const h = await register({ username: `t_rec_h_${stamp}`, password: 'secret123' });
  cookie = h.cookie;
  historyOwnerId = h.user.id;

  // Two shops with equal monthlyOrders (0) and forced ratings 5 vs 1: cold-start weight is rating-only,
  // so this isolates "does quality tilt the odds" from priority/taste effects.
  highRatingId = await createApprovedShop(`高分店_${stamp}`, '中式快餐', ownerCookie, a.cookie);
  lowRatingId = await createApprovedShop(`低分店_${stamp}`, '中式快餐', ownerCookie, a.cookie);
  await db.update(restaurants).set({ rating: 5 }).where(eq(restaurants.id, highRatingId));
  await db.update(restaurants).set({ rating: 1 }).where(eq(restaurants.id, lowRatingId));

  // A mediocre 汉堡炸鸡 shop that needs the personalization boost to compete.
  tasteShopId = await createApprovedShop(`口味店_${stamp}`, '汉堡炸鸡', ownerCookie, a.cookie);
  await db.update(restaurants).set({ rating: 3 }).where(eq(restaurants.id, tasteShopId));

  // history heavily biased to 汉堡炸鸡
  await db.insert(orders).values(
    Array.from({ length: 5 }, (_, i) => ({
      userId: historyOwnerId,
      restaurantId: 'kfc',
      restaurantSnapshot: { name: '开封菜', emoji: '🍔', bgColor: '#e4002b' },
      status: 'completed' as const,
      items: [
        { key: `k${i}`, menuItemId: 'x', name: '汉堡', emoji: '🍔', quantity: 1, unitPrice: 20, calories: 500, lineTotal: 20 },
      ],
      subtotalFen: 2000,
      deliveryFeeFen: 500,
      totalFen: 2500,
      totalCalories: 500,
      addressSnapshot: { recipientName: '', phone: '', address: 'x' },
    })),
  );
});

afterAll(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = savedAdmins;
  await db.delete(orders).where(eq(orders.userId, historyOwnerId));
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId));
  await db.delete(users).where(inArray(users.username, [admin.username, owner.username, `t_rec_h_${stamp}`]));
  await pool.end();
});

describe('GET /api/recommendations', () => {
  it('cold start: higher-rated shop gets selected more often than a lower-rated one', async () => {
    const counts = await sampleInclusionCounts([highRatingId, lowRatingId]);
    expect(counts.get(highRatingId)!).toBeGreaterThan(counts.get(lowRatingId)!);
  });

  it('personalized: burger-heavy history makes the 汉堡炸鸡 shop show up more often than anonymous', async () => {
    const anonymous = await sampleInclusionCounts([tasteShopId]);
    const personalized = await sampleInclusionCounts([tasteShopId], { Cookie: cookie });
    expect(personalized.get(tasteShopId)!).toBeGreaterThan(anonymous.get(tasteShopId)!);
  });

  it('response shape: always 6 unique, valid restaurant ids', async () => {
    const res = await app.request('/api/recommendations');
    expect(res.status).toBe(200);
    const items = (await res.json()) as RestaurantSummary[];
    expect(items).toHaveLength(6);
    expect(new Set(items.map((it) => it.id)).size).toBe(6);
  });
});
