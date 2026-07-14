import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { MerchantRestaurantDto, PresignResponse } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { restaurants, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const owner = { username: `t_up_o_${stamp}`, password: 'secret123' };
const rando = { username: `t_up_r_${stamp}`, password: 'secret123' };
let ownerCookie = '';
let randoCookie = '';
let ownerId = '';
let shopId = '';

async function register(cred: { username: string; password: string }) {
  const res = await registerTestUser(app, cred);
  return {
    cookie: (res.headers.get('set-cookie') ?? '').split(';')[0],
    id: ((await res.json()) as { id: string }).id,
  };
}

beforeAll(async () => {
  const o = await register(owner);
  ownerCookie = o.cookie;
  ownerId = o.id;
  randoCookie = (await register(rando)).cookie;

  const res = await app.request('/api/merchant/restaurants', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: JSON.stringify({
      name: '上传测试店',
      category: '小吃零食',
      emoji: '🍢',
      bgColor: '#aa5500',
      deliveryFee: 1,
      minOrder: 1,
      deliveryTime: 20,
      menuCategories: ['招牌'],
    }),
  });
  shopId = ((await res.json()) as MerchantRestaurantDto).id;
});

afterAll(async () => {
  await db.delete(restaurants).where(eq(restaurants.ownerId, ownerId));
  await db.delete(users).where(eq(users.username, owner.username));
  await db.delete(users).where(eq(users.username, rando.username));
  await pool.end();
});

function presign(cookie: string, body: unknown) {
  return app.request('/api/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

describe('uploads (local fallback, COS unconfigured)', () => {
  it('presigns item upload for the owner and round-trips the bytes', async () => {
    const res = await presign(ownerCookie, {
      kind: 'item',
      restaurantId: shopId,
      contentType: 'image/png',
    });
    expect(res.status).toBe(200);
    const grant = (await res.json()) as PresignResponse;
    expect(grant.uploadUrl).toMatch(/^\/api\/uploads\/local\/uploads\//);
    expect(grant.publicUrl).toBe(grant.uploadUrl);

    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();
    const put = await app.request(grant.uploadUrl, {
      method: 'PUT',
      headers: { Cookie: ownerCookie, 'Content-Type': 'image/png' },
      body: bytes,
    });
    expect(put.status).toBe(200);

    const get = await app.request(grant.publicUrl);
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/png');
    // Bytes are re-encoded server-side (not stored verbatim), so compare decoded pixels instead
    // of the raw buffer.
    const stored = await sharp(Buffer.from(await get.arrayBuffer())).raw().toBuffer();
    const original = await sharp(bytes).raw().toBuffer();
    expect(new Uint8Array(stored)).toEqual(new Uint8Array(original));
  });

  it('rejects a non-image file disguised with an image extension', async () => {
    const grant = (await (
      await presign(ownerCookie, { kind: 'item', restaurantId: shopId, contentType: 'image/png' })
    ).json()) as PresignResponse;

    const put = await app.request(grant.uploadUrl, {
      method: 'PUT',
      headers: { Cookie: ownerCookie, 'Content-Type': 'image/png' },
      body: new TextEncoder().encode('<script>alert(1)</script>not actually a png'),
    });
    expect(put.status).toBe(400);
  });

  it('rejects presign for a shop you do not own', async () => {
    const res = await presign(randoCookie, {
      kind: 'banner',
      restaurantId: shopId,
      contentType: 'image/jpeg',
    });
    expect(res.status).toBe(403);
  });

  it('review kind needs no restaurant, only auth', async () => {
    const res = await presign(randoCookie, { kind: 'review', contentType: 'image/webp' });
    expect(res.status).toBe(200);
    expect((await presign('', { kind: 'review', contentType: 'image/webp' })).status).toBe(401);
  });

  it('rejects a non-owner overwriting another shop\'s uploaded item image', async () => {
    const grant = (await (
      await presign(ownerCookie, { kind: 'item', restaurantId: shopId, contentType: 'image/png' })
    ).json()) as PresignResponse;

    const put = await app.request(grant.uploadUrl, {
      method: 'PUT',
      headers: { Cookie: randoCookie, 'Content-Type': 'image/png' },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(put.status).toBe(403);
  });

  it('rejects uploading a review photo under another user\'s id', async () => {
    const grant = (await (
      await presign(ownerCookie, { kind: 'review', contentType: 'image/png' })
    ).json()) as PresignResponse;

    const put = await app.request(grant.uploadUrl, {
      method: 'PUT',
      headers: { Cookie: randoCookie, 'Content-Type': 'image/png' },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(put.status).toBe(403);
  });

  it('rejects unsupported content types and bad keys', async () => {
    expect(
      (
        await presign(ownerCookie, { kind: 'review', contentType: 'application/pdf' })
      ).status,
    ).toBe(400);
    const traversal = await app.request('/api/uploads/local/uploads/../../../etc/passwd.png', {
      method: 'PUT',
      headers: { Cookie: ownerCookie },
      body: new Uint8Array([1]),
    });
    expect([400, 404]).toContain(traversal.status);
  });
});
