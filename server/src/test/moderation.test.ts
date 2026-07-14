import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import type {
  MerchantMenuItemDto,
  MerchantRestaurantDto,
  ModerationItemDto,
  Restaurant,
  RestaurantSummary,
  UserDto,
} from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { menuItems, restaurants, users } from '../db/schema';
import { __awaitReviews, __setAiReviewer } from '../lib/moderation';

const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_mod_a_${stamp}`, password: 'secret123' };
const owner = { username: `t_mod_o_${stamp}`, password: 'secret123' };
const rando = { username: `t_mod_r_${stamp}`, password: 'secret123' };
let adminCookie = '';
let ownerCookie = '';
let randoCookie = '';
let ownerId = '';

let savedAdmins: string | undefined;
let savedApiKey: string | undefined;

async function register(cred: { username: string; password: string }) {
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cred),
  });
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

function adminReviewShop(shopId: string, decision: 'approved' | 'rejected', reason?: string) {
  return req(`/api/admin/restaurants/${shopId}/review`, adminCookie, {
    method: 'POST',
    body: { decision, ...(reason !== undefined ? { reason } : {}) },
  });
}

function adminReviewItem(
  shopId: string,
  itemId: string,
  decision: 'approved' | 'rejected',
  reason?: string,
) {
  return req(`/api/admin/restaurants/${shopId}/items/${itemId}/review`, adminCookie, {
    method: 'POST',
    body: { decision, ...(reason !== undefined ? { reason } : {}) },
  });
}

async function publicShopIds(): Promise<Set<string>> {
  const list = (await (await app.request('/api/restaurants')).json()) as RestaurantSummary[];
  return new Set(list.map((r) => r.id));
}

async function merchantShop(shopId: string): Promise<MerchantRestaurantDto> {
  return (await (
    await req(`/api/merchant/restaurants/${shopId}`, ownerCookie)
  ).json()) as MerchantRestaurantDto;
}

beforeAll(async () => {
  // lib/admin.ts 与 lib/moderation.ts 都在调用时惰性读 process.env，运行期设置即可生效。
  savedAdmins = process.env.ADMIN_USERNAMES;
  savedApiKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY; // 无 key：默认走人工队列，避免测试触网
  process.env.ADMIN_USERNAMES = [savedAdmins, admin.username].filter(Boolean).join(',');

  const a = await register(admin);
  adminCookie = a.cookie;
  expect(a.user.isAdmin).toBe(true);
  const o = await register(owner);
  ownerCookie = o.cookie;
  ownerId = o.user.id;
  expect(o.user.isAdmin).toBe(false);
  randoCookie = (await register(rando)).cookie;
});

afterAll(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = savedAdmins;
  if (savedApiKey !== undefined) process.env.ANTHROPIC_API_KEY = savedApiKey;
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId)); // cascades menu_items
  await db
    .delete(users)
    .where(inArray(users.username, [admin.username, owner.username, rando.username]));
  await pool.end();
});

afterEach(() => {
  __setAiReviewer(null);
});

describe('无 AI key 时的人工队列兜底', () => {
  it('new shop is pending and hidden from all public surfaces', async () => {
    const shop = await createShop(`兜底店_${stamp}`);
    expect(shop.reviewStatus).toBe('pending');

    expect((await publicShopIds()).has(shop.id)).toBe(false);
    expect((await app.request(`/api/restaurants/${shop.id}`)).status).toBe(404);

    // 绕过列表直接按 ID 下单也被拦住
    const item = await createItem(shop.id, '兜底菜');
    const order = await req('/api/orders', randoCookie, {
      method: 'POST',
      body: {
        restaurantId: shop.id,
        items: [{ menuItemId: item.id, quantity: 1 }],
        address: { address: '测试地址1号' },
      },
    });
    expect(order.status).toBe(400);
  });
});

describe('admin 接口权限', () => {
  it('rejects anonymous (401) and non-admin (403), allows admin', async () => {
    expect((await app.request('/api/admin/moderation')).status).toBe(401);
    expect((await req('/api/admin/moderation', randoCookie)).status).toBe(403);

    const shop = await createShop(`权限店_${stamp}`);
    const res = await req('/api/admin/moderation', adminCookie);
    expect(res.status).toBe(200);
    const queue = (await res.json()) as ModerationItemDto[];
    const entry = queue.find((m) => m.targetType === 'restaurant' && m.restaurantId === shop.id);
    expect(entry).toBeDefined();
    expect(entry!.ownerUsername).toBe(owner.username);
  });

  it('review endpoints are admin-only', async () => {
    const shop = await createShop(`权限店2_${stamp}`);
    const res = await req(`/api/admin/restaurants/${shop.id}/review`, randoCookie, {
      method: 'POST',
      body: { decision: 'approved' },
    });
    expect(res.status).toBe(403);
  });
});

describe('人工审核与编辑重审', () => {
  it('approve makes the shop public; key-field edit re-triggers review', async () => {
    const shop = await createShop(`重审店_${stamp}`);

    const approved = await adminReviewShop(shop.id, 'approved');
    expect(approved.status).toBe(200);
    expect(((await approved.json()) as ModerationItemDto).reviewedBy).toBe(admin.username);
    expect((await publicShopIds()).has(shop.id)).toBe(true);

    // 非关键字段（运费/营业状态）不触发重审
    await req(`/api/merchant/restaurants/${shop.id}`, ownerCookie, {
      method: 'PATCH',
      body: { deliveryFee: 5, isActive: true },
    });
    expect((await merchantShop(shop.id)).reviewStatus).toBe('approved');

    // 改名 → 回到待审核并对外隐藏
    const patched = await req(`/api/merchant/restaurants/${shop.id}`, ownerCookie, {
      method: 'PATCH',
      body: { name: `重审店改名_${stamp}` },
    });
    expect((((await patched.json()) as MerchantRestaurantDto).reviewStatus)).toBe('pending');
    expect((await publicShopIds()).has(shop.id)).toBe(false);
  });

  it('reject requires a reason, surfaces it to the merchant, and can be overridden', async () => {
    const shop = await createShop(`驳回店_${stamp}`);

    expect((await adminReviewShop(shop.id, 'rejected')).status).toBe(400); // 缺原因

    const rejected = await adminReviewShop(shop.id, 'rejected', '店名含违规内容');
    expect(rejected.status).toBe(200);
    const mine = await merchantShop(shop.id);
    expect(mine.reviewStatus).toBe('rejected');
    expect(mine.rejectReason).toBe('店名含违规内容');
    expect((await publicShopIds()).has(shop.id)).toBe(false);

    // 管理员可推翻此前结论
    await adminReviewShop(shop.id, 'approved');
    const after = await merchantShop(shop.id);
    expect(after.reviewStatus).toBe('approved');
    expect(after.rejectReason).toBeNull();
  });

  it('item lifecycle: pending → approved → edit re-triggers; listing toggles do not', async () => {
    const shop = await createShop(`商品店_${stamp}`);
    await adminReviewShop(shop.id, 'approved');

    const item = await createItem(shop.id, '生命周期菜');
    expect(item.reviewStatus).toBe('pending');

    // 商家视角可见，公开菜单不含
    let detail = (await (await app.request(`/api/restaurants/${shop.id}`)).json()) as Restaurant;
    expect(detail.menu.some((m) => m.id === item.id)).toBe(false);
    expect((await merchantShop(shop.id)).menu.some((m) => m.id === item.id)).toBe(true);

    await adminReviewItem(shop.id, item.id, 'approved');
    detail = (await (await app.request(`/api/restaurants/${shop.id}`)).json()) as Restaurant;
    expect(detail.menu.some((m) => m.id === item.id)).toBe(true);

    // 只切上下架不触发重审
    await req(`/api/merchant/restaurants/${shop.id}/items/${item.id}`, ownerCookie, {
      method: 'PATCH',
      body: { isListed: false },
    });
    let mine = (await merchantShop(shop.id)).menu.find((m) => m.id === item.id)!;
    expect(mine.reviewStatus).toBe('approved');

    // 改描述 → 重审
    await req(`/api/merchant/restaurants/${shop.id}/items/${item.id}`, ownerCookie, {
      method: 'PATCH',
      body: { description: '换了个说法' },
    });
    mine = (await merchantShop(shop.id)).menu.find((m) => m.id === item.id)!;
    expect(mine.reviewStatus).toBe('pending');

    // 下架（软删除）不触发状态变化
    await adminReviewItem(shop.id, item.id, 'approved');
    await req(`/api/merchant/restaurants/${shop.id}/items/${item.id}`, ownerCookie, {
      method: 'DELETE',
    });
    mine = (await merchantShop(shop.id)).menu.find((m) => m.id === item.id)!;
    expect(mine.reviewStatus).toBe('approved');
    expect(mine.isListed).toBe(false);
  });
});

describe('AI 审核路径（注入 reviewer）', () => {
  it('AI approve/reject verdicts land in the DB with reviewedBy=ai', async () => {
    __setAiReviewer(async () => ({ verdict: 'approve', reason: '正常餐饮内容', confidence: 0.98 }));
    const approvedShop = await createShop(`AI通过店_${stamp}`);
    await __awaitReviews();
    const [row1] = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, approvedShop.id));
    expect(row1!.reviewStatus).toBe('approved');
    expect(row1!.reviewedBy).toBe('ai');
    expect(row1!.aiVerdict).toBe('approve');
    expect(row1!.aiReason).toBe('正常餐饮内容');
    expect(row1!.aiConfidence).toBe(0.98);

    __setAiReviewer(async () => ({ verdict: 'reject', reason: '包含违禁品信息', confidence: 0.95 }));
    const rejectedShop = await createShop(`AI驳回店_${stamp}`);
    await __awaitReviews();
    const [row2] = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, rejectedShop.id));
    expect(row2!.reviewStatus).toBe('rejected');
    expect(row2!.rejectReason).toBe('包含违禁品信息');
    expect(row2!.aiVerdict).toBe('reject');
    expect(row2!.aiReason).toBe('包含违禁品信息');
    expect(row2!.aiConfidence).toBe(0.95);
  });

  it('uncertain verdict stays pending but AI suggestion is persisted for manual review', async () => {
    __setAiReviewer(async () => ({ verdict: 'uncertain', reason: '无法判断', confidence: 0.4 }));
    const shop = await createShop(`AI存疑店_${stamp}`);
    await __awaitReviews();
    const [row] = await db.select().from(restaurants).where(eq(restaurants.id, shop.id));
    expect(row!.reviewStatus).toBe('pending');
    expect(row!.aiVerdict).toBe('uncertain');
    expect(row!.aiReason).toBe('无法判断');
    expect(row!.aiConfidence).toBe(0.4);
  });

  it('editing a reviewed shop resets the stale AI suggestion', async () => {
    __setAiReviewer(async () => ({ verdict: 'approve', reason: '正常餐饮内容', confidence: 0.9 }));
    const shop = await createShop(`AI重审店_${stamp}`);
    await __awaitReviews();
    const [before] = await db.select().from(restaurants).where(eq(restaurants.id, shop.id));
    expect(before!.aiVerdict).toBe('approve');

    __setAiReviewer(null); // 改名后重新入队但不注入 AI，保持 pending 以观察重置结果
    await req(`/api/merchant/restaurants/${shop.id}`, ownerCookie, {
      method: 'PATCH',
      body: { name: `AI重审店改名_${stamp}` },
    });
    const [after] = await db.select().from(restaurants).where(eq(restaurants.id, shop.id));
    expect(after!.reviewStatus).toBe('pending');
    expect(after!.aiVerdict).toBeNull();
    expect(after!.aiReason).toBeNull();
    expect(after!.aiConfidence).toBeNull();
  });

  it('slow AI result does not overwrite an admin decision (WHERE pending guard)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    __setAiReviewer(async () => {
      await gate;
      return { verdict: 'reject', reason: '慢速驳回', confidence: 0.9 };
    });

    const shop = await createShop(`竞态店_${stamp}`);
    await adminReviewShop(shop.id, 'approved'); // AI 在途时管理员先通过
    release();
    await __awaitReviews();

    const [row] = await db.select().from(restaurants).where(eq(restaurants.id, shop.id));
    expect(row!.reviewStatus).toBe('approved');
    expect(row!.reviewedBy).toBe(admin.username);
  });

  it('AI review also covers menu items', async () => {
    __setAiReviewer(async () => ({ verdict: 'approve', reason: 'ok', confidence: 0.97 }));
    const shop = await createShop(`AI商品店_${stamp}`);
    const item = await createItem(shop.id, 'AI审核菜');
    await __awaitReviews();
    const [row] = await db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.restaurantId, shop.id), eq(menuItems.id, item.id)));
    expect(row!.reviewStatus).toBe('approved');
    expect(row!.reviewedBy).toBe('ai');
  });
});

describe('审核详情接口（GET /api/admin/restaurants/:id[/items/:itemId]）', () => {
  it('returns full submitted content for a shop, admin-only, 404 for unknown id', async () => {
    const shop = await createShop(`详情店_${stamp}`);

    expect((await app.request(`/api/admin/restaurants/${shop.id}`)).status).toBe(401);
    expect((await req(`/api/admin/restaurants/${shop.id}`, randoCookie)).status).toBe(403);

    const res = await req(`/api/admin/restaurants/${shop.id}`, adminCookie);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as {
      targetType: string;
      restaurant: { deliveryFee: number; bgColor: string; category: string };
      reviewStatus: string;
      ownerUsername: string | null;
      aiVerdict: string | null;
    };
    expect(detail.targetType).toBe('restaurant');
    expect(detail.restaurant.deliveryFee).toBe(3);
    expect(detail.restaurant.bgColor).toBe('#336699');
    expect(detail.restaurant.category).toBe('中式快餐');
    expect(detail.reviewStatus).toBe('pending');
    expect(detail.ownerUsername).toBe(owner.username);
    expect(detail.aiVerdict).toBeNull();

    expect((await req('/api/admin/restaurants/does-not-exist', adminCookie)).status).toBe(404);
  });

  it('returns full submitted content for a menu item, including option groups, 404 for unknown item', async () => {
    const shop = await createShop(`详情商品店_${stamp}`);
    const itemRes = await req(`/api/merchant/restaurants/${shop.id}/items`, ownerCookie, {
      method: 'POST',
      body: {
        name: '详情规格菜',
        price: 18,
        emoji: '🍜',
        menuCategory: '招牌',
        optionGroups: [
          {
            id: 'size',
            name: '规格',
            selectionType: 'single',
            required: true,
            options: [
              { id: 'small', name: '小份', priceDelta: 0 },
              { id: 'large', name: '大份', priceDelta: 5 },
            ],
            defaultOptionIds: ['small'],
          },
        ],
      },
    });
    const item = (await itemRes.json()) as MerchantMenuItemDto;

    const res = await req(`/api/admin/restaurants/${shop.id}/items/${item.id}`, adminCookie);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as {
      targetType: string;
      restaurantName: string;
      item: {
        price: number;
        calories: number;
        menuCategory: string;
        optionGroups?: { name: string; options: { name: string; priceDelta: number }[] }[];
      };
    };
    expect(detail.targetType).toBe('menuItem');
    expect(detail.restaurantName).toBe(shop.name);
    expect(detail.item.price).toBe(18);
    expect(detail.item.menuCategory).toBe('招牌');
    expect(detail.item.optionGroups?.[0]?.name).toBe('规格');
    expect(detail.item.optionGroups?.[0]?.options.map((o) => o.name)).toEqual(['小份', '大份']);
    expect(detail.item.optionGroups?.[0]?.options[1]?.priceDelta).toBe(5);

    expect(
      (await req(`/api/admin/restaurants/${shop.id}/items/does-not-exist`, adminCookie)).status,
    ).toBe(404);
  });

  it('detail reflects the same AI verdict/reason/confidence the list endpoint shows', async () => {
    __setAiReviewer(async () => ({ verdict: 'uncertain', reason: '详情一致性测试', confidence: 0.55 }));
    const shop = await createShop(`详情AI店_${stamp}`);
    await __awaitReviews();

    const res = await req(`/api/admin/restaurants/${shop.id}`, adminCookie);
    const detail = (await res.json()) as {
      aiVerdict: string | null;
      aiReason: string | null;
      aiConfidence: number | null;
    };
    expect(detail.aiVerdict).toBe('uncertain');
    expect(detail.aiReason).toBe('详情一致性测试');
    expect(detail.aiConfidence).toBe(0.55);
  });
});
