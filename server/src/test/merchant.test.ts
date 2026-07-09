import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type {
  MerchantMenuItemDto,
  MerchantRestaurantDto,
  Restaurant,
  RestaurantSummary,
} from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { restaurants, users } from '../db/schema';

const app = createApp();
const stamp = Date.now().toString(36);
const owner = { username: `t_mch_o_${stamp}`, password: 'secret123' };
const rando = { username: `t_mch_r_${stamp}`, password: 'secret123' };
let ownerCookie = '';
let randoCookie = '';
let ownerId = '';
let shopId = '';
let itemId = '';

async function register(cred: { username: string; password: string }) {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cred),
  });
  return {
    cookie: (res.headers.get('set-cookie') ?? '').split(';')[0],
    id: ((await res.json()) as { id: string }).id,
  };
}

function req(path: string, cookie: string, init?: { method?: string; body?: unknown }) {
  return app.request(path, {
    method: init?.method ?? 'GET',
    headers: {
      Cookie: cookie,
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

beforeAll(async () => {
  const o = await register(owner);
  ownerCookie = o.cookie;
  ownerId = o.id;
  randoCookie = (await register(rando)).cookie;
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId)); // cascades menu_items
  await db.delete(users).where(eq(users.username, owner.username));
  await db.delete(users).where(eq(users.username, rando.username));
  await pool.end();
});

describe('merchant registration', () => {
  it('creates a shop owned by the user, visible in the public list', async () => {
    const res = await req('/api/merchant/restaurants', ownerCookie, {
      method: 'POST',
      body: {
        name: '测试麻辣香锅',
        category: '中式快餐',
        emoji: '🌶️',
        bgColor: '#cc2233',
        deliveryFee: 4,
        minOrder: 20,
        deliveryTime: 35,
        tags: ['新店开业'],
        menuCategories: ['招牌', '主食'],
      },
    });
    expect(res.status).toBe(200);
    const shop = (await res.json()) as MerchantRestaurantDto;
    shopId = shop.id;
    expect(shop.isActive).toBe(true);
    expect(shop.deliveryFee).toBe(4);

    const mine = (await (await req('/api/merchant/restaurants', ownerCookie)).json()) as RestaurantSummary[];
    expect(mine.some((r) => r.id === shopId)).toBe(true);

    const publicList = (await (await app.request('/api/restaurants')).json()) as RestaurantSummary[];
    expect(publicList.some((r) => r.id === shopId)).toBe(true);
  });

  it('rejects invalid category and bad color', async () => {
    const base = {
      name: 'x店',
      emoji: '🍜',
      bgColor: '#123456',
      deliveryFee: 1,
      minOrder: 1,
      deliveryTime: 30,
      menuCategories: ['a'],
    };
    expect(
      (
        await req('/api/merchant/restaurants', ownerCookie, {
          method: 'POST',
          body: { ...base, category: '全部' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await req('/api/merchant/restaurants', ownerCookie, {
          method: 'POST',
          body: { ...base, category: '中式快餐', bgColor: 'red' },
        })
      ).status,
    ).toBe(400);
  });
});

describe('menu item management', () => {
  it('creates an item with option groups; public detail shows it', async () => {
    const res = await req(`/api/merchant/restaurants/${shopId}/items`, ownerCookie, {
      method: 'POST',
      body: {
        name: '招牌香锅',
        description: '香辣过瘾',
        price: 32.5,
        calories: 800,
        emoji: '🥘',
        menuCategory: '招牌',
        popular: true,
        optionGroups: [
          {
            id: 'spicy',
            name: '辣度',
            selectionType: 'single',
            required: true,
            options: [
              { id: 'mild', name: '微辣', priceDelta: 0 },
              { id: 'hot', name: '重辣', priceDelta: 0 },
            ],
            defaultOptionIds: ['mild'],
          },
        ],
      },
    });
    expect(res.status).toBe(200);
    const item = (await res.json()) as MerchantMenuItemDto;
    itemId = item.id;
    expect(item.price).toBe(32.5);

    const detail = (await (await app.request(`/api/restaurants/${shopId}`)).json()) as Restaurant;
    expect(detail.menu.some((m) => m.id === itemId)).toBe(true);
  });

  it('rejects a required single group without exactly one default', async () => {
    const res = await req(`/api/merchant/restaurants/${shopId}/items`, ownerCookie, {
      method: 'POST',
      body: {
        name: '坏规格',
        price: 10,
        emoji: '🍚',
        menuCategory: '招牌',
        optionGroups: [
          {
            id: 'g',
            name: '份量',
            selectionType: 'single',
            required: true,
            options: [{ id: 'a', name: '大份', priceDelta: 2 }],
          },
        ],
      },
    });
    expect(res.status).toBe(400);
  });

  it('non-owner gets 403 on shop and item management', async () => {
    expect(
      (
        await req(`/api/merchant/restaurants/${shopId}`, randoCookie)
      ).status,
    ).toBe(403);
    expect(
      (
        await req(`/api/merchant/restaurants/${shopId}`, randoCookie, {
          method: 'PATCH',
          body: { name: '黑店' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await req(`/api/merchant/restaurants/${shopId}/items/${itemId}`, randoCookie, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(403);
  });

  it('delist hides the item publicly but keeps it in the merchant view', async () => {
    expect(
      (
        await req(`/api/merchant/restaurants/${shopId}/items/${itemId}`, ownerCookie, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(200);

    const publicDetail = (await (await app.request(`/api/restaurants/${shopId}`)).json()) as Restaurant;
    expect(publicDetail.menu.some((m) => m.id === itemId)).toBe(false);

    const merchantView = (await (
      await req(`/api/merchant/restaurants/${shopId}`, ownerCookie)
    ).json()) as MerchantRestaurantDto;
    const item = merchantView.menu.find((m) => m.id === itemId);
    expect(item).toBeDefined();
    expect(item!.isListed).toBe(false);

    // relist via PATCH
    const relist = await req(`/api/merchant/restaurants/${shopId}/items/${itemId}`, ownerCookie, {
      method: 'PATCH',
      body: { isListed: true },
    });
    expect(((await relist.json()) as MerchantMenuItemDto).isListed).toBe(true);
  });

  it('closing the shop (isActive=false) hides it from the public list and detail', async () => {
    await req(`/api/merchant/restaurants/${shopId}`, ownerCookie, {
      method: 'PATCH',
      body: { isActive: false },
    });
    const publicList = (await (await app.request('/api/restaurants')).json()) as RestaurantSummary[];
    expect(publicList.some((r) => r.id === shopId)).toBe(false);
    expect((await app.request(`/api/restaurants/${shopId}`)).status).toBe(404);
    // merchant still sees it
    const mine = (await (await req('/api/merchant/restaurants', ownerCookie)).json()) as Array<
      RestaurantSummary & { isActive: boolean }
    >;
    expect(mine.find((r) => r.id === shopId)?.isActive).toBe(false);
  });
});
