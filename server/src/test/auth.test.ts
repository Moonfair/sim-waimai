import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { users } from '../db/schema';

const app = createApp();
const username = `t_auth_${Date.now().toString(36)}`;
const password = 'secret123';

afterAll(async () => {
  await db.delete(users).where(eq(users.username, username));
  await pool.end();
});

function postJson(path: string, body: unknown, cookie?: string) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function cookieOf(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? '';
  return raw.split(';')[0];
}

describe('auth round-trip', () => {
  it('register sets cookie and returns the user', async () => {
    const res = await postJson('/api/auth/register', { username, password });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { username: string };
    expect(body.username).toBe(username);
    expect(body).not.toHaveProperty('passwordHash');
    expect(res.headers.get('set-cookie')).toContain('sw_token=');
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('rejects duplicate username with 409 (case-insensitive)', async () => {
    const res = await postJson('/api/auth/register', {
      username: username.toUpperCase(),
      password,
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('用户名已存在');
  });

  it('rejects short username/password with 400', async () => {
    expect((await postJson('/api/auth/register', { username: 'ab', password })).status).toBe(400);
    expect((await postJson('/api/auth/register', { username: `${username}x`, password: '123' })).status).toBe(400);
  });

  it('login with wrong password fails 401', async () => {
    const res = await postJson('/api/auth/login', { username, password: 'wrong-pass' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('用户名或密码错误');
  });

  it('login → me → logout → me=401', async () => {
    const login = await postJson('/api/auth/login', { username, password });
    expect(login.status).toBe(200);
    const cookie = cookieOf(login);

    const me = await app.request('/api/auth/me', { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { username: string }).username).toBe(username);

    const logout = await postJson('/api/auth/logout', {}, cookie);
    expect(logout.status).toBe(200);
    // logout response must expire the cookie
    expect(logout.headers.get('set-cookie')).toContain('sw_token=;');

    const meAnon = await app.request('/api/auth/me');
    expect(meAnon.status).toBe(401);
  });

  it('me with garbage token fails 401', async () => {
    const res = await app.request('/api/auth/me', { headers: { Cookie: 'sw_token=garbage' } });
    expect(res.status).toBe(401);
  });
});
