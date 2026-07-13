import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { favorites, menuItems, restaurants, reviews, users } from '../db/schema';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import { toRestaurant, toRestaurantSummary, toReviewDto } from '../lib/mappers';
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
    const filters = [eq(restaurants.isActive, true), eq(restaurants.reviewStatus, 'approved')];
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
  .get('/:id/reviews', async (c) => {
    const id = c.req.param('id');
    const limitRaw = Number(c.req.query('limit') ?? 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 10, 1), 50);

    const filters = [eq(reviews.restaurantId, id)];
    const cursorParam = c.req.query('cursor');
    if (cursorParam) {
      const cursor = decodeCursor(cursorParam);
      if (!cursor) return c.json({ error: '无效的分页游标' }, 400);
      filters.push(
        sql`(${reviews.createdAt}, ${reviews.id}) < (${cursor.createdAt}, ${cursor.id}::uuid)`,
      );
    }

    const rows = await db
      .select({ review: reviews, username: users.username })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.userId))
      .where(and(...filters))
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return c.json({
      items: page.map((r) => toReviewDto(r.review, r.username)),
      nextCursor: hasMore && last ? encodeCursor(last.review.createdAt, last.review.id) : null,
    });
  })
  .get('/:id', optionalAuth, async (c) => {
    const id = c.req.param('id');
    const [row] = await db.select().from(restaurants).where(eq(restaurants.id, id));
    if (!row || !row.isActive || row.reviewStatus !== 'approved') {
      return c.json({ error: '餐厅不存在' }, 404);
    }
    const items = await db
      .select()
      .from(menuItems)
      .where(
        and(
          eq(menuItems.restaurantId, id),
          eq(menuItems.isListed, true),
          eq(menuItems.reviewStatus, 'approved'),
        ),
      )
      .orderBy(asc(menuItems.sortOrder));

    const restaurant = toRestaurant(row, items);
    const user = c.get('user');
    if (user) {
      const favs = await favoriteIdSet(user.sub, [id]);
      restaurant.isFavorite = favs.has(id);
    }
    return c.json(restaurant);
  });
