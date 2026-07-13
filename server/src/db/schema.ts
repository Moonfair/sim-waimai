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
  },
  (t) => [uniqueIndex('users_username_lower_idx').on(sql`lower(${t.username})`)],
);

export const restaurants = pgTable(
  'restaurants',
  {
    /** Seed restaurants keep their slug ids ("laoxiangji"); user-created ones get nanoid. */
    id: text('id').primaryKey(),
    /** NULL = platform-seeded restaurant with no owning user. */
    ownerId: uuid('owner_id').references(() => users.id),
    sortOrder: integer('sort_order').notNull().default(0),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    check('orders_status_check', sql`${t.status} IN ('pending', 'delivering', 'completed')`),
    /** THE index for per-user history with keyset pagination. */
    index('orders_user_history_idx').on(t.userId, t.createdAt.desc(), t.id.desc()),
    index('orders_restaurant_idx').on(t.restaurantId, t.createdAt.desc()),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('reviews_rating_check', sql`${t.rating} BETWEEN 1 AND 5`),
    index('reviews_restaurant_idx').on(t.restaurantId, t.createdAt.desc()),
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
