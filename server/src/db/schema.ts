import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  AddressSnapshot,
  AiVerdict,
  MenuItemOptionGroup,
  OrderItemSnapshot,
  OrderStatus,
  ReviewStatus,
  Rider,
} from '@sim-waimai/shared';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    isBanned: boolean('is_banned').notNull().default(false),
    bannedAt: timestamp('banned_at', { withTimezone: true }),
    bannedReason: text('banned_reason'),
    /** 执行封禁的管理员 username. */
    bannedBy: text('banned_by'),
  },
  (t) => [uniqueIndex('users_username_lower_idx').on(sql`lower(${t.username})`)],
);

/** 记录某用户历史上用过的设备指纹，用于封禁时定位其关联设备。 */
export const userDevices = pgTable(
  'user_devices',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.deviceId] }),
    index('user_devices_device_idx').on(t.deviceId),
  ],
);

/** 设备指纹黑名单：命中的设备无法注册新账号或登录任何账号。 */
export const bannedDevices = pgTable('banned_devices', {
  deviceId: text('device_id').primaryKey(),
  bannedAt: timestamp('banned_at', { withTimezone: true }).notNull().defaultNow(),
  bannedReason: text('banned_reason'),
  /** 执行封禁的管理员 username. */
  bannedBy: text('banned_by').notNull(),
  /** 触发本次封禁的用户账号（审计追溯用；用户被删也不影响设备黑名单本身）. */
  bannedFromUserId: uuid('banned_from_user_id').references(() => users.id, { onDelete: 'set null' }),
});

export const restaurants = pgTable(
  'restaurants',
  {
    /** Seed restaurants keep their slug ids ("laoxiangji"); user-created ones get nanoid. */
    id: text('id').primaryKey(),
    /** NULL = platform-seeded restaurant with no owning user. */
    ownerId: uuid('owner_id').references(() => users.id),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Manual override for homepage recommendation placement (admin-set for player shops), see
     *  recommendations.ts. The top preset (TOP_PIN_PRIORITY=100, "置顶") guarantees a slot and
     *  front placement; lower positive values only tilt weightedSample's odds, not a hard sort.
     *  Any value >0 also exempts the shop from the low-activity exclusion (see lowActivity.ts),
     *  since an explicit boost is treated as an admin override. */
    recommendPriority: integer('recommend_priority').notNull().default(0),
    name: text('name').notNull(),
    category: text('category').notNull(),
    rating: real('rating').notNull().default(5),
    ratingCount: integer('rating_count').notNull().default(0),
    /** Running sum of review scores so the aggregate stays exact. */
    ratingSum: integer('rating_sum').notNull().default(0),
    monthlyOrders: integer('monthly_orders').notNull().default(0),
    deliveryFeeFen: integer('delivery_fee_fen').notNull(),
    minOrderFen: integer('min_order_fen').notNull(),
    deliveryTime: integer('delivery_time').notNull(),
    emoji: text('emoji').notNull(),
    bgColor: text('bg_color').notNull(),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    menuCategories: jsonb('menu_categories').$type<string[]>().notNull().default([]),
    bannerImage: text('banner_image'),
    isActive: boolean('is_active').notNull().default(true),
    /** Default 'approved' so seeded/backfilled rows pass; merchant routes stamp 'pending' explicitly. */
    reviewStatus: text('review_status').$type<ReviewStatus>().notNull().default('approved'),
    rejectReason: text('reject_reason'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** 'ai' or the deciding admin's username. */
    reviewedBy: text('reviewed_by'),
    /** AI's own verdict/reasoning, persisted even when it left the item pending (uncertain). */
    aiVerdict: text('ai_verdict').$type<AiVerdict>(),
    aiReason: text('ai_reason'),
    aiConfidence: real('ai_confidence'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('restaurants_review_status_check', sql`${t.reviewStatus} IN ('pending', 'approved', 'rejected')`),
    check('restaurants_ai_verdict_check', sql`${t.aiVerdict} IN ('approve', 'reject', 'uncertain')`),
    index('restaurants_category_idx').on(t.category),
    index('restaurants_owner_idx').on(t.ownerId),
    index('restaurants_rating_idx').on(t.rating.desc(), t.monthlyOrders.desc()),
    index('restaurants_review_status_idx').on(t.reviewStatus),
  ],
);

export const menuItems = pgTable(
  'menu_items',
  {
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    /** Unique per restaurant only (seed ids like "hfj"), hence the composite PK. */
    id: text('id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    priceFen: integer('price_fen').notNull(),
    calories: integer('calories').notNull().default(0),
    emoji: text('emoji').notNull(),
    menuCategory: text('menu_category').notNull(),
    popular: boolean('popular').notNull().default(false),
    image: text('image'),
    optionGroups: jsonb('option_groups').$type<MenuItemOptionGroup[]>(),
    /** Soft delete: delisted items stay for order-history integrity. */
    isListed: boolean('is_listed').notNull().default(true),
    /** Default 'approved' so seeded/backfilled rows pass; merchant routes stamp 'pending' explicitly. */
    reviewStatus: text('review_status').$type<ReviewStatus>().notNull().default('approved'),
    rejectReason: text('reject_reason'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** 'ai' or the deciding admin's username. */
    reviewedBy: text('reviewed_by'),
    /** AI's own verdict/reasoning, persisted even when it left the item pending (uncertain). */
    aiVerdict: text('ai_verdict').$type<AiVerdict>(),
    aiReason: text('ai_reason'),
    aiConfidence: real('ai_confidence'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.restaurantId, t.id] }),
    check('menu_items_review_status_check', sql`${t.reviewStatus} IN ('pending', 'approved', 'rejected')`),
    check('menu_items_ai_verdict_check', sql`${t.aiVerdict} IN ('approve', 'reject', 'uncertain')`),
    index('menu_items_review_status_idx').on(t.reviewStatus),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    restaurantSnapshot: jsonb('restaurant_snapshot')
      .$type<{ name: string; emoji: string; bgColor: string }>()
      .notNull(),
    status: text('status').$type<OrderStatus>().notNull().default('pending'),
    items: jsonb('items').$type<OrderItemSnapshot[]>().notNull(),
    subtotalFen: integer('subtotal_fen').notNull(),
    deliveryFeeFen: integer('delivery_fee_fen').notNull(),
    /** 满减 promotion applied at checkout (subtotal ≥ ¥30 → ¥3 off). */
    discountFen: integer('discount_fen').notNull().default(0),
    totalFen: integer('total_fen').notNull(),
    totalCalories: integer('total_calories').notNull(),
    addressSnapshot: jsonb('address_snapshot').$type<AddressSnapshot>().notNull(),
    /** Assigned when the order moves to delivering. */
    riderSnapshot: jsonb('rider_snapshot').$type<Rider>(),
    /** 'simulated' (今天的假流程) or 'real_person' (进入抢单大厅，由真实用户接单)。 */
    deliveryType: text('delivery_type').$type<'simulated' | 'real_person'>().notNull().default('simulated'),
    /** 抢单成功的用户；null 表示还没人接单。 */
    riderUserId: uuid('rider_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** 被抢单的那一刻；createdAt→grabbedAt 即真实等待接单耗时。 */
    grabbedAt: timestamp('grabbed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    check('orders_status_check', sql`${t.status} IN ('pending', 'delivering', 'completed')`),
    check('orders_delivery_type_check', sql`${t.deliveryType} IN ('simulated', 'real_person')`),
    /** THE index for per-user history with keyset pagination. */
    index('orders_user_history_idx').on(t.userId, t.createdAt.desc(), t.id.desc()),
    index('orders_restaurant_idx').on(t.restaurantId, t.createdAt.desc()),
    /** 抢单大厅查询：待接取的真人配送订单，按时间倒序。 */
    index('orders_rider_hall_idx').on(t.deliveryType, t.status, t.riderUserId, t.createdAt.desc()),
  ],
);

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .unique()
      .references(() => orders.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id),
    rating: smallint('rating').notNull(),
    content: text('content').notNull().default(''),
    photos: jsonb('photos').$type<string[]>().notNull().default([]),
    /** 非 NULL = 被商家隐藏（软删除），不在店铺页公开展示；顾客本人订单里仍可见。 */
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    /** Default 'approved' so pre-moderation rows pass; the create route stamps 'pending' explicitly. */
    reviewStatus: text('review_status').$type<ReviewStatus>().notNull().default('approved'),
    rejectReason: text('reject_reason'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** 'ai' or the deciding admin's username. */
    reviewedBy: text('reviewed_by'),
    /** AI's own verdict/reasoning, persisted even when it left the review pending (uncertain). */
    aiVerdict: text('ai_verdict').$type<AiVerdict>(),
    aiReason: text('ai_reason'),
    aiConfidence: real('ai_confidence'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('reviews_rating_check', sql`${t.rating} BETWEEN 1 AND 5`),
    check('reviews_review_status_check', sql`${t.reviewStatus} IN ('pending', 'approved', 'rejected')`),
    check('reviews_ai_verdict_check', sql`${t.aiVerdict} IN ('approve', 'reject', 'uncertain')`),
    index('reviews_restaurant_idx').on(t.restaurantId, t.createdAt.desc()),
    index('reviews_review_status_idx').on(t.reviewStatus),
  ],
);

export const favorites = pgTable(
  'favorites',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.restaurantId] }),
    index('favorites_user_idx').on(t.userId, t.createdAt.desc()),
  ],
);

