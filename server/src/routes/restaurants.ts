import { and, asc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { favorites, menuItems, restaurants } from '../db/schema';
import { toRestaurant, toRestaurantSummary } from '../lib/mappers';
import { optionalAuth } from '../middleware/auth';

/** Ids of the user's favorites among the given restaurant ids (empty set when anonymous). */
async function favoriteIdSet(userId: string | undefined, restaurantIds: string[]) {
  if (!userId || restaurantIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ restaurantId: favorites.restaurantId })
    .from(favorites)
    .where(and(eq(favorites.userId, userId), inArray(favorites.restaurantId, restaurantIds)));
  return new Set(rows.map((r) => r.restaurantId));
}

export const restaurantRoutes = new Hono()
  .get('/', optionalAuth, async (c) => {
    const category = c.req.query('category');
    const filters = [eq(restaurants.isActive, true)];
    if (category && category !== '全部') {
      filters.push(eq(restaurants.category, category));
    }
    const rows = await db
      .select()
      .from(restaurants)
      .where(and(...filters))
      .orderBy(asc(restaurants.sortOrder), asc(restaurants.createdAt));

    const user = c.get('user');
    if (!user) return c.json(rows.map((r) => toRestaurantSummary(r)));
    const favs = await favoriteIdSet(user.sub, rows.map((r) => r.id));
    return c.json(rows.map((r) => toRestaurantSummary(r, favs.has(r.id))));
  })
  .get('/:id', optionalAuth, async (c) => {
    const id = c.req.param('id');
    const [row] = await db.select().from(restaurants).where(eq(restaurants.id, id));
    if (!row || !row.isActive) {
      return c.json({ error: '餐厅不存在' }, 404);
    }
    const items = await db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.restaurantId, id), eq(menuItems.isListed, true)))
      .orderBy(asc(menuItems.sortOrder));

    const restaurant = toRestaurant(row, items);
    const user = c.get('user');
    if (user) {
      const favs = await favoriteIdSet(user.sub, [id]);
      restaurant.isFavorite = favs.has(id);
    }
    return c.json(restaurant);
  });
