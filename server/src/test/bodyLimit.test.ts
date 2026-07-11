import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { pool } from '../db/client';

afterAll(async () => {
  await pool.end();
});

describe('request body limits', () => {
  it('rejects an oversized JSON body with 413 (before auth/validation)', async () => {
    const app = createApp();
    const res = await app.request('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.20' },
      body: JSON.stringify({ blob: 'a'.repeat(300 * 1024) }),
    });
    expect(res.status).toBe(413);
  });

  it('allows larger bodies on the upload path (401 from auth, not 413)', async () => {
    const app = createApp();
    const res = await app.request('/api/uploads/local/uploads/reviews/x/y.png', {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png', 'x-forwarded-for': '203.0.113.21' },
      body: new Uint8Array(300 * 1024), // over the JSON limit, under the 5MB upload limit
    });
    expect(res.status).not.toBe(413);
    expect(res.status).toBe(401);
  });
});
