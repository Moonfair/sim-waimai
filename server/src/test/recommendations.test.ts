import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { RestaurantSummary } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { orders, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

const app = createApp();
const cred = { username: `t_rec_${Date.now().toString(36)}`, password: 'secret123' };
let cookie = '';
let userId = '';

beforeAll(async () => {
  const res = await registerTestUser(app, cred);
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  userId = ((await res.json()) as { id: string }).id;

  // history heavily biased to 汉堡炸鸡 via kfc
  await db.insert(orders).values(
    Array.from({ length: 5 }, (_, i) => ({
      userId,
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
  await db.delete(orders).where(eq(orders.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

describe('GET /api/recommendations', () => {
  it('cold start: six restaurants sorted by quality', async () => {
    const res = await app.request('/api/recommendations');
    expect(res.status).toBe(200);
    const items = (await res.json()) as RestaurantSummary[];
    expect(items.length).toBe(6);
    for (let i = 1; i < items.length; i++) {
      // rating-dominated order (allow ties broken by sales)
      expect(items[i - 1].rating).toBeGreaterThanOrEqual(items[i].rating - 0.31);
    }
  });

  it('personalized: burger-heavy history floats 汉堡炸鸡 to the top', async () => {
    const res = await app.request('/api/recommendations', { headers: { Cookie: cookie } });
    const items = (await res.json()) as RestaurantSummary[];
    expect(items.length).toBe(6);
    expect(items[0].category).toBe('汉堡炸鸡');
  });
});
