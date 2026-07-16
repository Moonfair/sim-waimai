import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { CATEGORIES, yuanToFen } from '@sim-waimai/shared';
import type { MerchantMenuItemDto, MerchantRestaurantDto } from '@sim-waimai/shared';
import { db } from '../db/client';
import { menuItems, restaurants, reviews, users } from '../db/schema';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import { imageUrlSchema } from '../lib/imageUrl';
import {
  toMenuItem,
  toMerchantReviewDto,
  toRestaurantSummary,
  type MenuItemRow,
  type RestaurantRow,
} from '../lib/mappers';
import { queueReview } from '../lib/moderation';
import type { ModerationInput } from '../lib/moderationProvider';
import { validateJson } from '../lib/validate';
import { requireAuth } from '../middleware/auth';
import type { AuthPayload } from '../lib/jwt';

const merchantCategory = z
  .string()
  .refine((v): v is (typeof CATEGORIES)[number] => v !== '全部' && CATEGORIES.includes(v as (typeof CATEGORIES)[number]), '无效的餐厅品类');

const restaurantBaseSchema = z.object({
  name: z.string().min(1, '请填写店铺名称').max(20, '店铺名称最多20个字符'),
  category: merchantCategory,
  emoji: z.string().min(1, '请选择一个店铺emoji').max(8),
  bgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色格式应为 #RRGGBB'),
  deliveryFee: z.number().min(0).max(100),
  minOrder: z.number().min(0).max(1000),
  deliveryTime: z.number().int().min(5).max(120),
  tags: z.array(z.string().min(1).max(10)).max(5).default([]),
  menuCategories: z.array(z.string().min(1).max(10)).min(1, '至少需要一个菜单分类').max(10),
});

const optionGroupsSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(30),
      name: z.string().min(1).max(20),
      selectionType: z.enum(['single', 'multi']),
      required: z.boolean(),
      options: z
        .array(
          z.object({
            id: z.string().min(1).max(30),
            name: z.string().min(1).max(30),
            priceDelta: z.number().min(0).max(1000),
          }),
        )
        .min(1, '规格组至少要有一个选项')
        .max(20),
      defaultOptionIds: z.array(z.string()).max(20).optional(),
    }),
  )
  .max(10)
  .superRefine((groups, ctx) => {
    const groupIds = new Set<string>();
    for (const g of groups) {
      if (groupIds.has(g.id)) {
        ctx.addIssue({ code: 'custom', message: '规格组 id 重复' });
        return;
      }
      groupIds.add(g.id);
      const optionIds = new Set<string>();
      for (const o of g.options) {
        if (optionIds.has(o.id)) {
          ctx.addIssue({ code: 'custom', message: `规格组「${g.name}」选项 id 重复` });
          return;
        }
        optionIds.add(o.id);
      }
      if (g.selectionType === 'single' && g.required) {
        const defaults = g.defaultOptionIds ?? [];
        if (defaults.length !== 1 || !optionIds.has(defaults[0])) {
          ctx.addIssue({
            code: 'custom',
            message: `必选规格组「${g.name}」需要设置一个默认选项`,
          });
          return;
        }
      }
    }
  });

// zod 的 .partial() 不会移除 .default()：缺席字段仍被注入默认值，PATCH 会把
// tags/description 等悄悄重置并误触发重审。PATCH 专用 schema 把带默认值的字段
// 覆盖为纯 optional。
const restaurantPatchSchema = restaurantBaseSchema.partial().extend({
  tags: z.array(z.string().min(1).max(10)).max(5).optional(),
  isActive: z.boolean().optional(),
  bannerImage: imageUrlSchema.nullable().optional(),
});

const itemBaseSchema = z.object({
  name: z.string().min(1, '请填写菜品名称').max(30),
  description: z.string().max(100).default(''),
  price: z.number().min(0.01, '请填写价格').max(10000),
  calories: z.number().int().min(0).max(10000).default(0),
  emoji: z.string().min(1, '请选择一个菜品emoji').max(8),
  menuCategory: z.string().min(1, '请选择菜单分类').max(10),
  popular: z.boolean().default(false),
  image: imageUrlSchema.optional(),
  optionGroups: optionGroupsSchema.optional(),
});

