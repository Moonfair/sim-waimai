import type { Category, MenuItem, Restaurant, Rider } from './types';

/** Cursor-paginated response envelope. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface UserDto {
  id: string;
  username: string;
  createdAt: string;
  /** True when the username is in the server's ADMIN_USERNAMES list. */
  isAdmin?: boolean;
}

/** Moderation state for user-published restaurants and menu items. */
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

/** AI moderation's own verdict, persisted regardless of whether it auto-resolved the item. */
export type AiVerdict = 'approve' | 'reject' | 'uncertain';

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
  /** 玩家自制商家(ownerId 非空);系统种子商家为 false。 */
  isPlayerMade: boolean;
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
  reviewStatus: ReviewStatus;
  rejectReason?: string | null;
}

/** Merchant-view restaurant list row. */
export interface MerchantRestaurantSummaryDto extends RestaurantSummary {
  isActive: boolean;
  reviewStatus: ReviewStatus;
  rejectReason?: string | null;
}

/** Merchant-view restaurant detail: all items (listed or not) + open/closed state. */
export interface MerchantRestaurantDto extends MerchantRestaurantSummaryDto {
  menuCategories: string[];
  menu: MerchantMenuItemDto[];
}

/** Cumulative stats across all of a user's orders, for the 我的 dashboard. */
export interface UserStatsDto {
  totalOrders: number;
  /** Sum of order totals in yuan. */
  totalSaved: number;
  totalCalories: number;
  topRestaurant: { id: string; name: string; emoji: string; bgColor: string; orderCount: number } | null;
  topItem: { name: string; emoji: string; quantity: number } | null;
  biggestOrder: {
    id: string;
    restaurantName: string;
    restaurantEmoji: string;
    total: number;
    createdAt: string;
  } | null;
}

/** One row in the admin moderation queue: a restaurant or a single menu item. */
export interface ModerationItemDto {
  targetType: 'restaurant' | 'menuItem';
  restaurantId: string;
  restaurantName: string;
  /** Present only for menuItem rows. */
  itemId?: string;
  name: string;
  emoji: string;
  /** Restaurant 品类 or menu item 菜单分类. */
  category: string;
  description?: string;
  tags?: string[];
  reviewStatus: ReviewStatus;
  rejectReason?: string | null;
  /** 'ai' or the deciding admin's username; null while pending. */
  reviewedBy?: string | null;
  ownerUsername?: string | null;
  /** AI's own verdict/reasoning, kept even when it left the item pending or was later overridden. */
  aiVerdict?: AiVerdict | null;
  aiReason?: string | null;
  aiConfidence?: number | null;
}

/** Shared review/AI metadata for both detail DTOs below. */
interface ModerationReviewMeta {
  reviewStatus: ReviewStatus;
  rejectReason?: string | null;
  /** ISO timestamp of the last review decision, null while still pending. */
  reviewedAt?: string | null;
  /** 'ai' or the deciding admin's username; null while pending. */
  reviewedBy?: string | null;
  ownerUsername?: string | null;
  aiVerdict?: AiVerdict | null;
  aiReason?: string | null;
  aiConfidence?: number | null;
}

/** Full detail for a single shop under review (admin review detail page). */
export interface ModerationRestaurantDetailDto extends ModerationReviewMeta {
  targetType: 'restaurant';
  restaurant: Restaurant;
}

/** Full detail for a single menu item under review (admin review detail page). */
export interface ModerationItemDetailDto extends ModerationReviewMeta {
  targetType: 'menuItem';
  restaurantId: string;
  restaurantName: string;
  item: MenuItem;
}

export type UploadKind = 'banner' | 'item' | 'review';

export interface PresignResponse {
  uploadUrl: string;
  method: 'PUT';
  publicUrl: string;
  headers: Record<string, string>;
}

/** Stateless arithmetic captcha challenge returned by GET /auth/captcha. */
export interface CaptchaChallenge {
  token: string;
  question: string;
}
