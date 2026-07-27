import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { MerchantRestaurantDto, RestaurantSummary, UserDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { restaurants, users } from '../db/schema';
import { FULL_IMAGE_BOOST_COUNT } from '../lib/imageBoost';
import { registerTestUser } from './testHelpers';

// Own file so the recommendations route's module-level 30s TTL cache starts fresh:
// the shops below must be visible on the first /api/recommendations call this process makes.
const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_recib_a_${stamp}`, password: 'secret123' };
const owner = { username: `t_recib_o_${stamp}`, password: 'secret123' };
let ownerId = '';
let pictureId = '';
let baselineId = '';
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
  return shop.id;
}

async function createItemWithImage(shopId: string, ownerCookie: string, index: number) {
  const res = await req(`/api/merchant/restaurants/${shopId}/items`, ownerCookie, {
    method: 'POST',
    body: {
      name: `图片菜_${stamp}_${index}`,
      price: 18,
      emoji: '🍜',
      menuCategory: '招牌',
      image: `/api/uploads/boost-${stamp}-${index}.jpg`,
    },
  });
  expect(res.status).toBe(200);
}

beforeAll(async () => {
  savedAdmins = process.env.ADMIN_USERNAMES;
  process.env.ADMIN_USERNAMES = [savedAdmins, admin.username].filter(Boolean).join(',');
  const a = await register(admin);
  const o = await register(owner);
  ownerId = o.user.id;

  // Two otherwise-identical shops (same defaults: rating 5, monthlyOrders 0, recommendPriority 0)
  // so the only difference in weight is the valid-image dish count — this isolates the image-boost
  // effect the same way recommendationsPriority.test.ts isolates recommendPriority.
  pictureId = await createApprovedShop(`带图店_${stamp}`, o.cookie, a.cookie);
  baselineId = await createApprovedShop(`无图店_${stamp}`, o.cookie, a.cookie);

  for (let i = 0; i < FULL_IMAGE_BOOST_COUNT; i++) {
    await createItemWithImage(pictureId, o.cookie, i);
  }
});

afterAll(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = savedAdmins;
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId));
  await db.delete(users).where(inArray(users.username, [admin.username, owner.username]));
  await pool.end();
});

describe('GET /api/recommendations honors valid-image dish count as a weight, not a hard sort', () => {
  it('a shop with more valid-image dishes is selected into the top 6 more often than an identical shop with none', async () => {
    let pictureCount = 0;
    let baselineCount = 0;
    let pictureAlwaysFirst = true;

    for (let i = 0; i < 200; i++) {
      // Unique X-Forwarded-For per call so the global per-IP rate limiter (300 req/60s, keyed by
      // client IP — see server/src/middleware/rateLimit.ts) doesn't bucket all 200 calls together.
      const res = await app.request('/api/recommendations', {
        headers: { 'X-Forwarded-For': `test-imageboost-${stamp}-${i}-${Math.random()}` },
      });
      const items = (await res.json()) as RestaurantSummary[];
      const ids = items.map((it) => it.id);
      if (ids.includes(pictureId)) pictureCount++;
      if (ids.includes(baselineId)) baselineCount++;
      if (items[0]?.id !== pictureId) pictureAlwaysFirst = false;
    }

    expect(pictureCount).toBeGreaterThan(baselineCount);
    // The image boost tilts the odds; it must not be a disguised hard sort that always wins position 1.
    expect(pictureAlwaysFirst).toBe(false);
  });
});
