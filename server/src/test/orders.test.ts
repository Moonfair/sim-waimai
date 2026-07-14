import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { OrderDto, OrderSummaryDto, Page, Restaurant } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { orders, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const alice = { username: `t_ord_a_${stamp}`, password: 'secret123' };
const bob = { username: `t_ord_b_${stamp}`, password: 'secret123' };
let aliceCookie = '';
let bobCookie = '';
let aliceId = '';
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
  aliceId = a.id;
  const b = await registerAndLogin(bob);
  bobCookie = b.cookie;
  const res = await app.request('/api/restaurants/heytea');
  heytea = (await res.json()) as Restaurant;
});

afterAll(async () => {
  for (const cred of [alice, bob]) {
    const [u] = await db.select().from(users).where(eq(users.username, cred.username));
    if (u) {
      await db.delete(orders).where(eq(orders.userId, u.id));
      await db.delete(users).where(eq(users.id, u.id));
    }
  }
  await pool.end();
});

/** Pick an item with a required single option group, and one without options. */
function pickItems() {
  const withOptions = heytea.menu.find((m) =>
    m.optionGroups?.some((g) => g.selectionType === 'single' && g.required),
  )!;
  const plain = heytea.menu.find((m) => !m.optionGroups?.length)!;
  return { withOptions, plain };
}

