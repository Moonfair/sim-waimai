import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { orders, reviews } from '../db/schema';
import { imageUrlSchema } from '../lib/imageUrl';
import { toReviewDto } from '../lib/mappers';
import { queueReview } from '../lib/moderation';
import { UUID_RE, validateJson } from '../lib/validate';
import { requireAuth } from '../middleware/auth';

const createReviewSchema = z.object({
  rating: z.number().int().min(1, '请打分').max(5),
  content: z.string().max(500, '评价内容最多500字').default(''),
  photos: z.array(imageUrlSchema).max(9, '最多上传9张图片').default([]),
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
      // 先审后发：落库为 pending（不计入店铺评分聚合），AI 通过时才公开并累加聚合
      //（见 lib/moderation.ts），驳回/存疑走人工队列。
      const [row] = await db
        .insert(reviews)
        .values({
          orderId: id,
          userId: user.sub,
          restaurantId: order.restaurantId,
          rating: body.rating,
          content: body.content.trim(),
          photos: body.photos,
          reviewStatus: 'pending',
        })
        .returning();
      queueReview(
        { table: 'reviews', reviewId: row!.id },
        { texts: [row!.content], images: row!.photos },
      );
      return c.json(toReviewDto(row!, user.username));
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return c.json({ error: '该订单已评价' }, 409);
      }
      throw err;
    }
  },
);
