import { describe, expect, it, afterAll } from 'vitest';
import type { Restaurant, RestaurantSummary } from '@sim-waimai/shared';
import { createApp } from '../app';
import { pool } from '../db/client';

const app = createApp();

afterAll(() => pool.end());

async function getJson<T>(path: string): Promise<{ status: number; body: T }> {
  const raw = await app.request(path);
  return { status: raw.status, body: (await raw.json()) as T };
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
  });

  it('filters by category', async () => {
    const { body } = await getJson<RestaurantSummary[]>(
      `/api/restaurants?category=${encodeURIComponent('汉堡炸鸡')}`,
    );
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((r) => r.category === '汉堡炸鸡')).toBe(true);
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
