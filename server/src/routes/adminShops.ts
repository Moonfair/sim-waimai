import { asc, desc, eq, isNotNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AdminShopDto } from '@sim-waimai/shared';
import { SHOP_PRIORITY_LEVELS } from '@sim-waimai/shared';
import { db } from '../db/client';
import { restaurants, users } from '../db/schema';
import { validateJson } from '../lib/validate';
import { requireAdmin } from '../middleware/auth';

const prioritySchema = z.object({
  priority: z
    .number()
    .refine((v) => SHOP_PRIORITY_LEVELS.some((l) => l.value === v), '无效的优先级'),
});

export const adminShopsRoutes = new Hono()
  .get('/shops', requireAdmin, async (c) => {
    const rows = await db
      .select({
        id: restaurants.id,
        name: restaurants.name,
        emoji: restaurants.emoji,
        bgColor: restaurants.bgColor,
        category: restaurants.category,
        ownerUsername: users.username,
        rating: restaurants.rating,
        monthlyOrders: restaurants.monthlyOrders,
        isActive: restaurants.isActive,
        reviewStatus: restaurants.reviewStatus,
        recommendPriority: restaurants.recommendPriority,
      })
      .from(restaurants)
      .innerJoin(users, eq(users.id, restaurants.ownerId))
      .where(isNotNull(restaurants.ownerId))
      .orderBy(desc(restaurants.recommendPriority), asc(restaurants.name));
    const shops: AdminShopDto[] = rows;
    return c.json(shops);
  })
  .post('/shops/:id/priority', requireAdmin, validateJson(prioritySchema), async (c) => {
    const [row] = await db.select().from(restaurants).where(eq(restaurants.id, c.req.param('id')));
    if (!row) return c.json({ error: '店铺不存在' }, 404);
    if (!row.ownerId) return c.json({ error: '仅玩家自建店铺可调整推荐优先级' }, 400);

    const { priority } = c.req.valid('json');
    const [updated] = await db
      .update(restaurants)
      .set({ recommendPriority: priority })
      .where(eq(restaurants.id, row.id))
      .returning();

    const [owner] = await db.select({ username: users.username }).from(users).where(eq(users.id, updated.ownerId!));
    const dto: AdminShopDto = {
      id: updated.id,
      name: updated.name,
      emoji: updated.emoji,
      bgColor: updated.bgColor,
      category: updated.category,
      ownerUsername: owner?.username ?? null,
      rating: updated.rating,
      monthlyOrders: updated.monthlyOrders,
      isActive: updated.isActive,
      reviewStatus: updated.reviewStatus,
      recommendPriority: updated.recommendPriority,
    };
    return c.json(dto);
  });
