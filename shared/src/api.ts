import type { Category, MenuItem, Rider } from './types';

/** Cursor-paginated response envelope. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface UserDto {
  id: string;
  username: string;
  createdAt: string;
}

/** Restaurant list item (no menu). All money fields in yuan. */
export interface RestaurantSummary {
  id: string;
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
  bannerImage?: string;
  /** Present only when the request is authenticated. */
  isFavorite?: boolean;
}

export type OrderStatus = 'pending' | 'delivering' | 'completed';

export interface SelectedOptionSnapshot {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDelta: number;
}

/** Immutable per-line snapshot stored inside an order. Money in yuan. */
export interface OrderItemSnapshot {
  key: string;
  menuItemId: string;
  name: string;
  emoji: string;
  image?: string;
  quantity: number;
  /** Unit price including selected option deltas. */
  unitPrice: number;
  calories: number;
  lineTotal: number;
  selectedOptions?: SelectedOptionSnapshot[];
}

export interface AddressSnapshot {
  recipientName: string;
  phone: string;
  address: string;
}

export interface OrderSummaryDto {
  id: string;
  restaurantId: string;
  restaurantName: string;
  restaurantEmoji: string;
  restaurantBgColor: string;
  status: OrderStatus;
  itemCount: number;
  firstItemName: string;
  total: number;
  createdAt: string;
  hasReview: boolean;
}

export interface OrderDto {
  id: string;
  restaurantId: string;
  restaurant: { name: string; emoji: string; bgColor: string };
  status: OrderStatus;
  items: OrderItemSnapshot[];
  subtotal: number;
  deliveryFee: number;
  /** 满减 discount in yuan (0 if none). */
  discount: number;
  total: number;
  totalCalories: number;
  address: AddressSnapshot;
  rider: Rider | null;
  createdAt: string;
  completedAt: string | null;
  review?: ReviewDto | null;
}

export interface ReviewDto {
  id: string;
  orderId: string;
  restaurantId: string;
  username: string;
  rating: number;
  content: string;
  photos: string[];
  createdAt: string;
}

/** Merchant-view menu item: includes delisted state. */
export interface MerchantMenuItemDto extends MenuItem {
  isListed: boolean;
}

/** Merchant-view restaurant list row. */
export interface MerchantRestaurantSummaryDto extends RestaurantSummary {
  isActive: boolean;
}

/** Merchant-view restaurant detail: all items (listed or not) + open/closed state. */
export interface MerchantRestaurantDto extends MerchantRestaurantSummaryDto {
  menuCategories: string[];
  menu: MerchantMenuItemDto[];
}

export type UploadKind = 'banner' | 'item' | 'review';

export interface PresignResponse {
  uploadUrl: string;
  method: 'PUT';
  publicUrl: string;
  headers: Record<string, string>;
}
