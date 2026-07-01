export type { Category, MenuItem, Restaurant } from './types';
import type { Category, Restaurant } from './types';

// import: 'default' is required — without it, eager glob returns the module
// namespace object ({ default: Restaurant }) instead of the parsed JSON value,
// and the <Restaurant> generic won't catch the mismatch at compile time.
const modules = import.meta.glob<Restaurant>('./restaurants/*.json', {
  eager: true,
  import: 'default',
});

export const restaurants: Restaurant[] = Object.values(modules)
  .sort((a, b) => a.order - b.order);

for (const r of restaurants) {
  if (!r.id || !Array.isArray(r.menu)) {
    throw new Error(`Invalid restaurant JSON: missing id or menu (${JSON.stringify(r).slice(0, 80)})`);
  }
}

export function getRestaurantById(id: string): Restaurant | undefined {
  return restaurants.find(r => r.id === id);
}

export const CATEGORIES: Category[] = ['全部', '中式快餐', '汉堡炸鸡', '日料韩料', '奶茶饮品', '小吃零食', '火锅', '披萨', '咖啡烘焙', '甜点烘焙'];
