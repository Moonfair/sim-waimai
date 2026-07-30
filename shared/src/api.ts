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

/** Search hit for a menu item: item fields + which restaurant it belongs to. */
export interface SearchMenuItemDto extends MenuItem {
  restaurantId: string;
  restaurantName: string;
  restaurantEmoji: string;
  restaurantBgColor: string;
}

/** Response for GET /search?q=. */
export interface SearchResultDto {
  restaurants: RestaurantSummary[];
  items: SearchMenuItemDto[];
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
  /** 玩家自制商家(ownerId 非空);系统种子商家为 false。 */
  isPlayerMade: boolean;
  /** 店铺是否营业中;false = 已打烊(仍可查看详情,但不可下单)。 */
  isActive: boolean;
  bannerImage?: string;
  /** Present only when the request is authenticated. */
  isFavorite?: boolean;
  /** 低活跃店铺:3天内未更新店铺或商品且商品数不多于10个。首页排序沉底、不进入推荐列表。 */
  lowActivity?: boolean;
}

export type OrderStatus = 'pending' | 'delivering' | 'completed';

/** 'simulated' = 今天的假配送流程；'real_person' = 进入抢单大厅，由真实用户接单配送。 */
export type OrderDeliveryType = 'simulated' | 'real_person';

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
  deliveryType: OrderDeliveryType;
  /** 抢单成功的用户 id；null 表示还没人接单（或本来就是模拟配送）。 */
  riderUserId: string | null;
  /** 被抢单的那一刻，ISO；配合 createdAt 可算出真实等待接单耗时。 */
  grabbedAt: string | null;
  createdAt: string;
  completedAt: string | null;
  review?: ReviewDto | null;
}

/** Request body of POST /orders. */
export interface CreateOrderRequestDto {
  restaurantId: string;
  items: { menuItemId: string; quantity: number; selectedOptionIds?: string[] }[];
  address: AddressSnapshot;
  /** true 时该订单进入抢单大厅，由其他真实用户抢单配送。 */
  realPersonDelivery?: boolean;
}

/** One pending real-person order shown in 抢单大厅 (GET /rider-hall/pending). */
export interface RiderHallOrderSummary {
  id: string;
  restaurantName: string;
  restaurantEmoji: string;
  /** yuan */
  deliveryFee: number;
  createdAt: string;
}

export interface RiderHallPendingDto {
  items: RiderHallOrderSummary[];
  count: number;
}

/** Response of POST /rider-hall/grab on success. */
export interface RiderHallGrabResultDto {
  id: string;
  restaurantName: string;
  restaurantEmoji: string;
  /** yuan */
  deliveryFee: number;
}

/** Request body of POST /rider-hall/grab — the caller commits to a specific previewed order. */
export interface RiderHallGrabRequestDto {
  orderId: string;
}

/** GET /rider-hall/preview — full detail for the newest pending order, shown before accepting.
 *  Deliberately excludes recipient name/phone/address. */
export interface RiderHallOrderPreviewDto {
  id: string;
  buyerUsername: string;
  restaurantName: string;
  restaurantEmoji: string;
  items: { name: string; emoji: string; quantity: number }[];
  /** yuan */
  subtotal: number;
  /** yuan */
  deliveryFee: number;
  /** yuan */
  total: number;
  createdAt: string;
}

/** GET /rider-hall/stats/me — 骑手统计页数据。 */
export interface RiderStatsDto {
  completedCount: number;
  /** yuan，累计获得的配送费 */
  totalEarned: number;
  tier: string;
  tierIndex: number;
  /** 距下一称号还差几单；null 表示已是最高称号 */
  nextTierThreshold: number | null;
}

export interface ReviewDto {
  id: string;
  orderId: string;
  restaurantId: string;
  username: string;
  rating: number;
  content: string;
  photos: string[];
  /** 先审后发：非 approved 的评价只会返回给作者本人。 */
  reviewStatus: ReviewStatus;
  rejectReason?: string | null;
  createdAt: string;
}

