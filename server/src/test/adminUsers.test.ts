import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type {
  AdminUserListDto,
  BanUserResultDto,
  MerchantMenuItemDto,
  MerchantRestaurantDto,
  OrderDto,
  Restaurant,
  ReviewDto,
  UserDto,
} from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { menuItems, orders, restaurants, reviews, users } from '../db/schema';
import { __awaitReviews } from '../lib/moderation';
import { registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_ausr_a_${stamp}`, password: 'secret123' };
const userA = { username: `t_ausr_u1_${stamp}`, password: 'secret123' };
const userB = { username: `t_ausr_u2_${stamp}`, password: 'secret123' };
const target = { username: `t_ausr_ban_${stamp}`, password: 'secret123' };
const RID = 'kfc';
let adminCookie = '';
let userACookie = '';
let targetCookie = '';
let targetId = '';

let savedAdmins: string | undefined;
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

function adminReq(path: string, init?: { method?: string; body?: unknown }) {
  return req(path, adminCookie, init);
}

beforeAll(async () => {
  savedAdmins = process.env.ADMIN_USERNAMES;
  savedSecretId = process.env.TENCENT_MODERATION_SECRET_ID;
  savedSecretKey = process.env.TENCENT_MODERATION_SECRET_KEY;
  delete process.env.TENCENT_MODERATION_SECRET_ID;
  delete process.env.TENCENT_MODERATION_SECRET_KEY;
  process.env.ADMIN_USERNAMES = [savedAdmins, admin.username].filter(Boolean).join(',');

  const a = await register(admin);
  adminCookie = a.cookie;
  expect(a.user.isAdmin).toBe(true);
  const u1 = await register(userA);
  userACookie = u1.cookie;
  await register(userB);
  const t = await register(target);
  targetCookie = t.cookie;
  targetId = t.user.id;
});

afterAll(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = savedAdmins;
  if (savedSecretId !== undefined) process.env.TENCENT_MODERATION_SECRET_ID = savedSecretId;
  if (savedSecretKey !== undefined) process.env.TENCENT_MODERATION_SECRET_KEY = savedSecretKey;
  await db.delete(reviews).where(eq(reviews.userId, targetId));
  await db.delete(orders).where(eq(orders.userId, targetId));
  await db.delete(restaurants).where(eq(restaurants.ownerId, targetId)); // cascades menu_items
  await db.delete(users).where(inArray(users.username, [admin.username, userA.username, userB.username, target.username]));
  await pool.end();
});

describe('admin 接口权限', () => {
  it('rejects anonymous (401) and non-admin (403), allows admin (200)', async () => {
    expect((await app.request('/api/admin/users')).status).toBe(401);
    expect((await req('/api/admin/users', userACookie)).status).toBe(403);
    const res = await adminReq('/api/admin/users');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/admin/users 分页 + 搜索', () => {
  it('返回分页信封（items/total/page/pageSize），并按 page 翻页', async () => {
    const res1 = await adminReq('/api/admin/users?pageSize=1&page=1');
    expect(res1.status).toBe(200);
    const page1 = (await res1.json()) as AdminUserListDto;
    expect(page1.items.length).toBe(1);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(1);
    expect(page1.total).toBeGreaterThanOrEqual(2);

    const res2 = await adminReq('/api/admin/users?pageSize=1&page=2');
    const page2 = (await res2.json()) as AdminUserListDto;
    expect(page2.items.length).toBe(1);
    expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id);
  });

  it('pageSize 超过 50 收窄到 50，小于 1 收窄到 1', async () => {
    const big = (await (await adminReq('/api/admin/users?pageSize=999')).json()) as AdminUserListDto;
    expect(big.pageSize).toBe(50);
    const small = (await (await adminReq('/api/admin/users?pageSize=0')).json()) as AdminUserListDto;
    expect(small.pageSize).toBe(1);
  });

  it('q 按用户名命中', async () => {
    const res = await adminReq(`/api/admin/users?q=${encodeURIComponent(userA.username)}`);
    const list = (await res.json()) as AdminUserListDto;
    expect(list.items.some((u) => u.username === userA.username)).toBe(true);
    expect(list.items.every((u) => u.username !== userB.username)).toBe(true);
  });

  it('q 不匹配时返回空 items 且 total=0', async () => {
    const res = await adminReq(`/api/admin/users?q=${encodeURIComponent('不存在的用户名xyz')}`);
    const list = (await res.json()) as AdminUserListDto;
    expect(list.items).toEqual([]);
    expect(list.total).toBe(0);
  });
});

describe('POST /api/admin/users/:id/ban', () => {
  it('rejects non-admin', async () => {
    const res = await req(`/api/admin/users/${targetId}/ban`, userACookie, { method: 'POST', body: {} });
    expect(res.status).toBe(403);
  });

  it('封禁后标记 isBanned，并批量驳回该用户名下未驳回的店铺/商品/评价', async () => {
    // target 名下一个待审店铺 + 一个待审商品
    const shopRes = await req('/api/merchant/restaurants', targetCookie, {
      method: 'POST',
      body: {
        name: `封禁测试店_${stamp}`,
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
    expect(shopRes.status).toBe(200);
    const shop = (await shopRes.json()) as MerchantRestaurantDto;

    const itemRes = await req(`/api/merchant/restaurants/${shop.id}/items`, targetCookie, {
      method: 'POST',
      body: { name: `封禁测试品_${stamp}`, price: 18, emoji: '🍜', menuCategory: '招牌' },
    });
    expect(itemRes.status).toBe(200);
    const item = (await itemRes.json()) as MerchantMenuItemDto;

    // target 在种子店铺 kfc 下单并提交一条待审评价
    const detail = (await (await app.request(`/api/restaurants/${RID}`)).json()) as Restaurant;
    const plain = detail.menu.find((m) => !m.optionGroups?.length)!;
    const qty = Math.max(1, Math.ceil(detail.minOrder / plain.price));
    const orderRes = await req('/api/orders', targetCookie, {
      method: 'POST',
      body: {
        restaurantId: RID,
        items: [{ menuItemId: plain.id, quantity: qty }],
        address: { recipientName: '', phone: '', address: '测试地址' },
      },
    });
    const orderId = ((await orderRes.json()) as OrderDto).id;
    await req(`/api/orders/${orderId}/status`, targetCookie, { method: 'PATCH', body: { status: 'delivering' } });
    await req(`/api/orders/${orderId}/status`, targetCookie, { method: 'PATCH', body: { status: 'completed' } });
    const reviewRes = await req(`/api/orders/${orderId}/reviews`, targetCookie, {
      method: 'POST',
      body: { rating: 5, content: '封禁测试评价' },
    });
    expect(reviewRes.status).toBe(200);
    const review = (await reviewRes.json()) as ReviewDto;

    await __awaitReviews();

    const banRes = await adminReq(`/api/admin/users/${targetId}/ban`, {
      method: 'POST',
      body: { reason: '测试封禁' },
    });
    expect(banRes.status).toBe(200);
    const result = (await banRes.json()) as BanUserResultDto;
    expect(result.user.isBanned).toBe(true);
    expect(result.rejectedCounts.restaurants).toBe(1);
    expect(result.rejectedCounts.menuItems).toBe(1);
    expect(result.rejectedCounts.reviews).toBe(1);

    const [shopRow] = await db.select().from(restaurants).where(eq(restaurants.id, shop.id));
    expect(shopRow?.reviewStatus).toBe('rejected');
    const [itemRow] = await db.select().from(menuItems).where(eq(menuItems.id, item.id));
    expect(itemRow?.reviewStatus).toBe('rejected');
    const [reviewRow] = await db.select().from(reviews).where(eq(reviews.id, review.id));
    expect(reviewRow?.reviewStatus).toBe('rejected');
  });

  it('rejects banning an already-banned user', async () => {
    const res = await adminReq(`/api/admin/users/${targetId}/ban`, { method: 'POST', body: {} });
    expect(res.status).toBe(400);
  });
});
