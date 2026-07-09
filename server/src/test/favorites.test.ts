import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Restaurant, RestaurantSummary } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { favorites, users } from '../db/schema';

const app = createApp();
const cred = { username: `t_fav_${Date.now().toString(36)}`, password: 'secret123' };
let cookie = '';
let userId = '';

beforeAll(async () => {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cred),
  });
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  userId = ((await res.json()) as { id: string }).id;
});

afterAll(async () => {
  await db.delete(favorites).where(eq(favorites.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  await pool.end();
});

function req(path: string, method = 'GET') {
  return app.request(path, { method, headers: { Cookie: cookie } });
}

describe('favorites', () => {
  it('requires auth', async () => {
    expect((await app.request('/api/favorites')).status).toBe(401);
  });

  it('PUT is idempotent and reflected in detail + list', async () => {
    expect((await req('/api/favorites/kfc', 'PUT')).status).toBe(200);
    expect((await req('/api/favorites/kfc', 'PUT')).status).toBe(200);

    const list = (await (await req('/api/favorites')).json()) as RestaurantSummary[];
    expect(list.map((r) => r.id)).toEqual(['kfc']);
    expect(list[0].isFavorite).toBe(true);

    const detail = (await (await req('/api/restaurants/kfc')).json()) as Restaurant;
    expect(detail.isFavorite).toBe(true);

    const anon = (await (await app.request('/api/restaurants/kfc')).json()) as Restaurant;
    expect(anon.isFavorite).toBeUndefined();

    const home = (await (await req('/api/restaurants')).json()) as RestaurantSummary[];
    expect(home.find((r) => r.id === 'kfc')?.isFavorite).toBe(true);
    expect(home.find((r) => r.id === 'heytea')?.isFavorite).toBe(false);
  });

  it('DELETE removes the favorite', async () => {
    expect((await req('/api/favorites/kfc', 'DELETE')).status).toBe(200);
    const list = (await (await req('/api/favorites')).json()) as RestaurantSummary[];
    expect(list).toEqual([]);
    const detail = (await (await req('/api/restaurants/kfc')).json()) as Restaurant;
    expect(detail.isFavorite).toBe(false);
  });

  it('404s for unknown restaurant', async () => {
    expect((await req('/api/favorites/nope', 'PUT')).status).toBe(404);
  });
});
