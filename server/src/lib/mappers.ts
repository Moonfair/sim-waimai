import { fenToYuan } from '@sim-waimai/shared';
import type { Category, MenuItem, Restaurant, RestaurantSummary } from '@sim-waimai/shared';
import type { menuItems, restaurants } from '../db/schema';

export type RestaurantRow = typeof restaurants.$inferSelect;
export type MenuItemRow = typeof menuItems.$inferSelect;

export function toRestaurantSummary(row: RestaurantRow, isFavorite?: boolean): RestaurantSummary {
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
  };
  if (row.bannerImage) summary.bannerImage = row.bannerImage;
  if (isFavorite !== undefined) summary.isFavorite = isFavorite;
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
