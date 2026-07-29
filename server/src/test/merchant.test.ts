import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type {
  MerchantMenuItemDto,
  MerchantRestaurantDto,
  MerchantStatsDto,
  Restaurant,
  RestaurantSummary,
} from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { menuItems, orders, restaurants, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

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
  const res = await registerTestUser(app, cred);
  return {
    cookie: (res.headers.get('set-cookie') ?? '').split(';')[0],
    id: ((await res.json()) as { id: string }).id,
  };
}

/** 新建店铺/商品默认待审核；本文件只测商家管理能力，直接在 DB 里批准以保住公开可见性断言。 */
async function approveAll(id: string) {
  await db.update(restaurants).set({ reviewStatus: 'approved' }).where(eq(restaurants.id, id));
  await db.update(menuItems).set({ reviewStatus: 'approved' }).where(eq(menuItems.restaurantId, id));
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
  await db.delete(orders).where(eq(orders.userId, ownerId));
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId)); // cascades menu_items
  await db.delete(users).where(eq(users.username, owner.username));
  await db.delete(users).where(eq(users.username, rando.username));
  await pool.end();
});

function makeOrder(restaurantId: string, totalFen: number, status: 'pending' | 'completed') {
  return {
    userId: ownerId,
    restaurantId,
    restaurantSnapshot: { name: 'x', emoji: '🍜', bgColor: '#000000' },
    status,
    items: [
      {
        key: `${restaurantId}-0`,
        menuItemId: `${restaurantId}-0`,
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

    await approveAll(shopId);
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

    await approveAll(shopId);
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

  it('permanently deletes an item regardless of its listed state', async () => {
    const created = await req(`/api/merchant/restaurants/${shopId}/items`, ownerCookie, {
      method: 'POST',
      body: { name: '待删除测试菜', price: 9, emoji: '🍚', menuCategory: '招牌' },
    });
    const toDelete = (await created.json()) as MerchantMenuItemDto;

    expect(
      (
        await req(`/api/merchant/restaurants/${shopId}/items/${toDelete.id}/permanent`, randoCookie, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(403);

    const res = await req(
      `/api/merchant/restaurants/${shopId}/items/${toDelete.id}/permanent`,
      ownerCookie,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(200);

    const merchantView = (await (
      await req(`/api/merchant/restaurants/${shopId}`, ownerCookie)
    ).json()) as MerchantRestaurantDto;
    expect(merchantView.menu.some((m) => m.id === toDelete.id)).toBe(false);

    const notFound = await req(
      `/api/merchant/restaurants/${shopId}/items/${toDelete.id}/permanent`,
      ownerCookie,
      { method: 'DELETE' },
    );
    expect(notFound.status).toBe(404);
  });

  it('closing the shop (isActive=false) keeps it visible but flags it as closed', async () => {
    await req(`/api/merchant/restaurants/${shopId}`, ownerCookie, {
      method: 'PATCH',
      body: { isActive: false },
    });

    const publicList = (await (await app.request('/api/restaurants')).json()) as RestaurantSummary[];
    const listed = publicList.find((r) => r.id === shopId);
    expect(listed).toBeDefined();
    expect(listed!.isActive).toBe(false);

    const detailRes = await app.request(`/api/restaurants/${shopId}`);
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as Restaurant;
    expect(detail.isActive).toBe(false);
    expect(detail.menu.length).toBeGreaterThan(0);

    // merchant still sees it
    const mine = (await (await req('/api/merchant/restaurants', ownerCookie)).json()) as Array<
      RestaurantSummary & { isActive: boolean }
    >;
    expect(mine.find((r) => r.id === shopId)?.isActive).toBe(false);
  });
});

describe('GET /api/merchant/stats', () => {
  it('requires auth', async () => {
    expect((await app.request('/api/merchant/stats')).status).toBe(401);
  });

  it('aggregates revenue and order count across all statuses, split by store', async () => {
    const createRes = await req('/api/merchant/restaurants', ownerCookie, {
      method: 'POST',
      body: {
        name: `统计测试店_${stamp}`,
        category: '中式快餐',
        emoji: '📊',
        bgColor: '#336699',
        deliveryFee: 3,
        minOrder: 15,
        deliveryTime: 30,
        tags: ['测试'],
        menuCategories: ['招牌'],
      },
    });
    const shop = (await createRes.json()) as MerchantRestaurantDto;

    await db.insert(orders).values([
      makeOrder(shop.id, 5000, 'completed'),
      makeOrder(shop.id, 3000, 'pending'),
    ]);

    const stats = (await (
      await req('/api/merchant/stats', ownerCookie)
    ).json()) as MerchantStatsDto;

    const mine = stats.stores.find((s) => s.id === shop.id);
    expect(mine).toBeDefined();
    // 两种状态都算："营收"不筛 status，和 adminStats.ts 里 GMV 的既有约定一致
    expect(mine!.totalSales).toBe(2);
    expect(mine!.totalRevenue).toBeCloseTo(80, 2);
    // 测试里刚插入的订单 createdAt 就是 now()，落在"今天"的边界内
    expect(mine!.todaySales).toBe(2);
    expect(mine!.todayRevenue).toBeCloseTo(80, 2);

    // 汇总字段应等于各店求和（不用绝对值断言，避免和并发跑的其他测试文件互相干扰）
    const sumRevenue = stats.stores.reduce((s, r) => s + r.totalRevenue, 0);
    const sumSales = stats.stores.reduce((s, r) => s + r.totalSales, 0);
    expect(stats.totalRevenue).toBeCloseTo(sumRevenue, 2);
    expect(stats.totalSales).toBe(sumSales);
  });
});
