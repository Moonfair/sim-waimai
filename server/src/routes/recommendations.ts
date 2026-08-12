import { and, desc, eq, gt, not, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { TOP_PIN_PRIORITY } from '@sim-waimai/shared';
import { db } from '../db/client';
import { menuItems, orders, restaurants } from '../db/schema';
import { ttlCache } from '../lib/cache';
import { imageBoostFactor } from '../lib/imageBoost';
import { lowActivityCondition } from '../lib/lowActivity';
import { toRestaurantSummary } from '../lib/mappers';
import { weightedSample } from '../lib/weightedSample';
import { optionalAuth } from '../middleware/auth';

const LIMIT = 6;
const RECENT_ORDERS_WINDOW = 50;

// The active-restaurant set is shared across all callers and changes rarely; personalization is
// layered on per-user below, so a short shared cache avoids scanning every restaurant per request.
// 30s TTL means moderation flips can lag here by up to 30s — acceptable for recommendations.
// validImageCount feeds imageBoostFactor below (grouped by the restaurants PK, so Postgres's
// functional-dependency rule lets us select the rest of the restaurant row unaggregated).
// recommendPriority > 0 is an explicit admin override, so it exempts a shop from the low-activity
// exclusion too — otherwise an admin-boosted shop with <=10 products would never even reach the
// weighting step below and the boost would silently do nothing.
const activeRestaurants = ttlCache(30_000, () =>
  db
    .select({
      restaurant: restaurants,
      validImageCount: sql<number>`count(*) filter (where ${menuItems.image} is not null and ${menuItems.image} <> '' and ${menuItems.isListed} = true)::int`,
    })
    .from(restaurants)
    .leftJoin(menuItems, eq(menuItems.restaurantId, restaurants.id))
    .where(
      and(
        eq(restaurants.isActive, true),
        eq(restaurants.reviewStatus, 'approved'),
        or(not(lowActivityCondition()), gt(restaurants.recommendPriority, 0)),
      ),
    )
    .groupBy(restaurants.id),
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
  // recommendPriority (below TOP_PIN_PRIORITY) and imageBoostFactor only tilt the odds
  // (weightedSample below) — neither guarantees a slot. imageBoostFactor is capped at 3x, so
  // among restaurants sharing the same recommendPriority tier, the image-count effect alone is
  // bounded to a 3x weight spread.
  const qualityScore = (r: (typeof active)[number]['restaurant']) =>
    (weights.get(r.category) ?? 0) * 10 + r.rating + Math.log10(r.monthlyOrders + 1);

  const weight = (row: (typeof active)[number]) =>
    Math.max(qualityScore(row.restaurant), 0.01) *
    (1 + row.restaurant.recommendPriority / 50) *
    imageBoostFactor(row.validImageCount);

  // 置顶 (recommendPriority === TOP_PIN_PRIORITY) is an explicit admin override, not just a weight
  // tilt: it's guaranteed a slot and always ranks ahead of every non-pinned restaurant. Ties among
  // multiple pinned shops are broken by the same weight used everywhere else.
  const pinned = active
    .filter((row) => row.restaurant.recommendPriority === TOP_PIN_PRIORITY)
    .sort((a, b) => weight(b) - weight(a))
    .slice(0, LIMIT);
  const rest = active.filter((row) => row.restaurant.recommendPriority !== TOP_PIN_PRIORITY);

  const picked = [...pinned, ...weightedSample(rest, weight, LIMIT - pinned.length)];

  return c.json(picked.map(({ restaurant }) => toRestaurantSummary(restaurant)));
});
