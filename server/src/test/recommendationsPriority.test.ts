import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { MerchantRestaurantDto, RestaurantSummary, UserDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { menuItems, restaurants, users } from '../db/schema';
import { grantRole, registerTestUser } from './testHelpers';

// Own file so the recommendations route's module-level 30s TTL cache starts fresh:
// the shops below must be visible on the first /api/recommendations call this process makes.
const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_recp_a_${stamp}`, password: 'secret123' };
const owner = { username: `t_recp_o_${stamp}`, password: 'secret123' };
let ownerId = '';
let tiltedId = '';
let baselineId = '';
let pinnedId = '';
let pinnedLowActivityId = '';
let baselineLowActivityId = '';

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
  return shop.id;
}

// Low-activity shops (<=10 products, see server/src/lib/lowActivity.ts) are excluded from
// recommendations entirely, so both fixture shops below need more than 10 to stay eligible.
async function giveShopEnoughProductsToBeEligible(shopId: string, ownerCookie: string) {
  for (let i = 0; i < 11; i++) {
    const res = await req(`/api/merchant/restaurants/${shopId}/items`, ownerCookie, {
      method: 'POST',
      body: { name: `菜品${i}`, price: 18, emoji: '🍜', menuCategory: '招牌' },
    });
    expect(res.status).toBe(200);
  }
  await db.update(menuItems).set({ reviewStatus: 'approved' }).where(eq(menuItems.restaurantId, shopId));
}

beforeAll(async () => {
  const a = await register(admin);
  await grantRole(admin.username, 'admin');
  const o = await register(owner);
  ownerId = o.user.id;

  // Otherwise-identical shops (same defaults: rating 5, monthlyOrders 0) so the only difference
  // in weight/placement comes from recommendPriority, isolating the priority effect.
  tiltedId = await createApprovedShop(`较高店_${stamp}`, o.cookie, a.cookie);
  baselineId = await createApprovedShop(`普通店_${stamp}`, o.cookie, a.cookie);
  pinnedId = await createApprovedShop(`置顶店_${stamp}`, o.cookie, a.cookie);
  await giveShopEnoughProductsToBeEligible(tiltedId, o.cookie);
  await giveShopEnoughProductsToBeEligible(baselineId, o.cookie);
  await giveShopEnoughProductsToBeEligible(pinnedId, o.cookie);

  const tiltedPriorityRes = await req(`/api/admin/shops/${tiltedId}/priority`, a.cookie, {
    method: 'POST',
    body: { priority: 10 },
  });
  expect(tiltedPriorityRes.status).toBe(200);
  const pinnedPriorityRes = await req(`/api/admin/shops/${pinnedId}/priority`, a.cookie, {
    method: 'POST',
    body: { priority: 100 },
  });
  expect(pinnedPriorityRes.status).toBe(200);

  // Low-activity shops (<=10 products) normally never appear in recommendations at all. A 置顶
  // (recommendPriority=100) one should be treated as an admin override and stay eligible anyway;
  // an un-boosted low-activity shop should remain excluded as before.
  pinnedLowActivityId = await createApprovedShop(`置顶低活跃店_${stamp}`, o.cookie, a.cookie);
  baselineLowActivityId = await createApprovedShop(`普通低活跃店_${stamp}`, o.cookie, a.cookie);
  const lowActivityPriorityRes = await req(`/api/admin/shops/${pinnedLowActivityId}/priority`, a.cookie, {
    method: 'POST',
    body: { priority: 100 },
  });
  expect(lowActivityPriorityRes.status).toBe(200);
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId));
  await db.delete(users).where(inArray(users.username, [admin.username, owner.username]));
  await pool.end();
});

describe('GET /api/recommendations: recommendPriority=10 (较高) tilts odds but is not a hard sort', () => {
  it('a tilted shop is selected into the top 6 more often than an identical untilted one, without ever being guaranteed', async () => {
    let tiltedCount = 0;
    let baselineCount = 0;
    let tiltedAlwaysFirst = true;

    for (let i = 0; i < 200; i++) {
      // Unique X-Forwarded-For per call so the global per-IP rate limiter (300 req/60s, keyed by
      // client IP — see server/src/middleware/rateLimit.ts) doesn't bucket all 200 calls together.
      const res = await app.request('/api/recommendations', {
        headers: { 'X-Forwarded-For': `test-priority-${stamp}-${i}-${Math.random()}` },
      });
      const items = (await res.json()) as RestaurantSummary[];
      const ids = items.map((it) => it.id);
      if (ids.includes(tiltedId)) tiltedCount++;
      if (ids.includes(baselineId)) baselineCount++;
      if (items[0]?.id !== tiltedId) tiltedAlwaysFirst = false;
    }

    expect(tiltedCount).toBeGreaterThan(baselineCount);
    // 较高 only tilts the odds; it must not be a disguised hard sort that always wins position 1
    // or always gets included — that guarantee is reserved for the 置顶 (100) tier below.
    expect(tiltedAlwaysFirst).toBe(false);
    expect(tiltedCount).toBeLessThan(200);
  });
});

describe('GET /api/recommendations: recommendPriority=100 (置顶) guarantees inclusion and front placement', () => {
  it('a pinned shop is always included and always ranks ahead of an ordinary shop it appears alongside', async () => {
    let pinnedSeenCount = 0;

    for (let i = 0; i < 100; i++) {
      const res = await app.request('/api/recommendations', {
        headers: { 'X-Forwarded-For': `test-priority-pinned-${stamp}-${i}-${Math.random()}` },
      });
      const items = (await res.json()) as RestaurantSummary[];
      const ids = items.map((it) => it.id);
      const pinnedIndex = ids.indexOf(pinnedId);
      const baselineIndex = ids.indexOf(baselineId);
      expect(pinnedIndex).not.toBe(-1); // guaranteed inclusion, every single call
      pinnedSeenCount++;
      if (baselineIndex !== -1) {
        expect(pinnedIndex).toBeLessThan(baselineIndex); // pinned always ranks ahead of non-pinned
      }
    }

    expect(pinnedSeenCount).toBe(100);
  });

  it('a pinned low-activity (<=10 products) shop is eligible despite the low-activity exclusion, but an un-boosted one stays excluded', async () => {
    for (let i = 0; i < 30; i++) {
      const res = await app.request('/api/recommendations', {
        headers: { 'X-Forwarded-For': `test-priority-lowactivity-${stamp}-${i}-${Math.random()}` },
      });
      const items = (await res.json()) as RestaurantSummary[];
      const ids = items.map((it) => it.id);
      expect(ids).toContain(pinnedLowActivityId); // guaranteed, so every call, not just "eventually"
      expect(ids).not.toContain(baselineLowActivityId);
    }
  });
});
