import { describe, expect, it, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type {
  MerchantMenuItemDto,
  MerchantRestaurantDto,
  SearchResultDto,
  UserDto,
} from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { menuItems, restaurants, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);

afterAll(() => pool.end());

async function getJson<T>(path: string): Promise<{ status: number; body: T }> {
  const raw = await app.request(path);
  return { status: raw.status, body: (await raw.json()) as T };
}

async function createShopWithItem(username: string, shopName: string, itemName: string) {
  const registerRes = await registerTestUser(app, { username, password: 'secret123' });
  const cookie = (registerRes.headers.get('set-cookie') ?? '').split(';')[0];
  const user = (await registerRes.json()) as UserDto;

  const shopRes = await app.request('/api/merchant/restaurants', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: shopName,
      category: '中式快餐',
      emoji: '🍱',
      bgColor: '#336699',
      deliveryFee: 3,
      minOrder: 15,
      deliveryTime: 30,
      tags: ['测试'],
      menuCategories: ['招牌'],
    }),
  });
  const shop = (await shopRes.json()) as MerchantRestaurantDto;

  const itemRes = await app.request(`/api/merchant/restaurants/${shop.id}/items`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: itemName, price: 18, emoji: '🍜', menuCategory: '招牌' }),
  });
  const item = (await itemRes.json()) as MerchantMenuItemDto;

  return { cookie, userId: user.id, shop, item };
}

async function createItem(cookie: string, restaurantId: string, name: string) {
  const res = await app.request(`/api/merchant/restaurants/${restaurantId}/items`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, price: 10, emoji: '🍜', menuCategory: '招牌' }),
  });
  return (await res.json()) as MerchantMenuItemDto;
}

describe('GET /api/search', () => {
  it('returns empty result for a blank query', async () => {
    const { status, body } = await getJson<SearchResultDto>('/api/search?q=');
    expect(status).toBe(200);
    expect(body).toEqual({ restaurants: [], items: [] });
  });

  it('matches approved shops/items and excludes rejected, delisted, or unapproved-parent content', async () => {
    const shopName = `搜索测试店_${stamp}`;
    const visibleItemName = `搜索测试菜_${stamp}`;
    const rejectedItemName = `搜索测试菜驳回_${stamp}`;
    const delistedItemName = `搜索测试菜下架_${stamp}`;
    const rejectedShopName = `搜索测试店驳回_${stamp}`;
    const rejectedShopItemName = `搜索测试菜B_${stamp}`;

    const { cookie: cookieA, userId: ownerAId, shop: shopA, item: visibleItem } =
      await createShopWithItem(`t_search_a_${stamp}`, shopName, visibleItemName);
    const rejectedItem = await createItem(cookieA, shopA.id, rejectedItemName);
    const delistedItem = await createItem(cookieA, shopA.id, delistedItemName);

    const { userId: ownerBId, shop: shopB } = await createShopWithItem(
      `t_search_b_${stamp}`,
      rejectedShopName,
      rejectedShopItemName,
    );

    await db.update(restaurants).set({ reviewStatus: 'approved' }).where(eq(restaurants.id, shopA.id));
    await db
      .update(menuItems)
      .set({ reviewStatus: 'approved' })
      .where(and(eq(menuItems.restaurantId, shopA.id), eq(menuItems.id, visibleItem.id)));
    await db
      .update(menuItems)
      .set({ reviewStatus: 'rejected' })
      .where(and(eq(menuItems.restaurantId, shopA.id), eq(menuItems.id, rejectedItem.id)));
    await db
      .update(menuItems)
      .set({ reviewStatus: 'approved', isListed: false })
      .where(and(eq(menuItems.restaurantId, shopA.id), eq(menuItems.id, delistedItem.id)));

    await db.update(restaurants).set({ reviewStatus: 'rejected' }).where(eq(restaurants.id, shopB.id));

    try {
      const shopHit = await getJson<SearchResultDto>(`/api/search?q=${encodeURIComponent(shopName)}`);
      expect(shopHit.body.restaurants.map((r) => r.id)).toEqual([shopA.id]);

      const itemHit = await getJson<SearchResultDto>(`/api/search?q=${encodeURIComponent(visibleItemName)}`);
      expect(itemHit.body.items.map((i) => i.id)).toEqual([visibleItem.id]);
      expect(itemHit.body.items[0]!.restaurantId).toBe(shopA.id);

      const rejectedItemHit = await getJson<SearchResultDto>(
        `/api/search?q=${encodeURIComponent(rejectedItemName)}`,
      );
      expect(rejectedItemHit.body.items).toEqual([]);

      const delistedItemHit = await getJson<SearchResultDto>(
        `/api/search?q=${encodeURIComponent(delistedItemName)}`,
      );
      expect(delistedItemHit.body.items).toEqual([]);

      const rejectedShopHit = await getJson<SearchResultDto>(
        `/api/search?q=${encodeURIComponent(rejectedShopName)}`,
      );
      expect(rejectedShopHit.body.restaurants).toEqual([]);

      const rejectedShopItemHit = await getJson<SearchResultDto>(
        `/api/search?q=${encodeURIComponent(rejectedShopItemName)}`,
      );
      expect(rejectedShopItemHit.body.items).toEqual([]);
    } finally {
      await db.delete(restaurants).where(eq(restaurants.id, shopA.id));
      await db.delete(restaurants).where(eq(restaurants.id, shopB.id));
      await db.delete(users).where(eq(users.id, ownerAId));
      await db.delete(users).where(eq(users.id, ownerBId));
    }
  });
});
