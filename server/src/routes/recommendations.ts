import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { orders, restaurants } from '../db/schema';
import { toRestaurantSummary } from '../lib/mappers';
import { optionalAuth } from '../middleware/auth';

const LIMIT = 6;
const RECENT_ORDERS_WINDOW = 50;

export const recommendationRoutes = new Hono().get('/', optionalAuth, async (c) => {
  const user = c.get('user');

  const active = await db.select().from(restaurants).where(eq(restaurants.isActive, true));

  // category taste profile from the user's recent orders
  const weights = new Map<string, number>();
  if (user) {
    const recent = await db
      .select({ category: restaurants.category })
      .from(orders)
      .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
      .where(eq(orders.userId, user.sub))
      .orderBy(desc(orders.createdAt))
      .limit(RECENT_ORDERS_WINDOW);
    for (const r of recent) {
      weights.set(r.category, (weights.get(r.category) ?? 0) + 1);
    }
  }

  // cold start (anonymous or no history): quality only; otherwise taste dominates
  const scored = active
    .map((r) => ({
      row: r,
      score:
        (weights.get(r.category) ?? 0) * 10 +
        r.rating +
        Math.log10(r.monthlyOrders + 1),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT);

  return c.json(scored.map(({ row }) => toRestaurantSummary(row)));
});
