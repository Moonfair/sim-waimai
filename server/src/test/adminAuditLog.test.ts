import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type {
  AdminAuditLogEntryDto,
  AdminAuditLogListDto,
  ChangelogEntryDto,
  MerchantRestaurantDto,
  ResolveReportsResultDto,
  UserDto,
} from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { adminAuditLog, changelogEditors, changelogEntries, reports, restaurants, users } from '../db/schema';
import { grantRole, registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const baseMajor = Math.floor(Date.now() / 1000);
const admin = { username: `t_audit_a_${stamp}`, password: 'secret123' };
const owner = { username: `t_audit_o_${stamp}`, password: 'secret123' };
const editor = { username: `t_audit_e_${stamp}`, password: 'secret123' };
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

/** Rows written for this test run, keyed by actorUsername = admin.username — every other test
 *  file uses its own stamped username, so this filter alone isolates our rows. */
async function auditRowsFor(targetId: string) {
  return db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, targetId));
}

beforeAll(async () => {
  const a = await register(admin);
  adminCookie = a.cookie;
  await grantRole(admin.username, 'admin');
  const o = await register(owner);
  ownerCookie = o.cookie;
  ownerId = o.user.id;
  await register(editor);
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId)); // cascades menu_items
  await db.delete(changelogEntries).where(eq(changelogEntries.createdBy, admin.username));
  await db.delete(changelogEditors).where(eq(changelogEditors.username, editor.username));
  await db.delete(adminAuditLog).where(eq(adminAuditLog.actorUsername, admin.username));
  await db.delete(users).where(inArray(users.username, [admin.username, owner.username, editor.username]));
  await pool.end();
});

describe('单条审核动作写入审计日志', () => {
  it('approving a restaurant logs a moderation.review row', async () => {
    const shop = await createShop(`审计单条店_${stamp}`);
    const res = await req(`/api/admin/restaurants/${shop.id}/review`, adminCookie, {
      method: 'POST',
      body: { decision: 'approved' },
    });
    expect(res.status).toBe(200);

    const rows = await auditRowsFor(shop.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorUsername).toBe(admin.username);
    expect(rows[0]!.action).toBe('moderation.review');
    expect(rows[0]!.targetType).toBe('restaurant');
    expect(rows[0]!.targetLabel).toBe(shop.name);
    expect(rows[0]!.detail).toEqual({ decision: 'approved', reason: undefined });
    expect(rows[0]!.batchId).toBeNull();
  });
});

describe('批量审核动作共享 batchId', () => {
  it('two targets approved in one batch call share the same batchId', async () => {
    const shopA = await createShop(`审计批量店A_${stamp}`);
    const shopB = await createShop(`审计批量店B_${stamp}`);

    const res = await req('/api/admin/moderation/review', adminCookie, {
      method: 'POST',
      body: {
        targets: [
          { targetType: 'restaurant', restaurantId: shopA.id },
          { targetType: 'restaurant', restaurantId: shopB.id },
        ],
        decision: 'approved',
      },
    });
    expect(res.status).toBe(200);

    const [rowA] = await auditRowsFor(shopA.id);
    const [rowB] = await auditRowsFor(shopB.id);
    expect(rowA!.batchId).not.toBeNull();
    expect(rowA!.batchId).toBe(rowB!.batchId);
  });
});

describe('店铺优先级调整写入审计日志', () => {
  it('logs a shop.priority_change row with before/after detail', async () => {
    const shop = await createShop(`审计优先级店_${stamp}`);
    const res = await req(`/api/admin/shops/${shop.id}/priority`, adminCookie, {
      method: 'POST',
      body: { priority: 100 },
    });
    expect(res.status).toBe(200);

    const rows = await auditRowsFor(shop.id);
    const row = rows.find((r) => r.action === 'shop.priority_change');
    expect(row).toBeDefined();
    expect(row!.detail).toEqual({ from: 0, to: 100 });
  });
});

describe('封禁级联与审计日志', () => {
  it('the ban row and its cascaded content-rejection rows share one batchId', async () => {
    const offender = { username: `t_audit_b_${stamp}`, password: 'secret123' };
    const o = await register(offender);
    // 让被封禁者拥有一个待审核店铺，验证级联驳回也被记录。
    const offenderCookie = o.cookie;
    const shopRes = await req('/api/merchant/restaurants', offenderCookie, {
      method: 'POST',
      body: {
        name: `待封禁店_${stamp}`,
        category: '中式快餐',
        emoji: '🍔',
        bgColor: '#112233',
        deliveryFee: 3,
        minOrder: 15,
        deliveryTime: 30,
        tags: [],
        menuCategories: ['招牌'],
      },
    });
    const shop = (await shopRes.json()) as MerchantRestaurantDto;

    const banRes = await req(`/api/admin/users/${o.user.id}/ban`, adminCookie, {
      method: 'POST',
      body: { reason: '测试封禁' },
    });
    expect(banRes.status).toBe(200);

    const banRows = await auditRowsFor(o.user.id);
    const banRow = banRows.find((r) => r.action === 'user.ban');
    expect(banRow).toBeDefined();

    const shopRows = await auditRowsFor(shop.id);
    const cascadedRow = shopRows.find((r) => r.action === 'moderation.review');
    expect(cascadedRow).toBeDefined();
    expect(cascadedRow!.batchId).toBe(banRow!.batchId);

    await db.delete(restaurants).where(eq(restaurants.ownerId, o.user.id));
    await db.delete(users).where(eq(users.id, o.user.id));
  });
});

