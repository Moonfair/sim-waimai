import { fenToYuan } from '@sim-waimai/shared';
import type {
  Category,
  MenuItem,
  MerchantReviewDto,
  OrderDto,
  OrderSummaryDto,
  Restaurant,
  RestaurantSummary,
  ReviewDto,
  RiderHallOrderPreviewDto,
  RiderHallOrderSummary,
  SearchMenuItemDto,
} from '@sim-waimai/shared';
import type { menuItems, orders, restaurants, reviews } from '../db/schema';

export type RestaurantRow = typeof restaurants.$inferSelect;
export type MenuItemRow = typeof menuItems.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type ReviewRow = typeof reviews.$inferSelect;

export function toRestaurantSummary(
  row: RestaurantRow,
  isFavorite?: boolean,
  lowActivity?: boolean,
): RestaurantSummary {
  const summary: RestaurantSummary = {
    id: row.id,
    name: row.name,
    category: row.category as Category,
    rating: row.rating,
    ratingCount: row.ratingCount,
    monthlyOrders: row.monthlyOrders,
    deliveryFee: fenToYuan(row.deliveryFeeFen),
    deliveryTime: row.deliveryTime,
    minOrder: fenToYuan(row.minOrderFen),
    emoji: row.emoji,
    bgColor: row.bgColor,
    tags: row.tags,
    isPlayerMade: row.ownerId !== null,
    isActive: row.isActive,
  };
  if (row.bannerImage) summary.bannerImage = row.bannerImage;
  if (isFavorite !== undefined) summary.isFavorite = isFavorite;
  if (lowActivity !== undefined) summary.lowActivity = lowActivity;
  return summary;
}

export function toMenuItem(row: MenuItemRow): MenuItem {
  const item: MenuItem = {
    id: row.id,
    name: row.name,
    description: row.description,
    price: fenToYuan(row.priceFen),
    calories: row.calories,
    emoji: row.emoji,
    menuCategory: row.menuCategory,
  };
  if (row.popular) item.popular = true;
  if (row.image) item.image = row.image;
  if (row.optionGroups?.length) item.optionGroups = row.optionGroups;
  return item;
}

export function toSearchMenuItemDto(row: MenuItemRow, restaurant: RestaurantRow): SearchMenuItemDto {
  return {
    ...toMenuItem(row),
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    restaurantEmoji: restaurant.emoji,
    restaurantBgColor: restaurant.bgColor,
  };
}

/** Full legacy `Restaurant` shape the existing frontend components consume. */
export function toRestaurant(row: RestaurantRow, items: MenuItemRow[]): Restaurant {
  const restaurant: Restaurant = {
    ...toRestaurantSummary(row),
    order: row.sortOrder,
    menuCategories: row.menuCategories,
    menu: items.map(toMenuItem),
  };
  return restaurant;
}

export function toReviewDto(row: ReviewRow, username: string): ReviewDto {
  return {
    id: row.id,
    orderId: row.orderId,
    restaurantId: row.restaurantId,
    username,
    rating: row.rating,
    content: row.content,
    photos: row.photos,
    reviewStatus: row.reviewStatus,
    rejectReason: row.rejectReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toMerchantReviewDto(row: ReviewRow, username: string): MerchantReviewDto {
  return { ...toReviewDto(row, username), hidden: row.hiddenAt !== null };
}

export function toOrderDto(row: OrderRow, review?: ReviewDto | null): OrderDto {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    restaurant: row.restaurantSnapshot,
    status: row.status,
    items: row.items,
    subtotal: fenToYuan(row.subtotalFen),
    deliveryFee: fenToYuan(row.deliveryFeeFen),
    discount: fenToYuan(row.discountFen),
    total: fenToYuan(row.totalFen),
    totalCalories: row.totalCalories,
    address: row.addressSnapshot,
    rider: row.riderSnapshot ?? null,
    deliveryType: row.deliveryType,
    riderUserId: row.riderUserId,
    grabbedAt: row.grabbedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    review: review ?? null,
  };
}

export function toRiderHallOrderSummary(row: OrderRow): RiderHallOrderSummary {
  return {
    id: row.id,
    restaurantName: row.restaurantSnapshot.name,
    restaurantEmoji: row.restaurantSnapshot.emoji,
    deliveryFee: fenToYuan(row.deliveryFeeFen),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Preview shown to a would-be rider before they accept — deliberately excludes
 *  the buyer's recipient name/phone/address (row.addressSnapshot is never read here). */
export function toRiderHallPreviewDto(row: OrderRow, buyerUsername: string): RiderHallOrderPreviewDto {
  return {
    id: row.id,
    buyerUsername,
    restaurantName: row.restaurantSnapshot.name,
    restaurantEmoji: row.restaurantSnapshot.emoji,
    items: row.items.map((i) => ({ name: i.name, emoji: i.emoji, quantity: i.quantity })),
    subtotal: fenToYuan(row.subtotalFen),
    deliveryFee: fenToYuan(row.deliveryFeeFen),
    total: fenToYuan(row.totalFen),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toOrderSummary(row: OrderRow, hasReview: boolean): OrderSummaryDto {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    restaurantName: row.restaurantSnapshot.name,
    restaurantEmoji: row.restaurantSnapshot.emoji,
    restaurantBgColor: row.restaurantSnapshot.bgColor,
    status: row.status,
    itemCount: row.items.reduce((sum, i) => sum + i.quantity, 0),
    firstItemName: row.items[0]?.name ?? '',
    total: fenToYuan(row.totalFen),
    createdAt: row.createdAt.toISOString(),
    hasReview,
  };
}
