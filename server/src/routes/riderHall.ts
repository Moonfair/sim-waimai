import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { fenToYuan } from '@sim-waimai/shared';
import type {
  RiderHallGrabResultDto,
  RiderHallPendingDto,
  RiderStatsDto,
} from '@sim-waimai/shared';
import { db } from '../db/client';
import { orders, users } from '../db/schema';
import { toRiderHallOrderSummary, toRiderHallPreviewDto } from '../lib/mappers';
import { computeRiderTier } from '../lib/riderTier';
import { buildRealPersonRider } from '../lib/riders';
import { emitHallChanged, subscribeHallChanged } from '../lib/riderHallEvents';
import { requireAuth } from '../middleware/auth';
import { UUID_RE, validateJson } from '../lib/validate';

const grabSchema = z.object({ orderId: z.string().regex(UUID_RE, '订单不存在') });

const HALL_KEEPALIVE_MS = 25_000;

export const riderHallRoutes = new Hono()
  .get('/pending', requireAuth, async (c) => {
    const user = c.get('user');
    const rows = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.deliveryType, 'real_person'),
          eq(orders.status, 'pending'),
          isNull(orders.riderUserId),
          ne(orders.userId, user.sub),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(100);
    const dto: RiderHallPendingDto = { items: rows.map(toRiderHallOrderSummary), count: rows.length };
    return c.json(dto);
  })

  .get('/preview', requireAuth, async (c) => {
    const user = c.get('user');
    const [row] = await db
      .select({ order: orders, buyerUsername: users.username })
      .from(orders)
      .leftJoin(users, eq(users.id, orders.userId))
      .where(
        and(
          eq(orders.deliveryType, 'real_person'),
          eq(orders.status, 'pending'),
          isNull(orders.riderUserId),
          ne(orders.userId, user.sub),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(1);
    if (!row) return c.json({ error: '暂无待接订单' }, 404);
    return c.json(toRiderHallPreviewDto(row.order, row.buyerUsername ?? ''));
  })

  .get('/stream', requireAuth, (c) =>
    streamSSE(c, async (stream) => {
      let closed = false;
      const push = () => {
        stream.writeSSE({ event: 'changed', data: String(Date.now()) }).catch(() => {});
      };
      const unsubscribe = subscribeHallChanged(push);
      stream.onAbort(() => {
        closed = true;
        unsubscribe();
      });
      await stream.writeSSE({ event: 'hello', data: 'ok' });
      while (!closed) {
        await stream.sleep(HALL_KEEPALIVE_MS);
        if (closed) break;
        try {
          await stream.writeSSE({ event: 'keepalive', data: String(Date.now()) });
        } catch {
          closed = true;
        }
      }
      unsubscribe();
    }),
  )

  .post('/grab', requireAuth, validateJson(grabSchema), async (c) => {
    const user = c.get('user');
    const { orderId } = c.req.valid('json');
    const riderSnapshot = buildRealPersonRider(user);
    const result = await db.execute<{ id: string }>(sql`
      UPDATE orders
      SET status = 'delivering',
          rider_user_id = ${user.sub},
          rider_snapshot = ${JSON.stringify(riderSnapshot)}::jsonb,
          grabbed_at = now()
      WHERE id = ${orderId}
        AND delivery_type = 'real_person'
        AND status = 'pending'
        AND rider_user_id IS NULL
        AND user_id != ${user.sub}
      RETURNING id
    `);
    const claimedId = result.rows[0]?.id;
    if (!claimedId) return c.json({ error: '手慢了，这单已经被抢走了' }, 409);

    emitHallChanged();
    const [row] = await db.select().from(orders).where(eq(orders.id, claimedId));
    const dto: RiderHallGrabResultDto = {
      id: row!.id,
      restaurantName: row!.restaurantSnapshot.name,
      restaurantEmoji: row!.restaurantSnapshot.emoji,
      deliveryFee: fenToYuan(row!.deliveryFeeFen),
    };
    return c.json(dto);
  })

  .get('/stats/me', requireAuth, async (c) => {
    const user = c.get('user');
    const [totals] = await db
      .select({
        completedCount: sql<number>`count(*)::int`,
        totalFeeFen: sql<number>`COALESCE(sum(${orders.deliveryFeeFen}), 0)::int`,
      })
      .from(orders)
      .where(and(eq(orders.riderUserId, user.sub), eq(orders.status, 'completed')));

    const completedCount = totals?.completedCount ?? 0;
    const tier = computeRiderTier(completedCount);
    const dto: RiderStatsDto = {
      completedCount,
      totalEarned: fenToYuan(totals?.totalFeeFen ?? 0),
      tier: tier.label,
      tierIndex: tier.index,
      nextTierThreshold: tier.nextThreshold,
    };
    return c.json(dto);
  });
