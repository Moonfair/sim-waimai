export type Category = '全部' | '中式快餐' | '汉堡炸鸡' | '日料韩料' | '奶茶饮品' | '小吃零食' | '火锅' | '披萨' | '咖啡烘焙' | '甜点烘焙';

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  calories: number;
  emoji: string;
  menuCategory: string;
  popular?: boolean;
  /** Path relative to public/, no leading slash, e.g. "restaurants/laoxiangji/items/hfj.jpg" */
  image?: string;
  /** Prompt used to generate `image`, kept for inspection/regeneration */
  imagePrompt?: string;
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
  /** Path relative to public/, no leading slash, e.g. "restaurants/laoxiangji/banner.jpg" */
  bannerImage?: string;
  /** Prompt used to generate `bannerImage` */
  bannerImagePrompt?: string;
  /** Shared visual style description reused across this restaurant's item image prompts */
  seriesStyle?: string;
}
