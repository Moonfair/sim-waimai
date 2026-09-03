import { randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AdminUserDto, AdminUserListDto, BanUserResultDto } from '@sim-waimai/shared';
import { db } from '../db/client';
import { bannedDevices, menuItems, restaurants, reviews, userDevices, users } from '../db/schema';
import { logAdminAction } from '../lib/auditLog';
import { validateJson } from '../lib/validate';
import { requireAdmin } from '../middleware/auth';
import { applyMenuItemDecision, applyRestaurantDecision, applyUserReviewDecision } from './admin';

const BAN_REJECT_REASON = '账号已被封禁';
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

const banSchema = z.object({
  reason: z.string().max(200).optional(),
});

function toAdminUserDto(row: typeof users.$inferSelect, deviceCount: number): AdminUserDto {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.createdAt.toISOString(),
    isBanned: row.isBanned,
    bannedAt: row.bannedAt?.toISOString() ?? null,
    bannedReason: row.bannedReason,
    bannedBy: row.bannedBy,
    deviceCount,
  };
}

export const adminUsersRoutes = new Hono()
  .get('/users', requireAdmin, async (c) => {
    const q = c.req.query('q')?.trim();
    const page = parsePage(c.req.query('page'));
    const pageSize = parsePageSize(c.req.query('pageSize'));
    const where = q ? ilike(users.username, `%${q}%`) : undefined;

    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(users).where(where);
    const rows = await db
      .select({ user: users, deviceCount: sql<number>`count(${userDevices.deviceId})::int` })
      .from(users)
      .leftJoin(userDevices, eq(userDevices.userId, users.id))
      .where(where)
      .groupBy(users.id)
      .orderBy(desc(users.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const result: AdminUserListDto = {
      items: rows.map((r) => toAdminUserDto(r.user, r.deviceCount)),
      total,
      page,
      pageSize,
    };
    return c.json(result);
  })
  .post('/users/:id/ban', requireAdmin, validateJson(banSchema), async (c) => {
    const admin = c.get('user');
    const id = c.req.param('id');
    const [target] = await db.select().from(users).where(eq(users.id, id));
    if (!target) return c.json({ error: '用户不存在' }, 404);
    if (target.isBanned) return c.json({ error: '该用户已被封禁' }, 400);

    const { reason } = c.req.valid('json');
    // 封禁本身 + 级联驳回的所有内容共享一个 batchId，便于在操作日志里按这次封禁串起来看。
    const batchId = randomUUID();
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
    await logAdminAction({
      actorUsername: admin.username,
      action: 'user.ban',
      targetType: 'user',
      targetId: id,
      targetLabel: target.username,
      detail: { reason: reason?.trim() || null },
      batchId,
    });

    // 批量驳回该用户名下历史内容；只处理尚未驳回的行，已驳回的跳过。
    const decision = { decision: 'rejected' as const, reason: BAN_REJECT_REASON };

    const ownedShops = await db.select().from(restaurants).where(eq(restaurants.ownerId, id));
    let restaurantCount = 0;
    for (const shop of ownedShops) {
      if (shop.reviewStatus === 'rejected') continue;
      if (await applyRestaurantDecision(shop.id, decision, admin.username, batchId)) restaurantCount += 1;
    }

    let itemCount = 0;
    for (const shop of ownedShops) {
      const itemRows = await db
        .select()
        .from(menuItems)
        .where(and(eq(menuItems.restaurantId, shop.id), ne(menuItems.reviewStatus, 'rejected')));
      for (const item of itemRows) {
        if (await applyMenuItemDecision(shop.id, item.id, decision, admin.username, batchId)) itemCount += 1;
      }
    }

    const reviewRows = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.userId, id), ne(reviews.reviewStatus, 'rejected')));
    let reviewCount = 0;
    for (const review of reviewRows) {
      if (await applyUserReviewDecision(review.id, decision, admin.username, batchId)) reviewCount += 1;
    }

    // 该用户历史登录/注册过的设备一并拉黑，避免换个用户名重新注册或直接登录。
    const devices = await db.select().from(userDevices).where(eq(userDevices.userId, id));
    for (const d of devices) {
      await db
        .insert(bannedDevices)
        .values({
          deviceId: d.deviceId,
          bannedReason: reason?.trim() || null,
          bannedBy: admin.username,
          bannedFromUserId: id,
        })
        .onConflictDoNothing();
    }

    const result: BanUserResultDto = {
      user: toAdminUserDto(updated!, devices.length),
      rejectedCounts: { restaurants: restaurantCount, menuItems: itemCount, reviews: reviewCount },
      bannedDeviceCount: devices.length,
    };
    return c.json(result);
  });