describe('POST /api/orders', () => {
  it('requires auth', async () => {
    const res = await app.request('/api/orders', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('re-prices server-side from the DB including option deltas', async () => {
    const { withOptions, plain } = pickItems();
    // one option from every required single group (prefer a priced one)
    const picked = withOptions
      .optionGroups!.filter((g) => g.selectionType === 'single' && g.required)
      .map((g) => g.options.find((o) => o.priceDelta > 0) ?? g.options[0]);
    const deltaSum = picked.reduce((s, o) => s + o.priceDelta, 0);

    const qty = Math.max(1, Math.ceil(heytea.minOrder / plain.price));
    const res = await req('/api/orders', aliceCookie, {
      method: 'POST',
      body: {
        restaurantId: 'heytea',
        items: [
          { menuItemId: withOptions.id, quantity: 2, selectedOptionIds: picked.map((o) => o.id) },
          { menuItemId: plain.id, quantity: qty },
        ],
        address,
      },
    });
    expect(res.status).toBe(200);
    const order = (await res.json()) as OrderDto;

    const expectedSubtotal =
      Math.round(((withOptions.price + deltaSum) * 2 + plain.price * qty) * 100) / 100;
    const expectedDiscount = expectedSubtotal >= 30 ? 3 : 0;
    expect(order.subtotal).toBeCloseTo(expectedSubtotal, 2);
    expect(order.discount).toBeCloseTo(expectedDiscount, 2);
    expect(order.total).toBeCloseTo(expectedSubtotal + heytea.deliveryFee - expectedDiscount, 2);
    expect(order.status).toBe('pending');
    expect(order.items[0].selectedOptions!.length).toBe(picked.length);
    expect(order.address.address).toBe(address.address);
    expect(order.rider).toBeNull();
  });

  it('rejects unknown menu item', async () => {
    const res = await req('/api/orders', aliceCookie, {
      method: 'POST',
      body: {
        restaurantId: 'heytea',
        items: [{ menuItemId: 'no-such-item', quantity: 1 }],
        address,
      },
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing required option group', async () => {
    const { withOptions } = pickItems();
    const res = await req('/api/orders', aliceCookie, {
      method: 'POST',
      body: {
        restaurantId: 'heytea',
        items: [{ menuItemId: withOptions.id, quantity: 5 }],
        address,
      },
    });
    expect(res.status).toBe(400);
  });

  it('rejects order below minimum', async () => {
    if (heytea.minOrder <= 0) return;
    const { plain } = pickItems();
    if (plain.price >= heytea.minOrder) return;
    const res = await req('/api/orders', aliceCookie, {
      method: 'POST',
      body: {
        restaurantId: 'heytea',
        items: [{ menuItemId: plain.id, quantity: 1 }],
        address,
      },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('起送');
  });
});

describe('status transitions', () => {
  async function placeOrder(): Promise<OrderDto> {
    const { plain } = pickItems();
    const qty = Math.max(1, Math.ceil(heytea.minOrder / plain.price));
    const res = await req('/api/orders', aliceCookie, {
      method: 'POST',
      body: { restaurantId: 'heytea', items: [{ menuItemId: plain.id, quantity: qty }], address },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as OrderDto;
  }

  it('pending → delivering assigns a rider; → completed stamps completedAt', async () => {
    const order = await placeOrder();

    const bad = await req(`/api/orders/${order.id}/status`, aliceCookie, {
      method: 'PATCH',
      body: { status: 'completed' },
    });
    expect(bad.status).toBe(400);

    const d = await req(`/api/orders/${order.id}/status`, aliceCookie, {
      method: 'PATCH',
      body: { status: 'delivering' },
    });
    expect(d.status).toBe(200);
    const delivering = (await d.json()) as OrderDto;
    expect(delivering.status).toBe('delivering');
    expect(delivering.rider).not.toBeNull();

    const done = await req(`/api/orders/${order.id}/status`, aliceCookie, {
      method: 'PATCH',
      body: { status: 'completed' },
    });
    const completed = (await done.json()) as OrderDto;
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).not.toBeNull();

    const again = await req(`/api/orders/${order.id}/status`, aliceCookie, {
      method: 'PATCH',
      body: { status: 'delivering' },
    });
    expect(again.status).toBe(400);
  });

  it("bob cannot see or advance alice's order", async () => {
    const order = await placeOrder();
    expect((await req(`/api/orders/${order.id}`, bobCookie)).status).toBe(404);
    const patch = await req(`/api/orders/${order.id}/status`, bobCookie, {
      method: 'PATCH',
      body: { status: 'delivering' },
    });
    expect(patch.status).toBe(403);
  });
});

describe('GET /api/orders keyset pagination', () => {
  it('pages 45 orders as 20/20/5 with no dups or gaps', async () => {
    // Insert 45 rows directly for speed; spread createdAt so ordering is deterministic
    const base = Date.now();
    await db.insert(orders).values(
      Array.from({ length: 45 }, (_, i) => ({
        userId: aliceId,
        restaurantId: 'heytea',
        restaurantSnapshot: { name: '懒茶', emoji: '🧋', bgColor: '#333' },
        status: 'completed' as const,
        items: [
          {
            key: `x${i}`,
            menuItemId: 'x',
            name: `批量单${i}`,
            emoji: '🧋',
            quantity: 1,
            unitPrice: 10,
            calories: 100,
            lineTotal: 10,
          },
        ],
        subtotalFen: 1000,
        deliveryFeeFen: 300,
        totalFen: 1300,
        totalCalories: 100,
        addressSnapshot: address,
        createdAt: new Date(base - i * 1000),
      })),
    );

    const seen = new Set<string>();
    let cursor: string | null = null;
    const pages: number[] = [];
    let prevCreatedAt = Infinity;
    for (let i = 0; i < 10; i++) {
      const url = cursor
        ? `/api/orders?limit=20&cursor=${encodeURIComponent(cursor)}`
        : '/api/orders?limit=20';
      const res = await req(url, aliceCookie);
      expect(res.status).toBe(200);
      const page = (await res.json()) as Page<OrderSummaryDto>;
      pages.push(page.items.length);
      for (const o of page.items) {
        expect(seen.has(o.id)).toBe(false);
        seen.add(o.id);
        const t = new Date(o.createdAt).getTime();
        expect(t).toBeLessThanOrEqual(prevCreatedAt);
        prevCreatedAt = t;
      }
      cursor = page.nextCursor;
      if (!cursor) break;
    }

    // 45 bulk + a handful placed by earlier tests, still: full pages of 20 then remainder
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.userId, aliceId));
    expect(seen.size).toBe(count);
    expect(pages.every((n, i) => (i < pages.length - 1 ? n === 20 : n <= 20))).toBe(true);
  });

  it('rejects a garbage cursor', async () => {
    const res = await req('/api/orders?cursor=%%%bad', aliceCookie);
    expect(res.status).toBe(400);
  });
});
