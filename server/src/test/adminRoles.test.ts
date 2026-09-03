import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import type { AdminRoleListDto, AdminRoleUserDto, UserDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { users } from '../db/schema';
import { grantRole, registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const superadmin = { username: `t_roles_sa_${stamp}`, password: 'secret123' };
const admin = { username: `t_roles_a_${stamp}`, password: 'secret123' };
const plain = { username: `t_roles_p_${stamp}`, password: 'secret123' };
const target = { username: `t_roles_tg_${stamp}`, password: 'secret123' };
let superadminCookie = '';
let adminCookie = '';
let plainCookie = '';
let targetCookie = '';

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

beforeAll(async () => {
  const sa = await register(superadmin);
  superadminCookie = sa.cookie;
  await grantRole(superadmin.username, 'superadmin');

  const a = await register(admin);
  adminCookie = a.cookie;
  await grantRole(admin.username, 'admin');

  const p = await register(plain);
  plainCookie = p.cookie;

  const t = await register(target);
  targetCookie = t.cookie;
});

afterAll(async () => {
  await db
    .delete(users)
    .where(inArray(users.username, [superadmin.username, admin.username, plain.username, target.username]));
  await pool.end();
});

describe('管理员管理接口权限', () => {
  it('rejects anonymous (401), plain user and regular admin (403), allows superadmin (200)', async () => {
    expect((await req('/api/admin/admins', '')).status).toBe(401);
    expect((await req('/api/admin/admins', plainCookie)).status).toBe(403);
    expect((await req('/api/admin/admins', adminCookie)).status).toBe(403);
    expect((await req('/api/admin/admins', superadminCookie)).status).toBe(200);
  });

  it('regular admin cannot grant or revoke roles either', async () => {
    const grantRes = await req('/api/admin/admins', adminCookie, {
      method: 'POST',
      body: { username: target.username, role: 'admin' },
    });
    expect(grantRes.status).toBe(403);
    const revokeRes = await req(`/api/admin/admins/${admin.username}`, adminCookie, { method: 'DELETE' });
    expect(revokeRes.status).toBe(403);
  });
});

describe('POST /api/admin/admins', () => {
  it('grants a role and it is visible in the list', async () => {
    const res = await req('/api/admin/admins', superadminCookie, {
      method: 'POST',
      body: { username: target.username, role: 'admin' },
    });
    expect(res.status).toBe(200);
    const dto = (await res.json()) as AdminRoleUserDto;
    expect(dto.role).toBe('admin');

    const listRes = await req('/api/admin/admins', superadminCookie);
    const list = (await listRes.json()) as AdminRoleListDto;
    expect(list.items.some((u) => u.username === target.username && u.role === 'admin')).toBe(true);
  });

  it('takes effect immediately on the target user\'s next request, without re-login', async () => {
    // target was just granted 'admin' above using the cookie obtained before any role existed.
    const before = await req('/api/admin/users', targetCookie);
    expect(before.status).toBe(200);
  });

  it('404s for an unknown username', async () => {
    const res = await req('/api/admin/admins', superadminCookie, {
      method: 'POST',
      body: { username: `t_roles_nobody_${stamp}`, role: 'admin' },
    });
    expect(res.status).toBe(404);
  });

  it('400s when a superadmin tries to change their own role', async () => {
    const res = await req('/api/admin/admins', superadminCookie, {
      method: 'POST',
      body: { username: superadmin.username, role: 'admin' },
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/admin/admins/:username', () => {
  it('revokes a role and it takes effect immediately on the target\'s next request', async () => {
    const res = await req(`/api/admin/admins/${target.username}`, superadminCookie, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const after = await req('/api/admin/users', targetCookie);
    expect(after.status).toBe(403);
  });

  it('404s for a user who currently has no role', async () => {
    const res = await req(`/api/admin/admins/${plain.username}`, superadminCookie, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('400s when a superadmin tries to revoke their own role', async () => {
    const res = await req(`/api/admin/admins/${superadmin.username}`, superadminCookie, { method: 'DELETE' });
    expect(res.status).toBe(400);
  });
});
