import { and, asc, desc, eq, ilike, isNotNull, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AdminShopDto, AdminShopListDto } from '@sim-waimai/shared';
import { SHOP_PRIORITY_LEVELS } from '@sim-waimai/shared';
import { db } from '../db/client';
import { restaurants, users } from '../db/schema';
import { lowActivityCondition } from '../lib/lowActivity';
import { validateJson } from '../lib/validate';
import { requireAdmin } from '../middleware/auth';

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 50;

function parsePage(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function parsePageSize(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  const v = Number.isFinite(n) ? n : PAGE_SIZE_DEFAULT;
  return Math.min(Math.max(v, 1), PAGE_SIZE_MAX);
}

const prioritySchema = z.object({
  priority: z
    .number()
    .refine((v) => SHOP_PRIORITY_LEVELS.some((l) => l.value === v), '无效的优先级'),
});

export const adminShopsRoutes = new Hono()
  .get('/shops', requireAdmin, async (c) => {
    const q = c.req.query('q')?.trim() || undefined;
    const page = parsePage(c.req.query('page'));
    const pageSize = parsePageSize(c.req.query('pageSize'));

    const where = and(
      isNotNull(restaurants.ownerId),
      q ? or(ilike(restaurants.name, `%${q}%`), ilike(users.username, `%${q}%`)) : undefined,
    );

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(restaurants)
      .innerJoin(users, eq(users.id, restaurants.ownerId))
      .where(where);

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
        lowActivity: lowActivityCondition(),
      })
      .from(restaurants)
      .innerJoin(users, eq(users.id, restaurants.ownerId))
      .where(where)
      .orderBy(desc(restaurants.recommendPriority), asc(restaurants.name))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const items: AdminShopDto[] = rows;
    const result: AdminShopListDto = { items, total, page, pageSize };
    return c.json(result);
  })
  .post('/shops/:id/priority', requireAdmin, validateJson(prioritySchema), async (c) => {
    const [row] = await db.select().from(restaurants).where(eq(restaurants.id, c.req.param('id')));
    if (!row) return c.json({ error: '店铺不存在' }, 404);
    if (!row.ownerId) return c.json({ error: '仅玩家自建店铺可调整推荐优先级' }, 400);

    const { priority } = c.req.valid('json');
    await db.update(restaurants).set({ recommendPriority: priority }).where(eq(restaurants.id, row.id));

    const [updated] = await db
      .select({ restaurant: restaurants, lowActivity: lowActivityCondition() })
      .from(restaurants)
      .where(eq(restaurants.id, row.id));

    const [owner] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, updated.restaurant.ownerId!));
    const dto: AdminShopDto = {
      id: updated.restaurant.id,
      name: updated.restaurant.name,
      emoji: updated.restaurant.emoji,
      bgColor: updated.restaurant.bgColor,
      category: updated.restaurant.category,
      ownerUsername: owner?.username ?? null,
      rating: updated.restaurant.rating,
      monthlyOrders: updated.restaurant.monthlyOrders,
      isActive: updated.restaurant.isActive,
      reviewStatus: updated.restaurant.reviewStatus,
      recommendPriority: updated.restaurant.recommendPriority,
      lowActivity: updated.lowActivity,
    };
    return c.json(dto);
  });
