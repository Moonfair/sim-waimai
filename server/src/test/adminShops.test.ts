import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { AdminShopDto, AdminShopListDto, MerchantRestaurantDto, UserDto } from '@sim-waimai/shared';
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
    const { items: shops } = (await res.json()) as AdminShopListDto;
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

    const { items: list } = (await (await req('/api/admin/shops', adminCookie)).json()) as AdminShopListDto;
    expect(list.find((s) => s.id === shopId)?.recommendPriority).toBe(100);
  });
});

describe('GET /api/admin/shops 分页与搜索', () => {
  const owner2 = { username: `t_shops_o2_${stamp}`, password: 'secret123' };
  let owner2Id = '';
  let shop2Id = '';

  beforeAll(async () => {
    const o2 = await register(owner2);
    owner2Id = o2.user.id;
    const shopRes = await req('/api/merchant/restaurants', o2.cookie, {
      method: 'POST',
      body: {
        name: `搜索测试店_${stamp}`,
        category: '中式快餐',
        emoji: '🍜',
        bgColor: '#996633',
        deliveryFee: 3,
        minOrder: 15,
        deliveryTime: 30,
        tags: ['测试'],
        menuCategories: ['招牌'],
      },
    });
    expect(shopRes.status).toBe(200);
    shop2Id = ((await shopRes.json()) as MerchantRestaurantDto).id;
  });

  afterAll(async () => {
    await db.delete(restaurants).where(eq(restaurants.ownerId, owner2Id));
    await db.delete(users).where(eq(users.id, owner2Id));
  });

  it('honors page/pageSize and returns total', async () => {
    const res1 = await req('/api/admin/shops?pageSize=1&page=1', adminCookie);
    expect(res1.status).toBe(200);
    const page1 = (await res1.json()) as AdminShopListDto;
    expect(page1.items.length).toBe(1);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(1);
    expect(page1.total).toBeGreaterThanOrEqual(2);

    const res2 = await req('/api/admin/shops?pageSize=1&page=2', adminCookie);
    const page2 = (await res2.json()) as AdminShopListDto;
    expect(page2.items.length).toBe(1);
    expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);
  });

  it('clamps pageSize above 50 down to 50', async () => {
    const res = await req('/api/admin/shops?pageSize=999', adminCookie);
    const list = (await res.json()) as AdminShopListDto;
    expect(list.pageSize).toBe(50);
  });

  it('filters by shop name via q', async () => {
    const res = await req(`/api/admin/shops?q=${encodeURIComponent('搜索测试店')}`, adminCookie);
    const list = (await res.json()) as AdminShopListDto;
    expect(list.items.some((s) => s.id === shop2Id)).toBe(true);
    expect(list.items.every((s) => s.id !== shopId)).toBe(true);
  });

  it('filters by owner username via q', async () => {
    const res = await req(`/api/admin/shops?q=${encodeURIComponent(owner2.username)}`, adminCookie);
    const list = (await res.json()) as AdminShopListDto;
    expect(list.items.some((s) => s.id === shop2Id)).toBe(true);
  });

  it('returns empty items and total 0 when nothing matches', async () => {
    const res = await req(`/api/admin/shops?q=${encodeURIComponent('不存在的关键字xyz')}`, adminCookie);
    const list = (await res.json()) as AdminShopListDto;
    expect(list.items).toEqual([]);
    expect(list.total).toBe(0);
  });
});
