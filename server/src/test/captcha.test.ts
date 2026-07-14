import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { users } from '../db/schema';
import { registerTestUser } from './testHelpers';

const app = createApp();
const username = `t_cap_${Date.now().toString(36)}`;

afterAll(async () => {
  await db.delete(users).where(eq(users.username, username));
  await pool.end();
});

describe('captcha-gated registration', () => {
  it('issues a solvable arithmetic challenge', async () => {
    const res = await app.request('/api/auth/captcha');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; question: string };
    expect(body.token).toBeTruthy();
    expect(body.question).toMatch(/^\d+ \+ \d+$/);
  });

  it('rejects register with a wrong answer', async () => {
    const challenge = (await (await app.request('/api/auth/captcha')).json()) as {
      token: string;
      question: string;
    };
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: `${username}_wrong`,
        password: 'secret123',
        captchaToken: challenge.token,
        captchaAnswer: -1,
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('验证码错误或已过期');
  });

  it('rejects register missing captcha fields entirely', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `${username}_none`, password: 'secret123' }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts register with the correct answer', async () => {
    const res = await registerTestUser(app, { username, password: 'secret123' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { username: string };
    expect(body.username).toBe(username);
  });
});
