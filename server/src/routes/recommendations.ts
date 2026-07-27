import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { orders, restaurants } from '../db/schema';
import { ttlCache } from '../lib/cache';
import { toRestaurantSummary } from '../lib/mappers';
import { weightedSample } from '../lib/weightedSample';
import { optionalAuth } from '../middleware/auth';

const LIMIT = 6;
const RECENT_ORDERS_WINDOW = 50;

// The active-restaurant set is shared across all callers and changes rarely; personalization is
// layered on per-user below, so a short shared cache avoids scanning every restaurant per request.
// 30s TTL means moderation flips can lag here by up to 30s — acceptable for recommendations.
const activeRestaurants = ttlCache(30_000, () =>
  db
    .select()
    .from(restaurants)
    .where(and(eq(restaurants.isActive, true), eq(restaurants.reviewStatus, 'approved'))),
);

export const recommendationRoutes = new Hono().get('/', optionalAuth, async (c) => {
  const user = c.get('user');

  const active = await activeRestaurants();

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

  // cold start (anonymous or no history): quality only; otherwise taste dominates.
  // recommendPriority only tilts the odds (weightedSample below) — it never guarantees a slot.
  const qualityScore = (r: (typeof active)[number]) =>
    (weights.get(r.category) ?? 0) * 10 + r.rating + Math.log10(r.monthlyOrders + 1);

  const picked = weightedSample(
    active,
    (r) => Math.max(qualityScore(r), 0.01) * (1 + r.recommendPriority / 50),
    LIMIT,
  );

  return c.json(picked.map((row) => toRestaurantSummary(row)));
});
