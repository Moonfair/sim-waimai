import { and, asc, eq, ilike, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import type { SearchResultDto } from '@sim-waimai/shared';
import { db } from '../db/client';
import { favorites, menuItems, restaurants } from '../db/schema';
import { toSearchMenuItemDto, toRestaurantSummary } from '../lib/mappers';
import { optionalAuth } from '../middleware/auth';

const RESULT_LIMIT = 30;

async function favoriteIdSet(userId: string | undefined, restaurantIds: string[]) {
  if (!userId || restaurantIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ restaurantId: favorites.restaurantId })
    .from(favorites)
    .where(and(eq(favorites.userId, userId), inArray(favorites.restaurantId, restaurantIds)));
  return new Set(rows.map((r) => r.restaurantId));
}

export const searchRoutes = new Hono().get('/', optionalAuth, async (c) => {
  const q = c.req.query('q')?.trim();
  if (!q) {
    const empty: SearchResultDto = { restaurants: [], items: [] };
    return c.json(empty);
  }

  const shopRows = await db
    .select()
    .from(restaurants)
    .where(and(ilike(restaurants.name, `%${q}%`), eq(restaurants.reviewStatus, 'approved')))
    .orderBy(asc(restaurants.sortOrder), asc(restaurants.createdAt))
    .limit(RESULT_LIMIT);

  const user = c.get('user');
  const favs = user ? await favoriteIdSet(user.sub, shopRows.map((r) => r.id)) : undefined;

  const itemRows = await db
    .select({ item: menuItems, restaurant: restaurants })
    .from(menuItems)
    .innerJoin(restaurants, eq(menuItems.restaurantId, restaurants.id))
    .where(
      and(
        ilike(menuItems.name, `%${q}%`),
        eq(menuItems.isListed, true),
        eq(menuItems.reviewStatus, 'approved'),
        eq(restaurants.reviewStatus, 'approved'),
      ),
    )
    .limit(RESULT_LIMIT);

  const result: SearchResultDto = {
    restaurants: shopRows.map((r) => toRestaurantSummary(r, favs?.has(r.id))),
    items: itemRows.map((row) => toSearchMenuItemDto(row.item, row.restaurant)),
  };
  return c.json(result);
});
