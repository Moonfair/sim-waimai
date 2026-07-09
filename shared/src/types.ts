export type Category = '全部' | '中式快餐' | '汉堡炸鸡' | '日料韩料' | '奶茶饮品' | '小吃零食' | '火锅' | '披萨' | '咖啡烘焙' | '甜点烘焙';

export const CATEGORIES: Category[] = ['全部', '中式快餐', '汉堡炸鸡', '日料韩料', '奶茶饮品', '小吃零食', '火锅', '披萨', '咖啡烘焙', '甜点烘焙'];

export interface MenuItemOption {
  id: string;
  name: string;
  /** Yuan delta applied once per unit if this option is selected. 0 = no price impact. */
  priceDelta: number;
}

export interface MenuItemOptionGroup {
  id: string;
  name: string;
  selectionType: 'single' | 'multi';
  /** Single-select groups are always required (must resolve to exactly one option).
   *  Multi-select groups here are always optional (0..N). */
  required: boolean;
  options: MenuItemOption[];
  /** Pre-selected option id(s), so the options sheet never opens in an unsubmittable state.
   *  Required groups must set exactly one id here. */
  defaultOptionIds?: string[];
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  calories: number;
  emoji: string;
  menuCategory: string;
  popular?: boolean;
  /** Path relative to public/, absolute COS URL, or /api/uploads/local/... dev-fallback URL */
  image?: string;
  /** Prompt used to generate `image`, kept for inspection/regeneration */
  imagePrompt?: string;
  /** Customization option groups (size/temperature/sweetness/add-ons/etc).
   *  Absent = item is added directly via the +/- stepper with no options sheet. */
  optionGroups?: MenuItemOptionGroup[];
}

export interface Restaurant {
  id: string;
  order: number;
  name: string;
  category: Category;
  rating: number;
  ratingCount: number;
  monthlyOrders: number;
  deliveryFee: number;
  deliveryTime: number;
  minOrder: number;
  emoji: string;
  bgColor: string;
  tags: string[];
  menuCategories: string[];
  menu: MenuItem[];
  /** Path relative to public/, absolute COS URL, or /api/uploads/local/... dev-fallback URL */
  bannerImage?: string;
  /** Prompt used to generate `bannerImage` */
  bannerImagePrompt?: string;
  /** Shared visual style description reused across this restaurant's item image prompts */
  seriesStyle?: string;
  /** Present only when the API request is authenticated. */
  isFavorite?: boolean;
}

export interface Rider {
  id: string;
  name: string;
  avatarEmoji: string;
  vehicleEmoji: string;
  rating: number;
  deliveryCount: string;
}