const itemPatchSchema = itemBaseSchema.partial().extend({
  description: z.string().max(100).optional(),
  calories: z.number().int().min(0).max(10000).optional(),
  popular: z.boolean().optional(),
  isListed: z.boolean().optional(),
});

function toMerchantMenuItem(row: MenuItemRow): MerchantMenuItemDto {
  return {
    ...toMenuItem(row),
    isListed: row.isListed,
    reviewStatus: row.reviewStatus,
    rejectReason: row.rejectReason,
  };
}

function toMerchantRestaurant(row: RestaurantRow, items: MenuItemRow[]): MerchantRestaurantDto {
  return {
    ...toRestaurantSummary(row),
    isActive: row.isActive,
    reviewStatus: row.reviewStatus,
    rejectReason: row.rejectReason,
    menuCategories: row.menuCategories,
    menu: items.map(toMerchantMenuItem),
  };
}

/** 对外展示字段：命中任一即重新进入待审核（营业状态/价格等不触发）。 */
const RESTAURANT_MODERATED_FIELDS = ['name', 'category', 'emoji', 'tags', 'menuCategories', 'bannerImage'] as const;
const ITEM_MODERATED_FIELDS = ['name', 'description', 'emoji', 'menuCategory', 'image', 'optionGroups'] as const;

/** 重审时连同旧的审核结论一起清空（含 AI 建议，避免展示编辑前已过时的判断）。 */
const RESET_REVIEW = {
  reviewStatus: 'pending' as const,
  rejectReason: null,
  reviewedAt: null,
  reviewedBy: null,
  aiVerdict: null,
  aiReason: null,
  aiConfidence: null,
};

function restaurantContent(row: RestaurantRow): ModerationInput {
  return {
    texts: [row.name, row.category, row.emoji, ...row.tags, ...row.menuCategories],
    images: row.bannerImage ? [row.bannerImage] : [],
  };
}

function itemContent(row: MenuItemRow): ModerationInput {
  return {
    texts: [
      row.name,
      row.menuCategory,
      row.emoji,
      row.description,
      ...(row.optionGroups?.flatMap((g) => [g.name, ...g.options.map((o) => o.name)]) ?? []),
    ],
    images: row.image ? [row.image] : [],
  };
}

/** Loads the restaurant and enforces ownership. Returns null after answering the request. */
async function ownedRestaurant(user: AuthPayload, id: string) {
  const [row] = await db.select().from(restaurants).where(eq(restaurants.id, id));
  if (!row) return { status: 404 as const, error: '店铺不存在' };
  if (row.ownerId !== user.sub) return { status: 403 as const, error: '无权管理该店铺' };
  return { row };
}

