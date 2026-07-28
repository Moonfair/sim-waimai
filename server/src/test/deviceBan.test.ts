import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { BanUserResultDto, UserDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { bannedDevices, users } from '../db/schema';
import { registerTestUser, testDeviceId } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_dban_a_${stamp}`, password: 'secret123' };
const offender = { username: `t_dban_off_${stamp}`, password: 'secret123' };
const sharedDeviceId = testDeviceId();
let adminCookie = '';
let offenderId = '';

let savedAdmins: string | undefined;

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
  savedAdmins = process.env.ADMIN_USERNAMES;
  process.env.ADMIN_USERNAMES = [savedAdmins, admin.username].filter(Boolean).join(',');

  const adminRes = await registerTestUser(app, admin);
  adminCookie = (adminRes.headers.get('set-cookie') ?? '').split(';')[0];
  expect(((await adminRes.json()) as UserDto).isAdmin).toBe(true);

  const offenderRes = await registerTestUser(app, { ...offender, deviceId: sharedDeviceId });
  expect(offenderRes.status).toBe(200);
  offenderId = ((await offenderRes.json()) as UserDto).id;
});

afterAll(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = savedAdmins;
  await db.delete(bannedDevices).where(eq(bannedDevices.deviceId, sharedDeviceId));
  await db.delete(users).where(inArray(users.username, [admin.username, offender.username]));
  await pool.end();
});

describe('封禁用户后按设备指纹拦截重新注册/登录', () => {
  it('封禁前：该设备可以正常注册/登录', async () => {
    const otherDeviceUser = { username: `t_dban_pre_${stamp}`, password: 'secret123', deviceId: sharedDeviceId };
    // 尚未封禁时，同设备仍可注册其他账号（验证下面的拦截确实是封禁后才生效，而非设备本身有问题）
    const res = await registerTestUser(app, otherDeviceUser);
    expect(res.status).toBe(200);
    await db.delete(users).where(eq(users.username, otherDeviceUser.username));
  });

  it('封禁用户后，该设备被拉黑', async () => {
    const banRes = await req(`/api/admin/users/${offenderId}/ban`, adminCookie, {
      method: 'POST',
      body: { reason: '测试设备封禁' },
    });
    expect(banRes.status).toBe(200);
    const result = (await banRes.json()) as BanUserResultDto;
    expect(result.bannedDeviceCount).toBeGreaterThanOrEqual(1);
    expect(result.user.deviceCount).toBeGreaterThanOrEqual(1);

    const [row] = await db.select().from(bannedDevices).where(eq(bannedDevices.deviceId, sharedDeviceId));
    expect(row).toBeTruthy();
  });

  it('同设备无法注册新账号', async () => {
    const res = await registerTestUser(app, {
      username: `t_dban_new_${stamp}`,
      password: 'secret123',
      deviceId: sharedDeviceId,
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('该设备已被限制注册');
  });

  it('同设备无法登录（即使账号密码正确）', async () => {
    const res = await req('/api/auth/login', '', {
      method: 'POST',
      body: { username: offender.username, password: offender.password, deviceId: sharedDeviceId },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('该设备已被限制登录');
  });

  it('换一个设备指纹仍可正常注册/登录', async () => {
    const freshDeviceId = testDeviceId();
    const freshUser = { username: `t_dbfr_${stamp}`, password: 'secret123', deviceId: freshDeviceId };
    const registerRes = await registerTestUser(app, freshUser);
    expect(registerRes.status).toBe(200);

    const loginRes = await req('/api/auth/login', '', {
      method: 'POST',
      body: { username: freshUser.username, password: freshUser.password, deviceId: freshDeviceId },
    });
    expect(loginRes.status).toBe(200);

    await db.delete(users).where(eq(users.username, freshUser.username));
  });
});
