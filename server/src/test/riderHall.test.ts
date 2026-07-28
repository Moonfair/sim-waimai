import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type {
  OrderDto,
  Restaurant,
  RiderHallGrabResultDto,
  RiderHallOrderPreviewDto,
  RiderHallPendingDto,
  RiderStatsDto,
} from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { orders, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const alice = { username: `t_hall_a_${stamp}`, password: 'secret123' };
const bob = { username: `t_hall_b_${stamp}`, password: 'secret123' };
const carol = { username: `t_hall_c_${stamp}`, password: 'secret123' };
let aliceCookie = '';
let bobCookie = '';
let carolCookie = '';
let bobId = '';
let heytea: Restaurant;

const address = { recipientName: '测试', phone: '13800000000', address: '北京市朝阳区测试路1号' };

async function registerAndLogin(cred: { username: string; password: string }) {
  const res = await registerTestUser(app, cred);
  expect(res.status).toBe(200);
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  const body = (await res.json()) as { id: string };
  return { cookie, id: body.id };
}

function req(path: string, cookie: string, init?: { method?: string; body?: unknown }) {
  return app.request(path, {
    method: init?.method ?? 'GET',
    headers: {
      Cookie: cookie,
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

beforeAll(async () => {
  const a = await registerAndLogin(alice);
  aliceCookie = a.cookie;
  const b = await registerAndLogin(bob);
  bobCookie = b.cookie;
  bobId = b.id;
  const c = await registerAndLogin(carol);
  carolCookie = c.cookie;
  const res = await app.request('/api/restaurants/heytea');
  heytea = (await res.json()) as Restaurant;
});

afterAll(async () => {
  for (const cred of [alice, bob, carol]) {
    const [u] = await db.select().from(users).where(eq(users.username, cred.username));
    if (u) {
      await db.delete(orders).where(eq(orders.userId, u.id));
      await db.delete(users).where(eq(users.id, u.id));
    }
  }
  await pool.end();
});

function pickPlainItem() {
  return heytea.menu.find((m) => !m.optionGroups?.length)!;
}

async function placeOrder(cookie: string, realPersonDelivery: boolean): Promise<OrderDto> {
  const plain = pickPlainItem();
  const qty = Math.max(1, Math.ceil(heytea.minOrder / plain.price));
  const res = await req('/api/orders', cookie, {
    method: 'POST',
    body: {
      restaurantId: 'heytea',
      items: [{ menuItemId: plain.id, quantity: qty }],
      address,
      realPersonDelivery,
    },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as OrderDto;
}

/** Actively drains every order currently visible to `cookie` by grabbing it — used to get a
 *  deterministic starting point despite other test files (e.g. orders.test.ts) concurrently
 *  leaving their own un-grabbed real_person orders in the same shared dev DB. */
async function drainHallFor(cookie: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const p = await req('/api/rider-hall/preview', cookie);
    if (p.status === 404) return;
    const preview = (await p.json()) as RiderHallOrderPreviewDto;
    await req('/api/rider-hall/grab', cookie, { method: 'POST', body: { orderId: preview.id } });
  }
}

describe('GET /api/rider-hall/pending', () => {
  it('requires auth', async () => {
    const res = await app.request('/api/rider-hall/pending');
    expect(res.status).toBe(401);
  });

  it('shows a real_person pending order to other users but not to its own owner', async () => {
    const order = await placeOrder(aliceCookie, true);

    const asBob = await req('/api/rider-hall/pending', bobCookie);
    expect(asBob.status).toBe(200);
    const bobPending = (await asBob.json()) as RiderHallPendingDto;
    expect(bobPending.items.some((i) => i.id === order.id)).toBe(true);

    const asAlice = await req('/api/rider-hall/pending', aliceCookie);
    const alicePending = (await asAlice.json()) as RiderHallPendingDto;
    expect(alicePending.items.some((i) => i.id === order.id)).toBe(false);
  });

  it('never lists simulated-delivery orders', async () => {
    const order = await placeOrder(aliceCookie, false);
    const asBob = await req('/api/rider-hall/pending', bobCookie);
    const bobPending = (await asBob.json()) as RiderHallPendingDto;
    expect(bobPending.items.some((i) => i.id === order.id)).toBe(false);
  });
});

describe('GET /api/rider-hall/preview', () => {
  it('requires auth', async () => {
    const res = await app.request('/api/rider-hall/preview');
    expect(res.status).toBe(401);
  });

  it("never returns the caller's own order in their own hall preview", async () => {
    // Other test files (e.g. orders.test.ts) may concurrently have their own unrelated
    // real_person orders pending in this shared dev DB, so we can't assert a blanket 404 —
    // only that alice's own order specifically never shows up in her own preview.
    const order = await placeOrder(aliceCookie, true);
    const res = await req('/api/rider-hall/preview', aliceCookie);
    if (res.status === 200) {
      const preview = (await res.json()) as RiderHallOrderPreviewDto;
      expect(preview.id).not.toBe(order.id);
    } else {
      expect(res.status).toBe(404);
    }
  });

  it('404s when the hall is empty for this user', async () => {
    await drainHallFor(bobCookie);
    const res = await req('/api/rider-hall/preview', bobCookie);
    expect(res.status).toBe(404);
  });

  it('returns full order detail for another user, excluding any recipient contact info', async () => {
    await drainHallFor(bobCookie);
    const order = await placeOrder(aliceCookie, true);
    const res = await req('/api/rider-hall/preview', bobCookie);
    expect(res.status).toBe(200);
    const preview = (await res.json()) as RiderHallOrderPreviewDto;
    expect(preview.id).toBe(order.id);
    expect(preview.buyerUsername).toBe(alice.username);
    expect(preview.restaurantName).toBe(order.restaurant.name);
    expect(preview.items.length).toBeGreaterThan(0);
    expect(preview.subtotal).toBeCloseTo(order.subtotal, 2);
    expect(preview.deliveryFee).toBeCloseTo(order.deliveryFee, 2);
    expect(preview.total).toBeCloseTo(order.total, 2);

    const keys = Object.keys(preview);
    expect(keys).not.toContain('address');
    expect(keys).not.toContain('phone');
    expect(keys).not.toContain('recipientName');
    expect(JSON.stringify(preview)).not.toContain(address.phone);
    expect(JSON.stringify(preview)).not.toContain(address.address);
  });

  it('returns the newest pending order when multiple are available', async () => {
    await drainHallFor(bobCookie);
    const older = await placeOrder(aliceCookie, true);
    await new Promise((r) => setTimeout(r, 10));
    const newer = await placeOrder(aliceCookie, true);

    const res = await req('/api/rider-hall/preview', bobCookie);
    const preview = (await res.json()) as RiderHallOrderPreviewDto;
    // Another concurrently-running test file could legitimately create an even-newer
    // real_person order between our two placeOrder calls above — that would still be correct
    // "newest" behavior. What we actually assert is the ordering guarantee: whatever comes
    // back is at least as new as `newer`, and never the strictly-older `older`.
    expect(new Date(preview.createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(newer.createdAt).getTime(),
    );
    expect(preview.id).not.toBe(older.id);
  });
});

describe('POST /api/rider-hall/grab', () => {
  it('requires auth', async () => {
    const res = await app.request('/api/rider-hall/grab', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('claims the specified order: sets rider info, status delivering, grabbedAt', async () => {
    const order = await placeOrder(aliceCookie, true);

    const grab = await req('/api/rider-hall/grab', bobCookie, {
      method: 'POST',
      body: { orderId: order.id },
    });
    expect(grab.status).toBe(200);
    const result = (await grab.json()) as RiderHallGrabResultDto;
    expect(result.id).toBe(order.id);

    const fetched = await req(`/api/orders/${order.id}`, aliceCookie);
    const updated = (await fetched.json()) as OrderDto;
    expect(updated.status).toBe('delivering');
    expect(updated.riderUserId).toBe(bobId);
    expect(updated.rider?.name).toBe(bob.username);
    expect(updated.grabbedAt).not.toBeNull();
  });

  it('409s for an order that was already grabbed by someone else', async () => {
    const order = await placeOrder(aliceCookie, true);
    const first = await req('/api/rider-hall/grab', bobCookie, {
      method: 'POST',
      body: { orderId: order.id },
    });
    expect(first.status).toBe(200);

    const second = await req('/api/rider-hall/grab', carolCookie, {
      method: 'POST',
      body: { orderId: order.id },
    });
    expect(second.status).toBe(409);
  });

  it("409s a user trying to grab their own order", async () => {
    const order = await placeOrder(aliceCookie, true);
    const grab = await req('/api/rider-hall/grab', aliceCookie, {
      method: 'POST',
      body: { orderId: order.id },
    });
    expect(grab.status).toBe(409);

    // still unclaimed and gettable by someone else
    const grabByBob = await req('/api/rider-hall/grab', bobCookie, {
      method: 'POST',
      body: { orderId: order.id },
    });
    expect(grabByBob.status).toBe(200);
    expect(((await grabByBob.json()) as RiderHallGrabResultDto).id).toBe(order.id);
  });

  it('409s for a non-existent orderId', async () => {
    const grab = await req('/api/rider-hall/grab', bobCookie, {
      method: 'POST',
      body: { orderId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(grab.status).toBe(409);
  });

  it('only one of two concurrent grabbers succeeds when both target the same orderId', async () => {
    const order = await placeOrder(aliceCookie, true);

    const [r1, r2] = await Promise.all([
      req('/api/rider-hall/grab', bobCookie, { method: 'POST', body: { orderId: order.id } }),
      req('/api/rider-hall/grab', carolCookie, { method: 'POST', body: { orderId: order.id } }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});

describe('GET /api/rider-hall/stats/me', () => {
  it('requires auth', async () => {
    const res = await app.request('/api/rider-hall/stats/me');
    expect(res.status).toBe(401);
  });

  it('counts only completed orders where the caller is the rider, sums their delivery fee', async () => {
    const before = (await (
      await req('/api/rider-hall/stats/me', bobCookie)
    ).json()) as RiderStatsDto;

    const order = await placeOrder(aliceCookie, true);
    const grab = await req('/api/rider-hall/grab', bobCookie, {
      method: 'POST',
      body: { orderId: order.id },
    });
    expect(grab.status).toBe(200);

    // still delivering, not completed yet — should not count
    const midway = (await (
      await req('/api/rider-hall/stats/me', bobCookie)
    ).json()) as RiderStatsDto;
    expect(midway.completedCount).toBe(before.completedCount);

    const complete = await req(`/api/orders/${order.id}/status`, aliceCookie, {
      method: 'PATCH',
      body: { status: 'completed' },
    });
    expect(complete.status).toBe(200);

    const after = (await (
      await req('/api/rider-hall/stats/me', bobCookie)
    ).json()) as RiderStatsDto;
    expect(after.completedCount).toBe(before.completedCount + 1);
    expect(after.totalEarned).toBeCloseTo(before.totalEarned + heytea.deliveryFee, 2);
  });
});

describe('GET /api/rider-hall/stream', () => {
  it('requires auth', async () => {
    const res = await app.request('/api/rider-hall/stream');
    expect(res.status).toBe(401);
  });

  it('responds with an SSE content-type and an initial hello event', async () => {
    const res = await req('/api/rider-hall/stream', bobCookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('event: hello');
    await reader.cancel();
  });
});
