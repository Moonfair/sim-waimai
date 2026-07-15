import { describe, expect, it, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { MerchantRestaurantDto, Restaurant, RestaurantSummary, UserDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { restaurants, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);

afterAll(() => pool.end());

async function getJson<T>(path: string, cookie?: string): Promise<{ status: number; body: T }> {
  const raw = await app.request(path, { headers: cookie ? { Cookie: cookie } : {} });
  return { status: raw.status, body: (await raw.json()) as T };
}

async function registerAndCreatePendingShop(username: string) {
  const registerRes = await registerTestUser(app, { username, password: 'secret123' });
  const cookie = (registerRes.headers.get('set-cookie') ?? '').split(';')[0];
  const user = (await registerRes.json()) as UserDto;

  const shopRes = await app.request('/api/merchant/restaurants', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `预览测试店_${stamp}`,
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
    body: JSON.stringify({ name: '预览测试菜', price: 18, emoji: '🍜', menuCategory: '招牌' }),
  });
  await itemRes.json();

  return { cookie, userId: user.id, shop };
}

describe('GET /api/restaurants', () => {
  it('returns the 14 seeded restaurants without menus', async () => {
    const { status, body } = await getJson<RestaurantSummary[]>('/api/restaurants');
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThanOrEqual(14);
    const kfc = body.find((r) => r.id === 'kfc');
    expect(kfc).toBeDefined();
    expect(kfc!.deliveryFee).toBe(5);
    expect(kfc).not.toHaveProperty('menu');
    expect(kfc!.isPlayerMade).toBe(false);
  });

  it('filters by category', async () => {
    const { body } = await getJson<RestaurantSummary[]>(
      `/api/restaurants?category=${encodeURIComponent('汉堡炸鸡')}`,
    );
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((r) => r.category === '汉堡炸鸡')).toBe(true);
  });

  it('marks player-made shops with isPlayerMade=true once approved', async () => {
    const { userId, shop } = await registerAndCreatePendingShop(`t_ilv_${stamp}`);
    try {
      await db
        .update(restaurants)
        .set({ reviewStatus: 'approved' })
        .where(eq(restaurants.id, shop.id));

      const { body } = await getJson<RestaurantSummary[]>('/api/restaurants');
      const mine = body.find((r) => r.id === shop.id);
      expect(mine).toBeDefined();
      expect(mine!.isPlayerMade).toBe(true);
    } finally {
      await db.delete(restaurants).where(eq(restaurants.id, shop.id));
      await db.delete(users).where(eq(users.id, userId));
    }
  });
});

describe('GET /api/restaurants/:id', () => {
  it('returns full detail with menu and option groups in yuan', async () => {
    const { status, body } = await getJson<Restaurant>('/api/restaurants/heytea');
    expect(status).toBe(200);
    expect(body.menu.length).toBeGreaterThan(0);
    expect(body.menuCategories.length).toBeGreaterThan(0);
    const withOptions = body.menu.find((m) => m.optionGroups?.length);
    expect(withOptions).toBeDefined();
    expect(withOptions!.optionGroups![0].options[0]).toHaveProperty('priceDelta');
    for (const m of body.menu) {
      expect(Number.isFinite(m.price)).toBe(true);
      expect(m.price).toBeLessThan(10000);
    }
  });

  it('404s for unknown id', async () => {
    const { status } = await getJson('/api/restaurants/does-not-exist');
    expect(status).toBe(404);
  });
});

describe('owner preview of a pending shop (查看顾客视角)', () => {
  it('owner can view their own pending shop and its pending items; others still 404', async () => {
    const { cookie, userId, shop } = await registerAndCreatePendingShop(`t_preview_${stamp}`);
    try {
      expect(shop.reviewStatus).toBe('pending');

      const ownerView = await getJson<Restaurant>(`/api/restaurants/${shop.id}`, cookie);
      expect(ownerView.status).toBe(200);
      expect(ownerView.body.menu.length).toBe(1);
      expect(ownerView.body.menu[0]!.name).toBe('预览测试菜');

      const anonView = await getJson(`/api/restaurants/${shop.id}`);
      expect(anonView.status).toBe(404);
    } finally {
      await db.delete(restaurants).where(eq(restaurants.id, shop.id));
      await db.delete(users).where(eq(users.id, userId));
    }
  });
});
