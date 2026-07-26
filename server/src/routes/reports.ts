import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { menuItems, restaurants, reports, reviews } from '../db/schema';
import { UUID_RE, validateJson } from '../lib/validate';
import { requireAuth } from '../middleware/auth';

const reasonSchema = z.string().trim().min(1, '请填写举报原因').max(200, '举报原因最多200字');

const createReportSchema = z.discriminatedUnion('targetType', [
  z.object({ targetType: z.literal('restaurant'), restaurantId: z.string().min(1), reason: reasonSchema }),
  z.object({
    targetType: z.literal('menuItem'),
    restaurantId: z.string().min(1),
    itemId: z.string().min(1),
    reason: reasonSchema,
  }),
  z.object({
    targetType: z.literal('review'),
    reviewId: z.string().regex(UUID_RE, '评价不存在'),
    reason: reasonSchema,
  }),
]);

export const reportRoutes = new Hono().post('/', requireAuth, validateJson(createReportSchema), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  let restaurantId: string;
  let itemId: string | null = null;
  let reviewId: string | null = null;

  if (body.targetType === 'restaurant') {
    const [row] = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, body.restaurantId));
    if (!row) return c.json({ error: '店铺不存在' }, 404);
    restaurantId = row.id;
  } else if (body.targetType === 'menuItem') {
    const [row] = await db
      .select({ restaurantId: menuItems.restaurantId })
      .from(menuItems)
      .where(and(eq(menuItems.restaurantId, body.restaurantId), eq(menuItems.id, body.itemId)));
    if (!row) return c.json({ error: '菜品不存在' }, 404);
    restaurantId = row.restaurantId;
    itemId = body.itemId;
  } else {
    const [row] = await db
      .select({ restaurantId: reviews.restaurantId })
      .from(reviews)
      .where(eq(reviews.id, body.reviewId));
    if (!row) return c.json({ error: '评价不存在' }, 404);
    restaurantId = row.restaurantId;
    reviewId = body.reviewId;
  }

  const [created] = await db
    .insert(reports)
    .values({
      targetType: body.targetType,
      restaurantId,
      itemId,
      reviewId,
      reporterId: user.sub,
      reason: body.reason,
    })
    .returning({ id: reports.id });

  return c.json({ id: created!.id }, 201);
});
