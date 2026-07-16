import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type {
  ModerationItemDetailDto,
  ModerationItemDto,
  ModerationRestaurantDetailDto,
  ModerationUserReviewDetailDto,
  ReviewStatus,
} from '@sim-waimai/shared';
import { db } from '../db/client';
import { menuItems, restaurants, reviews, users } from '../db/schema';
import { toMenuItem, toRestaurant, toReviewDto } from '../lib/mappers';
import { applyRatingDelta } from '../lib/ratings';
import { UUID_RE, validateJson } from '../lib/validate';
import { requireAdmin } from '../middleware/auth';

const LIST_LIMIT = 100;

const statusSchema = z.enum(['pending', 'approved', 'rejected']);

const reviewSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    reason: z.string().max(200).optional(),
  })
  .refine((b) => b.decision !== 'rejected' || !!b.reason?.trim(), {
    message: '驳回必须填写原因',
  });

type RestaurantRow = typeof restaurants.$inferSelect;
type MenuItemRow = typeof menuItems.$inferSelect;
type UserReviewRow = typeof reviews.$inferSelect;
type ReviewMetaRow = Pick<
  RestaurantRow,
  'reviewStatus' | 'rejectReason' | 'reviewedAt' | 'reviewedBy' | 'aiVerdict' | 'aiReason' | 'aiConfidence'
>;

/** Username of the owning user, or null for platform-seeded rows / anonymous. */
async function lookupOwnerUsername(ownerId: string | null): Promise<string | null> {
  if (!ownerId) return null;
  const [owner] = await db.select({ username: users.username }).from(users).where(eq(users.id, ownerId));
  return owner?.username ?? null;
}

/** The review/AI metadata fields shared by both detail DTOs (restaurants and menu_items rows). */
function toReviewMeta(row: ReviewMetaRow, ownerUsername: string | null) {
  return {
    reviewStatus: row.reviewStatus,
    rejectReason: row.rejectReason,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedBy: row.reviewedBy,
    ownerUsername,
    aiVerdict: row.aiVerdict,
    aiReason: row.aiReason,
    aiConfidence: row.aiConfidence,
  };
}

function toRestaurantModerationItem(row: RestaurantRow, ownerUsername: string | null): ModerationItemDto {
  return {
    targetType: 'restaurant',
    restaurantId: row.id,
    restaurantName: row.name,
    name: row.name,
    emoji: row.emoji,
    category: row.category,
    tags: row.tags,
    reviewStatus: row.reviewStatus,
    rejectReason: row.rejectReason,
    reviewedBy: row.reviewedBy,
    ownerUsername,
    aiVerdict: row.aiVerdict,
    aiReason: row.aiReason,
    aiConfidence: row.aiConfidence,
  };
}

function toItemModerationItem(
  row: MenuItemRow,
  restaurantName: string,
  ownerUsername: string | null,
): ModerationItemDto {
  return {
    targetType: 'menuItem',
    restaurantId: row.restaurantId,
    restaurantName,
    itemId: row.id,
    name: row.name,
    emoji: row.emoji,
    category: row.menuCategory,
    description: row.description || undefined,
    reviewStatus: row.reviewStatus,
    rejectReason: row.rejectReason,
    reviewedBy: row.reviewedBy,
    ownerUsername,
    aiVerdict: row.aiVerdict,
    aiReason: row.aiReason,
    aiConfidence: row.aiConfidence,
  };
}

function toUserReviewModerationItem(
  row: UserReviewRow,
  restaurantName: string,
  authorUsername: string | null,
): ModerationItemDto {
  return {
    targetType: 'review',
    restaurantId: row.restaurantId,
    restaurantName,
    reviewId: row.id,
    name: authorUsername ?? '匿名用户',
    emoji: '💬',
    category: `${row.rating}星评价`,
    description: row.content || undefined,
    rating: row.rating,
    photos: row.photos,
    reviewStatus: row.reviewStatus,
    rejectReason: row.rejectReason,
    reviewedBy: row.reviewedBy,
    ownerUsername: authorUsername,
    aiVerdict: row.aiVerdict,
    aiReason: row.aiReason,
    aiConfidence: row.aiConfidence,
  };
}

