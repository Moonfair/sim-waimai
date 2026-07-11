import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createApp } from '../app';
import { pool } from '../db/client';
import { rateLimit } from '../middleware/rateLimit';

afterAll(async () => {
  await pool.end();
});

function limitedApp(max: number) {
  const app = new Hono();
  app.use('/x', rateLimit({ windowMs: 60_000, max }));
  app.get('/x', (c) => c.json({ ok: true }));
  return app;
}

describe('rateLimit middleware', () => {
  it('allows up to the limit then answers 429 with Retry-After', async () => {
    const app = limitedApp(3);
    const headers = { 'x-forwarded-for': '203.0.113.5' };
    for (let i = 0; i < 3; i++) {
      expect((await app.request('/x', { headers })).status).toBe(200);
    }
    const blocked = await app.request('/x', { headers });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
  });

  it('keys by client ip so a different ip is unaffected', async () => {
    const app = limitedApp(1);
    const ipA = { 'x-forwarded-for': '198.51.100.1' };
    const ipB = { 'x-forwarded-for': '198.51.100.2' };
    expect((await app.request('/x', { headers: ipA })).status).toBe(200);
    expect((await app.request('/x', { headers: ipA })).status).toBe(429);
    expect((await app.request('/x', { headers: ipB })).status).toBe(200);
  });
});

describe('global request rate limiting', () => {
  it('throttles a per-ip flood across endpoints', async () => {
    const app = createApp();
    const headers = { 'x-forwarded-for': '198.18.0.9' };
    let last = 0;
    for (let i = 0; i < 305; i++) {
      last = (await app.request('/api/health', { headers })).status;
    }
    expect(last).toBe(429);
  });
});

describe('auth login rate limiting', () => {
  it('throttles repeated login attempts from one ip', async () => {
    const app = createApp();
    const headers = { 'Content-Type': 'application/json', 'x-forwarded-for': '192.0.2.77' };
    const body = JSON.stringify({ username: 'no_such_user_xyz', password: 'whatever123' });
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await app.request('/api/auth/login', { method: 'POST', headers, body })).status;
    }
    expect(last).toBe(429);
  });
});
