import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { BatchReviewResultDto, MerchantRestaurantDto, ModerationItemDto, UserDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { restaurants, users } from '../db/schema';
import { grantRole, registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_sub_a_${stamp}`, password: 'secret123' };
const owner = { username: `t_sub_o_${stamp}`, password: 'secret123' };
let adminCookie = '';
let ownerCookie = '';
let ownerId = '';

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

async function listApproved(reviewer?: string): Promise<Response> {
  const qs = reviewer ? `&reviewer=${reviewer}` : '';
  return req(`/api/admin/moderation?status=approved${qs}`, adminCookie);
}

beforeAll(async () => {
  const a = await register(admin);
  adminCookie = a.cookie;
  await grantRole(admin.username, 'admin');
  const o = await register(owner);
  ownerCookie = o.cookie;
  ownerId = o.user.id;
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId));
  await db.delete(users).where(inArray(users.username, [admin.username, owner.username]));
  await pool.end();
});

describe('GET /api/admin/moderation reviewer 子页签过滤', () => {
  it('rejects an invalid reviewer value', async () => {
    const res = await req('/api/admin/moderation?status=approved&reviewer=bogus', adminCookie);
    expect(res.status).toBe(400);
  });

  it('splits AI-approved, human-approved, and never-reviewed-but-approved rows correctly', async () => {
    const aiShop = await createShop(`子页签AI店_${stamp}`);
    await db
      .update(restaurants)
      .set({ reviewStatus: 'approved', reviewedBy: 'ai', aiVerdict: 'approve', aiReason: '测试' })
      .where(eq(restaurants.id, aiShop.id));

    const humanShop = await createShop(`子页签人工店_${stamp}`);
    const approveRes = await req(`/api/admin/restaurants/${humanShop.id}/review`, adminCookie, {
      method: 'POST',
      body: { decision: 'approved' },
    });
    expect(approveRes.status).toBe(200);

    const seedShop = await createShop(`子页签种子店_${stamp}`);
    // 模拟从未走过审核流程、直接标记 approved 的平台种子数据：reviewedBy 保持 null。
    await db.update(restaurants).set({ reviewStatus: 'approved' }).where(eq(restaurants.id, seedShop.id));

    const aiList = (await (await listApproved('ai')).json()) as ModerationItemDto[];
    const aiIds = aiList.filter((i) => i.targetType === 'restaurant').map((i) => i.restaurantId);
    expect(aiIds).toContain(aiShop.id);
    expect(aiIds).not.toContain(humanShop.id);
    expect(aiIds).not.toContain(seedShop.id);

    const humanList = (await (await listApproved('human')).json()) as ModerationItemDto[];
    const humanIds = humanList.filter((i) => i.targetType === 'restaurant').map((i) => i.restaurantId);
    expect(humanIds).toContain(humanShop.id);
    expect(humanIds).toContain(seedShop.id);
    expect(humanIds).not.toContain(aiShop.id);

    // 复审通过（同一条批量决策接口，仅覆盖 reviewedBy）后应从 AI 桶移入人工桶
    const batchRes = await req('/api/admin/moderation/review', adminCookie, {
      method: 'POST',
      body: { targets: [{ targetType: 'restaurant', restaurantId: aiShop.id }], decision: 'approved' },
    });
    expect(batchRes.status).toBe(200);
    expect(((await batchRes.json()) as BatchReviewResultDto).succeeded).toBe(1);

    const aiListAfter = (await (await listApproved('ai')).json()) as ModerationItemDto[];
    expect(aiListAfter.some((i) => i.targetType === 'restaurant' && i.restaurantId === aiShop.id)).toBe(false);
    const humanListAfter = (await (await listApproved('human')).json()) as ModerationItemDto[];
    const movedRow = humanListAfter.find((i) => i.targetType === 'restaurant' && i.restaurantId === aiShop.id);
    expect(movedRow?.reviewedBy).toBe(admin.username);
  });
});