export const adminRoutes = new Hono()
  .get('/moderation', requireAdmin, async (c) => {
    const parsed = statusSchema.safeParse(c.req.query('status') ?? 'pending');
    if (!parsed.success) return c.json({ error: '无效的审核状态' }, 400);
    const status: ReviewStatus = parsed.data;

    // 店铺和商品合并为一个列表；演示场景不做游标分页，各取前 LIST_LIMIT 条。
    const shopRows = await db
      .select({ restaurant: restaurants, ownerUsername: users.username })
      .from(restaurants)
      .leftJoin(users, eq(users.id, restaurants.ownerId))
      .where(eq(restaurants.reviewStatus, status))
      .orderBy(desc(restaurants.createdAt))
      .limit(LIST_LIMIT);

    const itemRows = await db
      .select({ item: menuItems, restaurantName: restaurants.name, ownerUsername: users.username })
      .from(menuItems)
      .innerJoin(restaurants, eq(restaurants.id, menuItems.restaurantId))
      .leftJoin(users, eq(users.id, restaurants.ownerId))
      .where(eq(menuItems.reviewStatus, status))
      .orderBy(asc(menuItems.restaurantId), asc(menuItems.sortOrder))
      .limit(LIST_LIMIT);

    const reviewRows = await db
      .select({ review: reviews, restaurantName: restaurants.name, authorUsername: users.username })
      .from(reviews)
      .innerJoin(restaurants, eq(restaurants.id, reviews.restaurantId))
      .innerJoin(users, eq(users.id, reviews.userId))
      .where(eq(reviews.reviewStatus, status))
      .orderBy(desc(reviews.createdAt))
      .limit(LIST_LIMIT);

    const list: ModerationItemDto[] = [
      ...shopRows.map((r) => toRestaurantModerationItem(r.restaurant, r.ownerUsername)),
      ...itemRows.map((r) => toItemModerationItem(r.item, r.restaurantName, r.ownerUsername)),
      ...reviewRows.map((r) => toUserReviewModerationItem(r.review, r.restaurantName, r.authorUsername)),
    ];
    return c.json(list);
  })
  .get('/reviews/:reviewId', requireAdmin, async (c) => {
    const reviewId = c.req.param('reviewId');
    if (!UUID_RE.test(reviewId)) return c.json({ error: '评价不存在' }, 404);
    const [row] = await db
      .select({ review: reviews, restaurantName: restaurants.name, authorUsername: users.username })
      .from(reviews)
      .innerJoin(restaurants, eq(restaurants.id, reviews.restaurantId))
      .innerJoin(users, eq(users.id, reviews.userId))
      .where(eq(reviews.id, reviewId));
    if (!row) return c.json({ error: '评价不存在' }, 404);
    const detail: ModerationUserReviewDetailDto = {
      targetType: 'review',
      restaurantId: row.review.restaurantId,
      restaurantName: row.restaurantName,
      review: toReviewDto(row.review, row.authorUsername),
      ...toReviewMeta(row.review, row.authorUsername),
    };
    return c.json(detail);
  })
  .post('/reviews/:reviewId/review', requireAdmin, validateJson(reviewSchema), async (c) => {
    const admin = c.get('user');
    const body = c.req.valid('json');
    const reviewId = c.req.param('reviewId');
    if (!UUID_RE.test(reviewId)) return c.json({ error: '评价不存在' }, 404);
    // FOR UPDATE 锁行取旧状态：与在途的 AI 审核（WHERE pending）串行化，
    // 聚合按旧→新状态转移（只有 approved 计入店铺评分）。
    const row = await db.transaction(async (tx) => {
      const [old] = await tx.select().from(reviews).where(eq(reviews.id, reviewId)).for('update');
      if (!old) return null;
      const [updated] = await tx
        .update(reviews)
        .set({
          reviewStatus: body.decision,
          rejectReason: body.decision === 'rejected' ? body.reason!.trim() : null,
          reviewedAt: new Date(),
          reviewedBy: admin.username,
        })
        .where(eq(reviews.id, reviewId))
        .returning();
      const wasCounted = old.reviewStatus === 'approved';
      const nowCounted = body.decision === 'approved';
      if (!wasCounted && nowCounted) await applyRatingDelta(tx, old.restaurantId, old.rating, 1);
      else if (wasCounted && !nowCounted) await applyRatingDelta(tx, old.restaurantId, -old.rating, -1);
      return updated;
    });
    if (!row) return c.json({ error: '评价不存在' }, 404);
    const [meta] = await db
      .select({ restaurantName: restaurants.name, authorUsername: users.username })
      .from(reviews)
      .innerJoin(restaurants, eq(restaurants.id, reviews.restaurantId))
      .innerJoin(users, eq(users.id, reviews.userId))
      .where(eq(reviews.id, reviewId));
    return c.json(toUserReviewModerationItem(row, meta?.restaurantName ?? '', meta?.authorUsername ?? null));
  })
  .get('/restaurants/:id', requireAdmin, async (c) => {
    const [row] = await db.select().from(restaurants).where(eq(restaurants.id, c.req.param('id')));
    if (!row) return c.json({ error: '店铺不存在' }, 404);
    const detail: ModerationRestaurantDetailDto = {
      targetType: 'restaurant',
      // menu 不展示，菜品各自独立走审核（见 GET .../items/:itemId）。
      restaurant: toRestaurant(row, []),
      ...toReviewMeta(row, await lookupOwnerUsername(row.ownerId)),
    };
    return c.json(detail);
  })
  .get('/restaurants/:id/items/:itemId', requireAdmin, async (c) => {
    const restaurantId = c.req.param('id');
    const itemId = c.req.param('itemId');
    const [row] = await db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.restaurantId, restaurantId), eq(menuItems.id, itemId)));
    if (!row) return c.json({ error: '菜品不存在' }, 404);
    const [shop] = await db
      .select({ name: restaurants.name, ownerId: restaurants.ownerId })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId));
    const detail: ModerationItemDetailDto = {
      targetType: 'menuItem',
      restaurantId,
      restaurantName: shop?.name ?? '',
      item: toMenuItem(row),
      ...toReviewMeta(row, await lookupOwnerUsername(shop?.ownerId ?? null)),
    };
    return c.json(detail);
  })
  .post('/restaurants/:id/review', requireAdmin, validateJson(reviewSchema), async (c) => {
    const admin = c.get('user');
    const body = c.req.valid('json');
    // 不加 WHERE pending：管理员可覆盖任何状态（含推翻 AI 结论）。
    const [row] = await db
      .update(restaurants)
      .set({
        reviewStatus: body.decision,
        rejectReason: body.decision === 'rejected' ? body.reason!.trim() : null,
        reviewedAt: new Date(),
        reviewedBy: admin.username,
      })
      .where(eq(restaurants.id, c.req.param('id')))
      .returning();
    if (!row) return c.json({ error: '店铺不存在' }, 404);
    return c.json(toRestaurantModerationItem(row, await lookupOwnerUsername(row.ownerId)));
  })
  .post('/restaurants/:id/items/:itemId/review', requireAdmin, validateJson(reviewSchema), async (c) => {
    const admin = c.get('user');
    const body = c.req.valid('json');
    const [row] = await db
      .update(menuItems)
      .set({
        reviewStatus: body.decision,
        rejectReason: body.decision === 'rejected' ? body.reason!.trim() : null,
        reviewedAt: new Date(),
        reviewedBy: admin.username,
      })
      .where(and(eq(menuItems.restaurantId, c.req.param('id')), eq(menuItems.id, c.req.param('itemId'))))
      .returning();
    if (!row) return c.json({ error: '菜品不存在' }, 404);
    const [shop] = await db
      .select({ name: restaurants.name, ownerId: restaurants.ownerId })
      .from(restaurants)
      .where(eq(restaurants.id, row.restaurantId));
    return c.json(
      toItemModerationItem(row, shop?.name ?? '', await lookupOwnerUsername(shop?.ownerId ?? null)),
    );
  });