/** 审核积压邮件提醒的去重状态：固定单行（id='moderation_backlog'）。 */
export const moderationAlertState = pgTable('moderation_alert_state', {
  id: text('id').primaryKey(),
  isBreaching: boolean('is_breaching').notNull().default(false),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetType: text('target_type').$type<'restaurant' | 'menuItem' | 'review'>().notNull(),
    restaurantId: text('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    /** 仅 targetType === 'menuItem' 时非空。 */
    itemId: text('item_id'),
    /** 仅 targetType === 'review' 时非空。 */
    reviewId: uuid('review_id').references(() => reviews.id),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('reports_target_type_check', sql`${t.targetType} IN ('restaurant', 'menuItem', 'review')`),
    index('reports_created_idx').on(t.createdAt.desc()),
  ],
);

/** 更新日志公告，版本号在插入时按 max(version)+1 顺序生成。 */
export const changelogEntries = pgTable(
  'changelog_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** 发布者 username（管理员或被授权的编辑用户）。 */
    createdBy: text('created_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    /** 最近一次编辑者 username；未编辑过则为 null。 */
    updatedBy: text('updated_by'),
  },
  (t) => [uniqueIndex('changelog_entries_version_idx').on(t.version)],
);

/** 被管理员额外授权、可编辑更新日志的普通用户名单（管理员本身无需在此表中）。 */
export const changelogEditors = pgTable('changelog_editors', {
  /** 小写 username，与 users_username_lower_idx 的大小写不敏感比较口径一致。 */
  username: text('username').primaryKey(),
  /** 授权操作的管理员 username. */
  addedBy: text('added_by').notNull(),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
});
