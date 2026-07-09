import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { menuItems, restaurants } from '../db/schema';
import { toRestaurant, toRestaurantSummary } from '../lib/mappers';

export const restaurantRoutes = new Hono()
  .get('/', async (c) => {
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
    return c.json(rows.map((r) => toRestaurantSummary(r)));
  })
  .get('/:id', async (c) => {
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
    return c.json(toRestaurant(row, items));
  });
