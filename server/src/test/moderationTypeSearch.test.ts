import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type {
  MerchantMenuItemDto,
  MerchantRestaurantDto,
  ModerationItemDto,
  ModerationListDto,
  OrderDto,
  Restaurant,
  ReviewDto,
  UserDto,
} from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { orders, restaurants, reviews, users } from '../db/schema';
import { __awaitReviews } from '../lib/moderation';
import { grantRole, registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_modts_a_${stamp}`, password: 'secret123' };
const owner = { username: `t_modts_o_${stamp}`, password: 'secret123' };
const customer = { username: `t_modts_c_${stamp}`, password: 'secret123' };
const RID = 'kfc';
let adminCookie = '';
let ownerCookie = '';
let customerCookie = '';
let ownerId = '';
let customerId = '';

let savedSecretId: string | undefined;
let savedSecretKey: string | undefined;

async function register(cred: { username: string; password: string }) {
  const res = await registerTestUser(app, cred);
  return {
    cookie: (res.headers.get('set-cookie') ?? '').split(';')[0],
    user: (await res.json()) as UserDto,
  };
}

function req(path: string, cookie: string, init?: { method?: string; body?: unknown }) {
  return app.request(path, {
    method: init?.method ?? 'GET',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

function adminReq(path: string) {
  return req(path, adminCookie);
}

async function createShop(name: string): Promise<MerchantRestaurantDto> {
  const res = await req('/api/merchant/restaurants', ownerCookie, {
    method: 'POST',
    body: {
      name,
      category: '中式快餐',
      emoji: '🍱',
      bgColor: '#336699',
      deliveryFee: 3,
      minOrder: 15,
      deliveryTime: 30,
      tags: ['测试'],
      menuCategories: ['招牌'],
    },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as MerchantRestaurantDto;
}

async function createItem(shopId: string, name: string): Promise<MerchantMenuItemDto> {
  const res = await req(`/api/merchant/restaurants/${shopId}/items`, ownerCookie, {
    method: 'POST',
    body: { name, price: 18, emoji: '🍜', menuCategory: '招牌' },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as MerchantMenuItemDto;
}

/** 顾客在种子店铺 kfc 下单、走完订单流程并提交评价（无审核凭证，评价保持 pending）。 */
async function placeReview(rating: number, content: string): Promise<ReviewDto> {
  const detail = (await (await app.request(`/api/restaurants/${RID}`)).json()) as Restaurant;
  const plain = detail.menu.find((m) => !m.optionGroups?.length)!;
  const qty = Math.max(1, Math.ceil(detail.minOrder / plain.price));
  const orderRes = await req('/api/orders', customerCookie, {
    method: 'POST',
    body: {
      restaurantId: RID,
      items: [{ menuItemId: plain.id, quantity: qty }],
      address: { recipientName: '', phone: '', address: '测试地址' },
    },
  });
  const orderId = ((await orderRes.json()) as OrderDto).id;
  await req(`/api/orders/${orderId}/status`, customerCookie, { method: 'PATCH', body: { status: 'delivering' } });
  await req(`/api/orders/${orderId}/status`, customerCookie, { method: 'PATCH', body: { status: 'completed' } });
  const reviewRes = await req(`/api/orders/${orderId}/reviews`, customerCookie, {
    method: 'POST',
    body: { rating, content },
  });
  expect(reviewRes.status).toBe(200);
  return (await reviewRes.json()) as ReviewDto;
}

beforeAll(async () => {
  savedSecretId = process.env.TENCENT_MODERATION_SECRET_ID;
  savedSecretKey = process.env.TENCENT_MODERATION_SECRET_KEY;
  // 无凭证：新建的店铺/商品/评价都保持 pending，避免测试触网计费、也避免异步 AI 审核抢跑改状态。
  delete process.env.TENCENT_MODERATION_SECRET_ID;
  delete process.env.TENCENT_MODERATION_SECRET_KEY;

  const a = await register(admin);
  adminCookie = a.cookie;
  await grantRole(admin.username, 'admin');
  const o = await register(owner);
  ownerCookie = o.cookie;
  ownerId = o.user.id;
  const c = await register(customer);
  customerCookie = c.cookie;
  customerId = c.user.id;
});

afterAll(async () => {
  if (savedSecretId !== undefined) process.env.TENCENT_MODERATION_SECRET_ID = savedSecretId;
  if (savedSecretKey !== undefined) process.env.TENCENT_MODERATION_SECRET_KEY = savedSecretKey;
  await db.delete(reviews).where(eq(reviews.userId, customerId));
  await db.delete(orders).where(eq(orders.userId, customerId));
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId)); // cascades menu_items
  await db.delete(users).where(inArray(users.username, [admin.username, owner.username, customer.username]));
  await pool.end();
});

describe('GET /api/admin/moderation?type=... 分页 + 搜索', () => {
  let shopA: MerchantRestaurantDto;
  let shopB: MerchantRestaurantDto;
  let itemA: MerchantMenuItemDto;

  beforeAll(async () => {
    shopA = await createShop(`类型搜索店A_${stamp}`);
    shopB = await createShop(`类型搜索店B_${stamp}`);
    itemA = await createItem(shopA.id, `类型搜索品A_${stamp}`);
    await __awaitReviews();
  });

  it('type=restaurant 返回分页信封（items/total/page/pageSize），并按 page 翻页', async () => {
    const res1 = await adminReq('/api/admin/moderation?status=pending&type=restaurant&pageSize=1&page=1');
    expect(res1.status).toBe(200);
    const page1 = (await res1.json()) as ModerationListDto;
    expect(page1.items.length).toBe(1);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(1);
    expect(page1.total).toBeGreaterThanOrEqual(2);
    expect(page1.items[0]!.targetType).toBe('restaurant');

    const res2 = await adminReq('/api/admin/moderation?status=pending&type=restaurant&pageSize=1&page=2');
    const page2 = (await res2.json()) as ModerationListDto;
    expect(page2.items.length).toBe(1);
    expect(page2.items[0]!.restaurantId).not.toBe(page1.items[0]!.restaurantId);
  });

  it('pageSize 超过 50 收窄到 50，小于 1 收窄到 1', async () => {
    const big = (await (
      await adminReq('/api/admin/moderation?status=pending&type=restaurant&pageSize=999')
    ).json()) as ModerationListDto;
    expect(big.pageSize).toBe(50);

    const small = (await (
      await adminReq('/api/admin/moderation?status=pending&type=restaurant&pageSize=0')
    ).json()) as ModerationListDto;
    expect(small.pageSize).toBe(1);
  });

  it('q 按店铺名命中 type=restaurant', async () => {
    const res = await adminReq(
      `/api/admin/moderation?status=pending&type=restaurant&q=${encodeURIComponent(shopA.name)}`,
    );
    const list = (await res.json()) as ModerationListDto;
    expect(list.items.some((i) => i.restaurantId === shopA.id)).toBe(true);
    expect(list.items.every((i) => i.restaurantId !== shopB.id)).toBe(true);
  });

  it('q 按店主用户名命中 type=restaurant（命中该店主名下所有店铺）', async () => {
    const res = await adminReq(
      `/api/admin/moderation?status=pending&type=restaurant&q=${encodeURIComponent(owner.username)}`,
    );
    const list = (await res.json()) as ModerationListDto;
    expect(list.items.some((i) => i.restaurantId === shopA.id)).toBe(true);
    expect(list.items.some((i) => i.restaurantId === shopB.id)).toBe(true);
  });

  it('q 按菜品名命中 type=menuItem', async () => {
    const res = await adminReq(
      `/api/admin/moderation?status=pending&type=menuItem&q=${encodeURIComponent(itemA.name)}`,
    );
    const list = (await res.json()) as ModerationListDto;
    expect(list.items.some((i) => i.itemId === itemA.id)).toBe(true);
    expect(list.items[0]!.targetType).toBe('menuItem');
  });

  it('q 不匹配时返回空 items 且 total=0', async () => {
    const res = await adminReq(
      `/api/admin/moderation?status=pending&type=restaurant&q=${encodeURIComponent('不存在的关键字xyz')}`,
    );
    const list = (await res.json()) as ModerationListDto;
    expect(list.items).toEqual([]);
    expect(list.total).toBe(0);
  });

  it('status 与 type 组合过滤：换到 approved 状态搜不到仍是 pending 的店铺', async () => {
    const res = await adminReq(
      `/api/admin/moderation?status=approved&type=restaurant&q=${encodeURIComponent(shopA.name)}`,
    );
    const list = (await res.json()) as ModerationListDto;
    expect(list.items.every((i) => i.restaurantId !== shopA.id)).toBe(true);
  });

  it('不传 type（全部）时仍返回扁平数组，q 过滤照常生效', async () => {
    const res = await adminReq(`/api/admin/moderation?status=pending&q=${encodeURIComponent(shopA.name)}`);
    const list = (await res.json()) as ModerationItemDto[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.some((i) => i.targetType === 'restaurant' && i.restaurantId === shopA.id)).toBe(true);
  });
});

describe('GET /api/admin/moderation?type=review 搜索（按发布者用户名）', () => {
  let review: ReviewDto;

  beforeAll(async () => {
    review = await placeReview(5, '类型搜索测试评价');
    await __awaitReviews();
  });

  it('q 按发布者用户名命中', async () => {
    const res = await adminReq(
      `/api/admin/moderation?status=pending&type=review&q=${encodeURIComponent(customer.username)}`,
    );
    expect(res.status).toBe(200);
    const list = (await res.json()) as ModerationListDto;
    expect(list.items.some((i) => i.reviewId === review.id)).toBe(true);
    expect(list.items[0]!.targetType).toBe('review');
  });

  it('q 不匹配用户名时返回空 items 且 total=0', async () => {
    const res = await adminReq(
      `/api/admin/moderation?status=pending&type=review&q=${encodeURIComponent('不存在用户xyz')}`,
    );
    const list = (await res.json()) as ModerationListDto;
    expect(list.items).toEqual([]);
    expect(list.total).toBe(0);
  });
});
