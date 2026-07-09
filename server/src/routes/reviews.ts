import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { orders, restaurants, reviews } from '../db/schema';
import { toReviewDto } from '../lib/mappers';
import { UUID_RE, validateJson } from '../lib/validate';
import { requireAuth } from '../middleware/auth';

const createReviewSchema = z.object({
  rating: z.number().int().min(1, '请打分').max(5),
  content: z.string().max(500, '评价内容最多500字').default(''),
  photos: z.array(z.string().max(500)).max(9, '最多上传9张图片').default([]),
});

/** Mounted under /orders — POST /orders/:id/reviews. */
export const reviewRoutes = new Hono().post(
  '/:id/reviews',
  requireAuth,
  validateJson(createReviewSchema),
  async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: '订单不存在' }, 404);

    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    if (!order || order.userId !== user.sub) return c.json({ error: '订单不存在' }, 404);
    if (order.status !== 'completed') return c.json({ error: '订单完成后才能评价' }, 400);

    const [existing] = await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.orderId, id));
    if (existing) return c.json({ error: '该订单已评价' }, 409);

    const body = c.req.valid('json');
    try {
      const row = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(reviews)
          .values({
            orderId: id,
            userId: user.sub,
            restaurantId: order.restaurantId,
            rating: body.rating,
            content: body.content.trim(),
            photos: body.photos,
          })
          .returning();
        // keep the aggregate exact: rating = rating_sum / rating_count (1 decimal)
        await tx
          .update(restaurants)
          .set({
            ratingSum: sql`${restaurants.ratingSum} + ${body.rating}`,
            ratingCount: sql`${restaurants.ratingCount} + 1`,
            rating: sql`ROUND((${restaurants.ratingSum} + ${body.rating})::numeric / (${restaurants.ratingCount} + 1), 1)`,
          })
          .where(eq(restaurants.id, order.restaurantId));
        return inserted;
      });
      return c.json(toReviewDto(row!, user.username));
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return c.json({ error: '该订单已评价' }, 409);
      }
      throw err;
    }
  },
);
