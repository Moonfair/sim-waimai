import { and, desc, eq, ilike, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AdminUserDto, BanUserResultDto } from '@sim-waimai/shared';
import { db } from '../db/client';
import { menuItems, restaurants, reviews, users } from '../db/schema';
import { validateJson } from '../lib/validate';
import { requireAdmin } from '../middleware/auth';
import { applyMenuItemDecision, applyRestaurantDecision, applyUserReviewDecision } from './admin';

const LIST_LIMIT = 100;
const BAN_REJECT_REASON = '账号已被封禁';

const banSchema = z.object({
  reason: z.string().max(200).optional(),
});

function toAdminUserDto(row: typeof users.$inferSelect): AdminUserDto {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.createdAt.toISOString(),
    isBanned: row.isBanned,
    bannedAt: row.bannedAt?.toISOString() ?? null,
    bannedReason: row.bannedReason,
    bannedBy: row.bannedBy,
  };
}

export const adminUsersRoutes = new Hono()
  .get('/users', requireAdmin, async (c) => {
    const q = c.req.query('q')?.trim();
    const rows = await db
      .select()
      .from(users)
      .where(q ? ilike(users.username, `%${q}%`) : undefined)
      .orderBy(desc(users.createdAt))
      .limit(LIST_LIMIT);
    return c.json(rows.map(toAdminUserDto));
  })
  .post('/users/:id/ban', requireAdmin, validateJson(banSchema), async (c) => {
    const admin = c.get('user');
    const id = c.req.param('id');
    const [target] = await db.select().from(users).where(eq(users.id, id));
    if (!target) return c.json({ error: '用户不存在' }, 404);
    if (target.isBanned) return c.json({ error: '该用户已被封禁' }, 400);

    const { reason } = c.req.valid('json');
    const [updated] = await db
      .update(users)
      .set({
        isBanned: true,
        bannedAt: new Date(),
        bannedReason: reason?.trim() || null,
        bannedBy: admin.username,
      })
      .where(eq(users.id, id))
      .returning();

    // 批量驳回该用户名下历史内容；只处理尚未驳回的行，已驳回的跳过。
    const decision = { decision: 'rejected' as const, reason: BAN_REJECT_REASON };

    const ownedShops = await db.select().from(restaurants).where(eq(restaurants.ownerId, id));
    let restaurantCount = 0;
    for (const shop of ownedShops) {
      if (shop.reviewStatus === 'rejected') continue;
      if (await applyRestaurantDecision(shop.id, decision, admin.username)) restaurantCount += 1;
    }

    let itemCount = 0;
    for (const shop of ownedShops) {
      const itemRows = await db
        .select()
        .from(menuItems)
        .where(and(eq(menuItems.restaurantId, shop.id), ne(menuItems.reviewStatus, 'rejected')));
      for (const item of itemRows) {
        if (await applyMenuItemDecision(shop.id, item.id, decision, admin.username)) itemCount += 1;
      }
    }

    const reviewRows = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.userId, id), ne(reviews.reviewStatus, 'rejected')));
    let reviewCount = 0;
    for (const review of reviewRows) {
      if (await applyUserReviewDecision(review.id, decision, admin.username)) reviewCount += 1;
    }

    const result: BanUserResultDto = {
      user: toAdminUserDto(updated!),
      rejectedCounts: { restaurants: restaurantCount, menuItems: itemCount, reviews: reviewCount },
    };
    return c.json(result);
  });
