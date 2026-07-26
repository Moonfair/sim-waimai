import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { MerchantRestaurantDto, RestaurantSummary, UserDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { restaurants, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

// Own file so the recommendations route's module-level 30s TTL cache starts fresh:
// the shop below must be visible on the very first /api/recommendations call this process makes.
const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_recp_a_${stamp}`, password: 'secret123' };
const owner = { username: `t_recp_o_${stamp}`, password: 'secret123' };
let ownerId = '';
let boostedId = '';
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

beforeAll(async () => {
  savedAdmins = process.env.ADMIN_USERNAMES;
  process.env.ADMIN_USERNAMES = [savedAdmins, admin.username].filter(Boolean).join(',');
  const a = await register(admin);
  const o = await register(owner);
  ownerId = o.user.id;

  // A deliberately low-quality shop (min rating/sales) that should lose on score alone.
  const shopRes = await req('/api/merchant/restaurants', o.cookie, {
    method: 'POST',
    body: {
      name: `低分置顶店_${stamp}`,
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
  expect(shopRes.status).toBe(200);
  const shop = (await shopRes.json()) as MerchantRestaurantDto;
  boostedId = shop.id;

  // Force the worst possible quality score (default rating is already the 5.0 max, which would
  // otherwise let this shop win on merit alone and defeat the point of the test).
  await db.update(restaurants).set({ rating: 1 }).where(eq(restaurants.id, boostedId));

  const approveRes = await req(`/api/admin/restaurants/${boostedId}/review`, a.cookie, {
    method: 'POST',
    body: { decision: 'approved' },
  });
  expect(approveRes.status).toBe(200);

  const priorityRes = await req(`/api/admin/shops/${boostedId}/priority`, a.cookie, {
    method: 'POST',
    body: { priority: 100 },
  });
  expect(priorityRes.status).toBe(200);
});

afterAll(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = savedAdmins;
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId));
  await db.delete(users).where(inArray(users.username, [admin.username, owner.username]));
  await pool.end();
});

describe('GET /api/recommendations honors admin-set recommendPriority', () => {
  it('places a top-priority shop first despite a low quality score', async () => {
    const res = await app.request('/api/recommendations');
    expect(res.status).toBe(200);
    const items = (await res.json()) as RestaurantSummary[];
    expect(items[0]?.id).toBe(boostedId);
  });
});
