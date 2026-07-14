import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { UserStatsDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { orders, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const cred = { username: `t_stats_${stamp}`, password: 'secret123' };
let cookie = '';
let userId = '';

function req(path: string) {
  return app.request(path, { headers: { Cookie: cookie } });
}

beforeAll(async () => {
  const res = await registerTestUser(app, cred);
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  userId = ((await res.json()) as { id: string }).id;
});

afterAll(async () => {
  await db.delete(orders).where(eq(orders.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

function makeOrder(overrides: {
  restaurantId: string;
  restaurantName: string;
  restaurantEmoji: string;
  totalFen: number;
  totalCalories: number;
  items: Array<{ name: string; emoji: string; quantity: number }>;
}) {
  return {
    userId,
    restaurantId: overrides.restaurantId,
    restaurantSnapshot: {
      name: overrides.restaurantName,
      emoji: overrides.restaurantEmoji,
      bgColor: '#ff8c00',
    },
    status: 'completed' as const,
    items: overrides.items.map((it, i) => ({
      key: `${overrides.restaurantId}-${i}`,
      menuItemId: `${overrides.restaurantId}-${i}`,
      name: it.name,
      emoji: it.emoji,
      quantity: it.quantity,
      unitPrice: 10,
      calories: 100,
      lineTotal: it.quantity * 10,
    })),
    subtotalFen: overrides.totalFen - 500,
    deliveryFeeFen: 500,
    totalFen: overrides.totalFen,
    totalCalories: overrides.totalCalories,
    addressSnapshot: { recipientName: '', phone: '', address: 'x' },
  };
}

describe('GET /api/orders/stats', () => {
  it('requires auth', async () => {
    expect((await app.request('/api/orders/stats')).status).toBe(401);
  });

  it('returns all-zero/null stats with no orders', async () => {
    const res = await req('/api/orders/stats');
    expect(res.status).toBe(200);
    const stats = (await res.json()) as UserStatsDto;
    expect(stats).toEqual({
      totalOrders: 0,
      totalSaved: 0,
      totalCalories: 0,
      topRestaurant: null,
      topItem: null,
      biggestOrder: null,
    });
  });

  it('aggregates order count, savings, calories, top restaurant, top item, biggest order', async () => {
    // kfc: 3 orders (wins by count), haidilao: 1 order but bigger + more calories
    await db.insert(orders).values([
      makeOrder({
        restaurantId: 'kfc',
        restaurantName: '开封菜',
        restaurantEmoji: '🍔',
        totalFen: 3000,
        totalCalories: 500,
        items: [{ name: '香辣鸡腿堡', emoji: '🍔', quantity: 2 }],
      }),
      makeOrder({
        restaurantId: 'kfc',
        restaurantName: '开封菜',
        restaurantEmoji: '🍔',
        totalFen: 2000,
        totalCalories: 300,
        items: [{ name: '香辣鸡腿堡', emoji: '🍔', quantity: 1 }],
      }),
      makeOrder({
        restaurantId: 'kfc',
        restaurantName: '开封菜',
        restaurantEmoji: '🍔',
        totalFen: 1500,
        totalCalories: 200,
        items: [{ name: '薯条', emoji: '🍟', quantity: 1 }],
      }),
      makeOrder({
        restaurantId: 'haidilao',
        restaurantName: '河底捞',
        restaurantEmoji: '🍲',
        totalFen: 9900,
        totalCalories: 1200,
        items: [{ name: '毛肚', emoji: '🥩', quantity: 1 }],
      }),
    ]);

    const res = await req('/api/orders/stats');
    expect(res.status).toBe(200);
    const stats = (await res.json()) as UserStatsDto;

    expect(stats.totalOrders).toBe(4);
    expect(stats.totalSaved).toBeCloseTo((3000 + 2000 + 1500 + 9900) / 100, 2);
    expect(stats.totalCalories).toBe(500 + 300 + 200 + 1200);

    expect(stats.topRestaurant).not.toBeNull();
    expect(stats.topRestaurant!.id).toBe('kfc');
    expect(stats.topRestaurant!.orderCount).toBe(3);
    expect(stats.topRestaurant!.name).toBe('开封菜');

    // 香辣鸡腿堡 ordered 2+1=3 times, beats 薯条(1) and 毛肚(1)
    expect(stats.topItem).not.toBeNull();
    expect(stats.topItem!.name).toBe('香辣鸡腿堡');
    expect(stats.topItem!.quantity).toBe(3);

    expect(stats.biggestOrder).not.toBeNull();
    expect(stats.biggestOrder!.restaurantName).toBe('河底捞');
    expect(stats.biggestOrder!.total).toBeCloseTo(99, 2);
  });

  it("does not leak another user's stats", async () => {
    const other = { username: `t_st_o_${stamp}`, password: 'secret123' };
    const res = await registerTestUser(app, other);
    const otherCookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
    const otherId = ((await res.json()) as { id: string }).id;

    const stats = (await (
      await app.request('/api/orders/stats', { headers: { Cookie: otherCookie } })
    ).json()) as UserStatsDto;
    expect(stats.totalOrders).toBe(0);

    await db.delete(users).where(eq(users.id, otherId));
  });
});