/** Merchant-view review: includes hidden (soft-deleted) state. */
export interface MerchantReviewDto extends ReviewDto {
  hidden: boolean;
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

export interface MerchantStoreStatsDto {
  id: string;
  /** yuan，该店铺所有订单 totalFen 之和 */
  totalRevenue: number;
  /** 该店铺订单数 */
  totalSales: number;
  /** yuan，当日订单 totalFen 之和 */
  todayRevenue: number;
  /** 当日订单数 */
  todaySales: number;
}

/** 商家中心统计看板数据（GET /merchant/stats）。 */
export interface MerchantStatsDto {
  /** yuan，名下所有店铺营收之和 */
  totalRevenue: number;
  totalSales: number;
  todayRevenue: number;
  todaySales: number;
  stores: MerchantStoreStatsDto[];
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

/** Site-wide stats for the admin 网站统计 dashboard (GET /admin/stats). */
export interface SiteStatsDto {
  overview: {
    totalUsers: number;
    totalOrders: number;
    /** Sum of totalFen across all orders (any status), yuan. */
    gmv: number;
    /** gmv / totalOrders, yuan; 0 when totalOrders is 0. */
    aov: number;
    /** completedOrders / totalOrders, 0..1; 0 when totalOrders is 0. */
    completionRate: number;
  };
  today: {
    newUsers: number;
    newOrders: number;
    /** yuan */
    gmv: number;
  };
  /** Always 30 entries, oldest first, one per calendar day, zero-filled for gaps. */
  trend: SiteStatsTrendDayDto[];
  merchants: {
    total: number;
    byReviewStatus: { pending: number; approved: number; rejected: number };
    /** AI 自动通过 vs 人工复核，与 admin.ts 的 reviewerCondition() 语义一致. */
    reviewerSplit: { ai: number; human: number };
    byCategory: { category: string; count: number }[];
    /** Top 10 by order count, desc. */
    topByOrders: SiteStatsTopRestaurantDto[];
    /** Top 10 by GMV, desc. */
    topByGmv: SiteStatsTopRestaurantDto[];
  };
}

export interface SiteStatsTrendDayDto {
  /** 'YYYY-MM-DD' */
  date: string;
  orders: number;
  /** yuan */
  gmv: number;
  newUsers: number;
}

export interface SiteStatsTopRestaurantDto {
  id: string;
  name: string;
  emoji: string;
  bgColor: string;
  category: string;
  orderCount: number;
  /** yuan */
  gmv: number;
}

/** One row in the admin moderation queue: a restaurant, a single menu item, or a user review. */
export interface ModerationItemDto {
  targetType: 'restaurant' | 'menuItem' | 'review';
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
  /** Present only for review rows. */
  reviewId?: string;
  rating?: number;
  photos?: string[];
  /** 待审图片：restaurant 为 bannerImage，menuItem 为菜品 image；无图为空。 */
  image?: string | null;
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

/** Paginated response for GET /admin/moderation when a `type` filter is given. */
export interface ModerationListDto {
  items: ModerationItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** Preset levels for admin-set homepage recommendation priority; shared by the UI buttons and server validation. */
export const SHOP_PRIORITY_LEVELS = [
  { label: '置顶', value: 100 },
  { label: '较高', value: 10 },
  { label: '普通', value: 0 },
  { label: '较低', value: -10 },
] as const;

/** One row in the admin 店铺管理 list (GET /admin/shops) — player-created shops only. */
export interface AdminShopDto {
  id: string;
  name: string;
  emoji: string;
  bgColor: string;
  category: string;
  ownerUsername: string | null;
  rating: number;
  monthlyOrders: number;
  isActive: boolean;
  reviewStatus: ReviewStatus;
  recommendPriority: number;
}

/** Paginated response for GET /admin/shops. */
export interface AdminShopListDto {
  items: AdminShopDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** One row in the admin 用户管理 list (GET /admin/users). */
export interface AdminUserDto {
  id: string;
  username: string;
  createdAt: string;
  isBanned: boolean;
  bannedAt: string | null;
  bannedReason: string | null;
  bannedBy: string | null;
  /** 该用户历史登录/注册过的设备指纹数量。 */
  deviceCount: number;
}

/** Paginated response for GET /admin/users. */
export interface AdminUserListDto {
  items: AdminUserDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** Response for POST /admin/users/:id/ban — how much of the user's historical content got auto-rejected. */
export interface BanUserResultDto {
  user: AdminUserDto;
  rejectedCounts: {
    restaurants: number;
    menuItems: number;
    reviews: number;
  };
  /** 本次一并封禁的设备指纹数量（该用户历史登录/注册过的设备）。 */
  bannedDeviceCount: number;
}

/** One target of a batch moderation decision (POST /admin/moderation/review). */
export type ModerationTargetDto =
  | { targetType: 'restaurant'; restaurantId: string }
  | { targetType: 'menuItem'; restaurantId: string; itemId: string }
  | { targetType: 'review'; reviewId: string };

/** Request body of POST /admin/moderation/review. */
export interface BatchReviewRequestDto {
  /** 1~50 条。 */
  targets: ModerationTargetDto[];
  decision: 'approved' | 'rejected';
  /** 可选；rejected 时若填写会统一应用到所有目标。 */
  reason?: string;
}

/** Result of a batch moderation decision; 逐条独立处理，失败按条返回。 */
export interface BatchReviewResultDto {
  succeeded: number;
  failed: { target: ModerationTargetDto; error: string }[];
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

/** Full detail for a single user review under moderation (admin review detail page). */
export interface ModerationUserReviewDetailDto extends ModerationReviewMeta {
  targetType: 'review';
  restaurantId: string;
  restaurantName: string;
  review: ReviewDto;
}

/** POST /reports 请求体：举报目标 + 原因（三选一 targetType）。 */
export type CreateReportRequestDto =
  | { targetType: 'restaurant'; restaurantId: string; reason: string }
  | { targetType: 'menuItem'; restaurantId: string; itemId: string; reason: string }
  | { targetType: 'review'; reviewId: string; reason: string };

/** 管理端 GET /admin/reports 列表行：目标展示信息 + 举报本身的信息。 */
export interface AdminReportDto {
  id: string;
  targetType: 'restaurant' | 'menuItem' | 'review';
  restaurantId: string;
  restaurantName: string;
  itemId?: string;
  reviewId?: string;
  name: string;
  emoji: string;
  category: string;
  description?: string;
  image?: string | null;
  rating?: number;
  photos?: string[];
  reason: string;
  reporterUsername: string;
  createdAt: string;
}

/** POST /admin/reports/resolve 请求体。decision 指"这条举报"本身的裁决，
 *  approved = 举报成立（目标走审核失败逻辑），rejected = 举报驳回（不处理目标）。两种结果都会删除该举报行。 */
export interface ResolveReportsRequestDto {
  /** 1~50 条。 */
  reportIds: string[];
  decision: 'approved' | 'rejected';
}

/** Result of a batch report resolution; 逐条独立处理，失败按条返回。 */
export interface ResolveReportsResultDto {
  succeeded: number;
  failed: { reportId: string; error: string }[];
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
