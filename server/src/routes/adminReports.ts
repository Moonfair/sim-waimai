import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AdminReportDto, ResolveReportsResultDto } from '@sim-waimai/shared';
import { db } from '../db/client';
import { menuItems, reports, restaurants, reviews, users } from '../db/schema';
import { logAdminAction } from '../lib/auditLog';
import { applyMenuItemDecision, applyRestaurantDecision, applyUserReviewDecision } from './admin';
import { validateJson } from '../lib/validate';
import { requireAdmin } from '../middleware/auth';

const LIST_LIMIT = 100;
const BATCH_LIMIT = 50;

const resolveReportsSchema = z.object({
  reportIds: z.array(z.string()).min(1, '至少选择一条').max(BATCH_LIMIT, `单次最多 ${BATCH_LIMIT} 条`),
  decision: z.enum(['approved', 'rejected']),
});

export const adminReportsRoutes = new Hono()
  .get('/reports', requireAdmin, async (c) => {
    const shopRows = await db
      .select({ report: reports, restaurant: restaurants, reporterUsername: users.username })
      .from(reports)
      .innerJoin(restaurants, eq(restaurants.id, reports.restaurantId))
      .innerJoin(users, eq(users.id, reports.reporterId))
      .where(eq(reports.targetType, 'restaurant'))
      .orderBy(desc(reports.createdAt))
      .limit(LIST_LIMIT);

    const itemRows = await db
      .select({
        report: reports,
        item: menuItems,
        restaurantName: restaurants.name,
        reporterUsername: users.username,
      })
      .from(reports)
      .innerJoin(restaurants, eq(restaurants.id, reports.restaurantId))
      .innerJoin(menuItems, and(eq(menuItems.restaurantId, reports.restaurantId), eq(menuItems.id, reports.itemId)))
      .innerJoin(users, eq(users.id, reports.reporterId))
      .where(eq(reports.targetType, 'menuItem'))
      .orderBy(desc(reports.createdAt))
      .limit(LIST_LIMIT);

    const reviewRows = await db
      .select({
        report: reports,
        review: reviews,
        restaurantName: restaurants.name,
        reporterUsername: users.username,
      })
      .from(reports)
      .innerJoin(restaurants, eq(restaurants.id, reports.restaurantId))
      .innerJoin(reviews, eq(reviews.id, reports.reviewId))
      .innerJoin(users, eq(users.id, reports.reporterId))
      .where(eq(reports.targetType, 'review'))
      .orderBy(desc(reports.createdAt))
      .limit(LIST_LIMIT);

    // 评价举报还需要作者用户名（区别于举报人），单独按 authorId 再查一遍。
    const reviewAuthorRows = await Promise.all(
      reviewRows.map(async (r) => {
        const [author] = await db.select({ username: users.username }).from(users).where(eq(users.id, r.review.userId));
        return { ...r, authorUsername: author?.username ?? '匿名用户' };
      }),
    );

    const list: AdminReportDto[] = [
      ...shopRows.map(
        (r): AdminReportDto => ({
          id: r.report.id,
          targetType: 'restaurant',
          restaurantId: r.restaurant.id,
          restaurantName: r.restaurant.name,
          name: r.restaurant.name,
          emoji: r.restaurant.emoji,
          category: r.restaurant.category,
          image: r.restaurant.bannerImage,
          reason: r.report.reason,
          reporterUsername: r.reporterUsername,
          createdAt: r.report.createdAt.toISOString(),
        }),
      ),
      ...itemRows.map(
        (r): AdminReportDto => ({
          id: r.report.id,
          targetType: 'menuItem',
          restaurantId: r.report.restaurantId,
          restaurantName: r.restaurantName,
          itemId: r.item.id,
          name: r.item.name,
          emoji: r.item.emoji,
          category: r.item.menuCategory,
          description: r.item.description || undefined,
          image: r.item.image,
          reason: r.report.reason,
          reporterUsername: r.reporterUsername,
          createdAt: r.report.createdAt.toISOString(),
        }),
      ),
      ...reviewAuthorRows.map(
        (r): AdminReportDto => ({
          id: r.report.id,
          targetType: 'review',
          restaurantId: r.report.restaurantId,
          restaurantName: r.restaurantName,
          reviewId: r.review.id,
          name: r.authorUsername,
          emoji: '💬',
          category: `${r.review.rating}星评价`,
          description: r.review.content || undefined,
          rating: r.review.rating,
          photos: r.review.photos,
          reason: r.report.reason,
          reporterUsername: r.reporterUsername,
          createdAt: r.report.createdAt.toISOString(),
        }),
      ),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return c.json(list);
  })
  .post('/reports/resolve', requireAdmin, validateJson(resolveReportsSchema), async (c) => {
    const admin = c.get('user');
    const { reportIds, decision } = c.req.valid('json');
    const batchId = randomUUID();

    const failed: ResolveReportsResultDto['failed'] = [];
    let succeeded = 0;

    for (const reportId of reportIds) {
      const [report] = await db.select().from(reports).where(eq(reports.id, reportId));
      if (!report) {
        failed.push({ reportId, error: '举报不存在' });
        continue;
      }

      if (decision === 'approved') {
        const targetDecision = { decision: 'rejected' as const, reason: report.reason };
        let targetOk = true;
        if (report.targetType === 'restaurant') {
          targetOk =
            (await applyRestaurantDecision(report.restaurantId, targetDecision, admin.username, batchId)) !== null;
        } else if (report.targetType === 'menuItem') {
          targetOk =
            (await applyMenuItemDecision(
              report.restaurantId,
              report.itemId!,
              targetDecision,
              admin.username,
              batchId,
            )) !== null;
        } else {
          targetOk =
            (await applyUserReviewDecision(report.reviewId!, targetDecision, admin.username, batchId)) !== null;
        }
        if (!targetOk) {
          failed.push({ reportId, error: '目标已不存在' });
          continue;
        }
      }

      // 举报行本身随后被删除（不保留历史），这条审计日志就是它唯一留下的记录。
      await logAdminAction({
        actorUsername: admin.username,
        action: 'report.resolve',
        targetType: 'report',
        targetId: report.id,
        targetLabel: report.reason.slice(0, 50),
        detail: {
          decision,
          reportTargetType: report.targetType,
          restaurantId: report.restaurantId,
          itemId: report.itemId,
          reviewId: report.reviewId,
        },
        batchId,
      });

      await db.delete(reports).where(eq(reports.id, reportId));
      succeeded += 1;
    }

    const result: ResolveReportsResultDto = { succeeded, failed };
    return c.json(result);
  });