export const merchantRoutes = new Hono()
  .get('/restaurants', requireAuth, async (c) => {
    const user = c.get('user');
    const rows = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.ownerId, user.sub))
      .orderBy(desc(restaurants.createdAt));
    return c.json(
      rows.map((r) => ({
        ...toRestaurantSummary(r),
        isActive: r.isActive,
        reviewStatus: r.reviewStatus,
        rejectReason: r.rejectReason,
      })),
    );
  })
  .post('/restaurants', requireAuth, validateJson(restaurantBaseSchema), async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const [row] = await db
      .insert(restaurants)
      .values({
        id: `u-${nanoid(10)}`,
        ownerId: user.sub,
        sortOrder: 100, // user shops list after the platform-seeded ones
        name: body.name,
        category: body.category,
        deliveryFeeFen: yuanToFen(body.deliveryFee),
        minOrderFen: yuanToFen(body.minOrder),
        deliveryTime: body.deliveryTime,
        emoji: body.emoji,
        bgColor: body.bgColor,
        tags: body.tags,
        menuCategories: body.menuCategories,
        reviewStatus: 'pending',
      })
      .returning();
    queueReview({ table: 'restaurants', restaurantId: row!.id }, restaurantContent(row!));
    return c.json(toMerchantRestaurant(row!, []));
  })
  .get('/restaurants/:id', requireAuth, async (c) => {
    const owned = await ownedRestaurant(c.get('user'), c.req.param('id'));
    if ('error' in owned) return c.json({ error: owned.error }, owned.status);
    const items = await db
      .select()
      .from(menuItems)
      .where(eq(menuItems.restaurantId, owned.row.id))
      .orderBy(asc(menuItems.sortOrder));
    return c.json(toMerchantRestaurant(owned.row, items));
  })
  .get('/restaurants/:id/reviews', requireAuth, async (c) => {
    const owned = await ownedRestaurant(c.get('user'), c.req.param('id'));
    if ('error' in owned) return c.json({ error: owned.error }, owned.status);
    const limitRaw = Number(c.req.query('limit') ?? 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 10, 1), 50);

    // 只列已过审的评价（含被商家隐藏的）：未过审的尚未公开，无从管理，也不该泄露给商家
    const filters = [eq(reviews.restaurantId, owned.row.id), eq(reviews.reviewStatus, 'approved')];
    const cursorParam = c.req.query('cursor');
    if (cursorParam) {
      const cursor = decodeCursor(cursorParam);
      if (!cursor) return c.json({ error: '无效的分页游标' }, 400);
      filters.push(
        sql`(${reviews.createdAt}, ${reviews.id}) < (${cursor.createdAt}, ${cursor.id}::uuid)`,
      );
    }

    const rows = await db
      .select({ review: reviews, username: users.username })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.userId))
      .where(and(...filters))
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return c.json({
      items: page.map((r) => toMerchantReviewDto(r.review, r.username)),
      nextCursor: hasMore && last ? encodeCursor(last.review.createdAt, last.review.id) : null,
    });
  })
  .patch(
    '/restaurants/:id',
    requireAuth,
    validateJson(restaurantPatchSchema),
    async (c) => {
      const owned = await ownedRestaurant(c.get('user'), c.req.param('id'));
      if ('error' in owned) return c.json({ error: owned.error }, owned.status);
      const body = c.req.valid('json');
      const patch: Partial<typeof restaurants.$inferInsert> = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.category !== undefined) patch.category = body.category;
      if (body.emoji !== undefined) patch.emoji = body.emoji;
      if (body.bgColor !== undefined) patch.bgColor = body.bgColor;
      if (body.deliveryFee !== undefined) patch.deliveryFeeFen = yuanToFen(body.deliveryFee);
      if (body.minOrder !== undefined) patch.minOrderFen = yuanToFen(body.minOrder);
      if (body.deliveryTime !== undefined) patch.deliveryTime = body.deliveryTime;
      if (body.tags !== undefined) patch.tags = body.tags;
      if (body.menuCategories !== undefined) patch.menuCategories = body.menuCategories;
      if (body.isActive !== undefined) patch.isActive = body.isActive;
      if (body.bannerImage !== undefined) patch.bannerImage = body.bannerImage;
      if (Object.keys(patch).length === 0) return c.json({ error: '没有需要更新的内容' }, 400);
      const needsReview = RESTAURANT_MODERATED_FIELDS.some((f) => body[f] !== undefined);
      if (needsReview) Object.assign(patch, RESET_REVIEW);
      const [row] = await db
        .update(restaurants)
        .set(patch)
        .where(eq(restaurants.id, owned.row.id))
        .returning();
      if (needsReview) {
        queueReview({ table: 'restaurants', restaurantId: row!.id }, restaurantContent(row!));
      }
      return c.json({
        ...toRestaurantSummary(row!),
        isActive: row!.isActive,
        reviewStatus: row!.reviewStatus,
        rejectReason: row!.rejectReason,
      });
    },
  )
  .post('/restaurants/:id/items', requireAuth, validateJson(itemBaseSchema), async (c) => {
    const owned = await ownedRestaurant(c.get('user'), c.req.param('id'));
    if ('error' in owned) return c.json({ error: owned.error }, owned.status);
    const body = c.req.valid('json');
    if (!owned.row.menuCategories.includes(body.menuCategory)) {
      return c.json({ error: '菜单分类不存在，请先在店铺信息中添加' }, 400);
    }
    const [{ maxSort }] = await db
      .select({ maxSort: sql<number>`COALESCE(MAX(${menuItems.sortOrder}), 0)::int` })
      .from(menuItems)
      .where(eq(menuItems.restaurantId, owned.row.id));
    const [row] = await db
      .insert(menuItems)
      .values({
        restaurantId: owned.row.id,
        id: `i-${nanoid(8)}`,
        name: body.name,
        description: body.description,
        priceFen: yuanToFen(body.price),
        calories: body.calories,
        emoji: body.emoji,
        menuCategory: body.menuCategory,
        popular: body.popular,
        image: body.image ?? null,
        optionGroups: body.optionGroups?.length ? body.optionGroups : null,
        sortOrder: maxSort + 1,
        reviewStatus: 'pending',
      })
      .returning();
    queueReview({ table: 'menuItems', restaurantId: owned.row.id, itemId: row!.id }, itemContent(row!));
    return c.json(toMerchantMenuItem(row!));
  })
  .patch(
    '/restaurants/:id/items/:itemId',
    requireAuth,
    validateJson(itemPatchSchema),
    async (c) => {
      const owned = await ownedRestaurant(c.get('user'), c.req.param('id'));
      if ('error' in owned) return c.json({ error: owned.error }, owned.status);
      const body = c.req.valid('json');
      if (body.menuCategory !== undefined && !owned.row.menuCategories.includes(body.menuCategory)) {
        return c.json({ error: '菜单分类不存在，请先在店铺信息中添加' }, 400);
      }
      const patch: Partial<typeof menuItems.$inferInsert> = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.description !== undefined) patch.description = body.description;
      if (body.price !== undefined) patch.priceFen = yuanToFen(body.price);
      if (body.calories !== undefined) patch.calories = body.calories;
      if (body.emoji !== undefined) patch.emoji = body.emoji;
      if (body.menuCategory !== undefined) patch.menuCategory = body.menuCategory;
      if (body.popular !== undefined) patch.popular = body.popular;
      if (body.image !== undefined) patch.image = body.image;
      if (body.optionGroups !== undefined) {
        patch.optionGroups = body.optionGroups.length ? body.optionGroups : null;
      }
      if (body.isListed !== undefined) patch.isListed = body.isListed;
      if (Object.keys(patch).length === 0) return c.json({ error: '没有需要更新的内容' }, 400);
      const needsReview = ITEM_MODERATED_FIELDS.some((f) => body[f] !== undefined);
      if (needsReview) Object.assign(patch, RESET_REVIEW);
      const [row] = await db
        .update(menuItems)
        .set(patch)
        .where(
          and(eq(menuItems.restaurantId, owned.row.id), eq(menuItems.id, c.req.param('itemId'))),
        )
        .returning();
      if (!row) return c.json({ error: '菜品不存在' }, 404);
      if (needsReview) {
        queueReview({ table: 'menuItems', restaurantId: owned.row.id, itemId: row.id }, itemContent(row));
      }
      return c.json(toMerchantMenuItem(row));
    },
  )
  .delete('/restaurants/:id/items/:itemId', requireAuth, async (c) => {
    const owned = await ownedRestaurant(c.get('user'), c.req.param('id'));
    if ('error' in owned) return c.json({ error: owned.error }, owned.status);
    const [row] = await db
      .update(menuItems)
      .set({ isListed: false })
      .where(and(eq(menuItems.restaurantId, owned.row.id), eq(menuItems.id, c.req.param('itemId'))))
      .returning();
    if (!row) return c.json({ error: '菜品不存在' }, 404);
    return c.json({ ok: true });
  });
