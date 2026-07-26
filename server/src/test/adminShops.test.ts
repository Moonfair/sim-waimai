import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { AdminShopDto, MerchantRestaurantDto, UserDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { restaurants, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_shops_a_${stamp}`, password: 'secret123' };
const owner = { username: `t_shops_o_${stamp}`, password: 'secret123' };
let adminCookie = '';
let ownerCookie = '';
let ownerId = '';
let shopId = '';
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
  adminCookie = a.cookie;
  expect(a.user.isAdmin).toBe(true);
  const o = await register(owner);
  ownerCookie = o.cookie;
  ownerId = o.user.id;

  const shopRes = await req('/api/merchant/restaurants', ownerCookie, {
    method: 'POST',
    body: {
      name: `优先级测试店_${stamp}`,
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
  shopId = shop.id;
});

afterAll(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = savedAdmins;
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId));
  await db.delete(users).where(inArray(users.username, [admin.username, owner.username]));
  await pool.end();
});

describe('GET /api/admin/shops', () => {
  it('rejects non-admin', async () => {
    const res = await req('/api/admin/shops', ownerCookie);
    expect(res.status).toBe(403);
  });

  it('lists only player-created shops, with owner username', async () => {
    const res = await req('/api/admin/shops', adminCookie);
    expect(res.status).toBe(200);
    const shops = (await res.json()) as AdminShopDto[];
    expect(shops.every((s) => s.ownerUsername)).toBe(true);
    const mine = shops.find((s) => s.id === shopId);
    expect(mine).toBeDefined();
    expect(mine!.ownerUsername).toBe(owner.username);
    expect(mine!.recommendPriority).toBe(0);
  });
});

describe('POST /api/admin/shops/:id/priority', () => {
  it('rejects non-admin', async () => {
    const res = await req(`/api/admin/shops/${shopId}/priority`, ownerCookie, {
      method: 'POST',
      body: { priority: 100 },
    });
    expect(res.status).toBe(403);
  });

  it('rejects a priority value outside the preset levels', async () => {
    const res = await req(`/api/admin/shops/${shopId}/priority`, adminCookie, {
      method: 'POST',
      body: { priority: 5 },
    });
    expect(res.status).toBe(400);
  });

  it('rejects adjusting a platform-seeded shop', async () => {
    const res = await req('/api/admin/shops/kfc/priority', adminCookie, {
      method: 'POST',
      body: { priority: 100 },
    });
    expect(res.status).toBe(400);
  });

  it('updates recommendPriority for a player-created shop', async () => {
    const res = await req(`/api/admin/shops/${shopId}/priority`, adminCookie, {
      method: 'POST',
      body: { priority: 100 },
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as AdminShopDto;
    expect(updated.recommendPriority).toBe(100);

    const list = (await (await req('/api/admin/shops', adminCookie)).json()) as AdminShopDto[];
    expect(list.find((s) => s.id === shopId)?.recommendPriority).toBe(100);
  });
});
