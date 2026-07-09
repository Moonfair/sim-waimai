import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { favorites, restaurants } from '../db/schema';
import { toRestaurantSummary } from '../lib/mappers';
import { requireAuth } from '../middleware/auth';

export const favoriteRoutes = new Hono()
  .get('/', requireAuth, async (c) => {
    const user = c.get('user');
    const rows = await db
      .select({ restaurant: restaurants })
      .from(favorites)
      .innerJoin(restaurants, eq(restaurants.id, favorites.restaurantId))
      .where(eq(favorites.userId, user.sub))
      .orderBy(desc(favorites.createdAt));
    return c.json(rows.map((r) => toRestaurantSummary(r.restaurant, true)));
  })
  .put('/:restaurantId', requireAuth, async (c) => {
    const user = c.get('user');
    const restaurantId = c.req.param('restaurantId');
    const [restaurant] = await db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId));
    if (!restaurant) return c.json({ error: '餐厅不存在' }, 404);
    await db
      .insert(favorites)
      .values({ userId: user.sub, restaurantId })
      .onConflictDoNothing();
    return c.json({ ok: true, isFavorite: true });
  })
  .delete('/:restaurantId', requireAuth, async (c) => {
    const user = c.get('user');
    const restaurantId = c.req.param('restaurantId');
    await db
      .delete(favorites)
      .where(and(eq(favorites.userId, user.sub), eq(favorites.restaurantId, restaurantId)));
    return c.json({ ok: true, isFavorite: false });
  });