describe('举报处理：记录在举报行被删除后仍可查', () => {
  it('logs a report.resolve row that outlives the deleted reports row', async () => {
    const shop = await createShop(`审计举报店_${stamp}`);
    await req(`/api/admin/restaurants/${shop.id}/review`, adminCookie, {
      method: 'POST',
      body: { decision: 'approved' },
    });

    const reporter = { username: `t_audit_r_${stamp}`, password: 'secret123' };
    const r = await register(reporter);
    const createRes = await req('/api/reports', r.cookie, {
      method: 'POST',
      body: { targetType: 'restaurant', restaurantId: shop.id, reason: '审计测试举报' },
    });
    expect(createRes.status).toBe(201);
    const { id: reportId } = (await createRes.json()) as { id: string };

    const resolveRes = await req('/api/admin/reports/resolve', adminCookie, {
      method: 'POST',
      body: { reportIds: [reportId], decision: 'approved' },
    });
    expect(resolveRes.status).toBe(200);
    expect(((await resolveRes.json()) as ResolveReportsResultDto).succeeded).toBe(1);

    const [reportRow] = await db.select().from(reports).where(eq(reports.id, reportId));
    expect(reportRow).toBeUndefined(); // 举报行本身已被删除

    const [logRow] = await auditRowsFor(reportId);
    expect(logRow).toBeDefined();
    expect(logRow!.action).toBe('report.resolve');
    expect(logRow!.targetLabel).toBe('审计测试举报');

    await db.delete(users).where(eq(users.id, r.user.id));
  });
});

describe('公告增删改与编辑者授予/撤销写入审计日志', () => {
  it('changelog create/update/delete each log a row', async () => {
    const createRes = await req('/api/admin/changelog', adminCookie, {
      method: 'POST',
      body: { content: `审计公告_${stamp}`, versionMajor: baseMajor },
    });
    const entry = (await createRes.json()) as ChangelogEntryDto;

    const updateRes = await req(`/api/admin/changelog/${entry.id}`, adminCookie, {
      method: 'PATCH',
      body: { content: `审计公告更新_${stamp}` },
    });
    expect(updateRes.status).toBe(200);

    const deleteRes = await req(`/api/admin/changelog/${entry.id}`, adminCookie, { method: 'DELETE' });
    expect(deleteRes.status).toBe(200);

    const rows = await auditRowsFor(entry.id);
    expect(rows.map((r) => r.action).sort()).toEqual(['changelog.create', 'changelog.delete', 'changelog.update']);
  });

  it('changelog editor grant/revoke each log a row', async () => {
    const grantRes = await req('/api/admin/changelog-editors', adminCookie, {
      method: 'POST',
      body: { username: editor.username },
    });
    expect(grantRes.status).toBe(200);
    const revokeRes = await req(`/api/admin/changelog-editors/${editor.username}`, adminCookie, {
      method: 'DELETE',
    });
    expect(revokeRes.status).toBe(200);

    const rows = await auditRowsFor(editor.username.toLowerCase());
    expect(rows.map((r) => r.action).sort()).toEqual(['changelog_editor.grant', 'changelog_editor.revoke']);
  });
});

describe('GET /api/admin/audit-log 筛选与分页', () => {
  it('filters by actor, action and targetType, and paginates', async () => {
    const shop = await createShop(`审计筛选店_${stamp}`);
    await req(`/api/admin/restaurants/${shop.id}/review`, adminCookie, {
      method: 'POST',
      body: { decision: 'approved' },
    });

    const byActor = await req(`/api/admin/audit-log?actor=${admin.username}&pageSize=1&page=1`, adminCookie);
    expect(byActor.status).toBe(200);
    const actorList = (await byActor.json()) as AdminAuditLogListDto;
    expect(actorList.items).toHaveLength(1);
    expect(actorList.pageSize).toBe(1);
    expect(actorList.total).toBeGreaterThan(1);
    expect(actorList.items.every((r: AdminAuditLogEntryDto) => r.actorUsername === admin.username)).toBe(true);

    const byAction = await req(
      `/api/admin/audit-log?actor=${admin.username}&action=shop.priority_change`,
      adminCookie,
    );
    const actionList = (await byAction.json()) as AdminAuditLogListDto;
    expect(actionList.items.every((r) => r.action === 'shop.priority_change')).toBe(true);
    expect(actionList.items.length).toBeGreaterThanOrEqual(1);

    const byTargetType = await req(
      `/api/admin/audit-log?actor=${admin.username}&targetType=changelogEntry`,
      adminCookie,
    );
    const targetTypeList = (await byTargetType.json()) as AdminAuditLogListDto;
    expect(targetTypeList.items.every((r) => r.targetType === 'changelogEntry')).toBe(true);
    expect(targetTypeList.items.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects anonymous (401) and non-admin (403)', async () => {
    expect((await app.request('/api/admin/audit-log')).status).toBe(401);
    expect((await req('/api/admin/audit-log', ownerCookie)).status).toBe(403);
  });
});
