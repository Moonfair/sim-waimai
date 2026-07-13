import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { fenToYuan, yuanToFen } from '@sim-waimai/shared';
import type { OrderItemSnapshot, SelectedOptionSnapshot, UserStatsDto } from '@sim-waimai/shared';
import { db } from '../db/client';
import { menuItems, orders, restaurants, reviews } from '../db/schema';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import { toOrderDto, toOrderSummary, toReviewDto, type MenuItemRow } from '../lib/mappers';
import { getRandomRider } from '../lib/riders';
import { UUID_RE, validateJson } from '../lib/validate';
import { requireAuth } from '../middleware/auth';

const createOrderSchema = z.object({
  restaurantId: z.string().min(1),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.number().int().min(1).max(99),
        selectedOptionIds: z.array(z.string()).max(50).optional(),
      }),
    )
    .min(1, '购物车是空的')
    .max(50),
  address: z.object({
    recipientName: z.string().max(30).default(''),
    phone: z.string().max(20).default(''),
    address: z.string().min(1, '请填写收货地址').max(200),
  }),
});

const statusSchema = z.object({
  status: z.enum(['delivering', 'completed']),
});

/** Resolve a line's selected option ids against the item's option groups.
 *  Prices/deltas come from the DB — client-supplied prices are never trusted. */
function resolveOptions(
  item: MenuItemRow,
  selectedIds: string[],
): { selected: SelectedOptionSnapshot[]; deltaFen: number } | { error: string } {
  const groups = item.optionGroups ?? [];
  const idSet = new Set(selectedIds);
  const selected: SelectedOptionSnapshot[] = [];
  const matched = new Set<string>();
  let deltaFen = 0;

  for (const group of groups) {
    const hits = group.options.filter((o) => idSet.has(o.id));
    if (group.selectionType === 'single') {
      if (group.required && hits.length !== 1) {
        return { error: `请选择「${item.name}」的${group.name}` };
      }
      if (hits.length > 1) {
        return { error: `${group.name}只能选择一项` };
      }
    }
    for (const option of hits) {
      matched.add(option.id);
      deltaFen += yuanToFen(option.priceDelta);
      selected.push({
        groupId: group.id,
        groupName: group.name,
        optionId: option.id,
        optionName: option.name,
        priceDelta: option.priceDelta,
      });
    }
  }

  for (const id of idSet) {
    if (!matched.has(id)) return { error: '包含无效的规格选项' };
  }
  return { selected, deltaFen };
}

export const orderRoutes = new Hono()
  .post('/', requireAuth, validateJson(createOrderSchema), async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');

    const [restaurant] = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, body.restaurantId));
    if (!restaurant || !restaurant.isActive || restaurant.reviewStatus !== 'approved') {
      return c.json({ error: '餐厅不存在或已休息' }, 400);
    }

    const ids = [...new Set(body.items.map((i) => i.menuItemId))];
    const rows = await db
      .select()
      .from(menuItems)
      .where(
        and(
          eq(menuItems.restaurantId, restaurant.id),
          inArray(menuItems.id, ids),
          eq(menuItems.isListed, true),
          eq(menuItems.reviewStatus, 'approved'),
        ),
      );
    const itemsById = new Map(rows.map((r) => [r.id, r]));

    const snapshots: OrderItemSnapshot[] = [];
    let subtotalFen = 0;
    let totalCalories = 0;
    for (const line of body.items) {
      const item = itemsById.get(line.menuItemId);
      if (!item) return c.json({ error: '包含无效或已下架的菜品' }, 400);
      const resolved = resolveOptions(item, line.selectedOptionIds ?? []);
      if ('error' in resolved) return c.json({ error: resolved.error }, 400);

      const unitFen = item.priceFen + resolved.deltaFen;
      subtotalFen += unitFen * line.quantity;
      totalCalories += item.calories * line.quantity;

      const snapshot: OrderItemSnapshot = {
        key: line.selectedOptionIds?.length
          ? `${item.id}::${[...line.selectedOptionIds].sort().join('|')}`
          : item.id,
        menuItemId: item.id,
        name: item.name,
        emoji: item.emoji,
        quantity: line.quantity,
        unitPrice: fenToYuan(unitFen),
        calories: item.calories,
        lineTotal: fenToYuan(unitFen * line.quantity),
      };
      if (item.image) snapshot.image = item.image;
      if (resolved.selected.length) snapshot.selectedOptions = resolved.selected;
      snapshots.push(snapshot);
    }

    if (subtotalFen < restaurant.minOrderFen) {
      return c.json({ error: `未达起送价 ¥${fenToYuan(restaurant.minOrderFen)}` }, 400);
    }

    // Must match the 满30减3 promotion the cart page advertises
    const discountFen = subtotalFen >= 3000 ? 300 : 0;

    const [row] = await db
      .insert(orders)
      .values({
        userId: user.sub,
        restaurantId: restaurant.id,
        restaurantSnapshot: {
          name: restaurant.name,
          emoji: restaurant.emoji,
          bgColor: restaurant.bgColor,
        },
        items: snapshots,
        subtotalFen,
        deliveryFeeFen: restaurant.deliveryFeeFen,
        discountFen,
        totalFen: subtotalFen + restaurant.deliveryFeeFen - discountFen,
        totalCalories,
        addressSnapshot: body.address,
      })
      .returning();
    return c.json(toOrderDto(row!));
  })
  .get('/', requireAuth, async (c) => {
    const user = c.get('user');
    const limitRaw = Number(c.req.query('limit') ?? 20);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 20, 1), 50);

    const filters = [eq(orders.userId, user.sub)];
    const cursorParam = c.req.query('cursor');
    if (cursorParam) {
      const cursor = decodeCursor(cursorParam);
      if (!cursor) return c.json({ error: '无效的分页游标' }, 400);
      filters.push(
        sql`(${orders.createdAt}, ${orders.id}) < (${cursor.createdAt}, ${cursor.id}::uuid)`,
      );
    }

    const rows = await db
      .select({ order: orders, reviewId: reviews.id })
      .from(orders)
      .leftJoin(reviews, eq(reviews.orderId, orders.id))
      .where(and(...filters))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return c.json({
      items: page.map((r) => toOrderSummary(r.order, r.reviewId !== null)),
      nextCursor: hasMore && last ? encodeCursor(last.order.createdAt, last.order.id) : null,
    });
  })
  .get('/stats', requireAuth, async (c) => {
    const user = c.get('user');

    const [totals] = await db
      .select({
        count: sql<number>`count(*)::int`,
        savedFen: sql<number>`COALESCE(sum(${orders.totalFen}), 0)::int`,
        calories: sql<number>`COALESCE(sum(${orders.totalCalories}), 0)::int`,
      })
      .from(orders)
      .where(eq(orders.userId, user.sub));

    if (!totals || totals.count === 0) {
      const empty: UserStatsDto = {
        totalOrders: 0,
        totalSaved: 0,
        totalCalories: 0,
        topRestaurant: null,
        topItem: null,
        biggestOrder: null,
      };
      return c.json(empty);
    }

    const [restaurantResult, itemResult, biggestOrderRows] = await Promise.all([
      db.execute<{
        restaurant_id: string;
        order_count: number;
        snapshot: { name: string; emoji: string; bgColor: string };
      }>(sql`
        SELECT restaurant_id,
               count(*)::int AS order_count,
               (array_agg(restaurant_snapshot ORDER BY created_at DESC))[1] AS snapshot
        FROM orders
        WHERE user_id = ${user.sub}
        GROUP BY restaurant_id
        ORDER BY order_count DESC, max(created_at) DESC
        LIMIT 1
      `),
      db.execute<{ name: string; emoji: string; quantity: number }>(sql`
        SELECT item ->> 'name' AS name,
               item ->> 'emoji' AS emoji,
               sum((item ->> 'quantity')::int)::int AS quantity
        FROM orders, jsonb_array_elements(items) AS item
        WHERE user_id = ${user.sub}
        GROUP BY item ->> 'name', item ->> 'emoji'
        ORDER BY quantity DESC
        LIMIT 1
      `),
      db
        .select()
        .from(orders)
        .where(eq(orders.userId, user.sub))
        .orderBy(desc(orders.totalFen))
        .limit(1),
    ]);

    const restaurantRow = restaurantResult.rows[0];
    const itemRow = itemResult.rows[0];
    const biggestOrderRow = biggestOrderRows[0];

    const stats: UserStatsDto = {
      totalOrders: totals.count,
      totalSaved: fenToYuan(totals.savedFen),
      totalCalories: totals.calories,
      topRestaurant: restaurantRow
        ? {
            id: restaurantRow.restaurant_id,
            name: restaurantRow.snapshot.name,
            emoji: restaurantRow.snapshot.emoji,
            bgColor: restaurantRow.snapshot.bgColor,
            orderCount: restaurantRow.order_count,
          }
        : null,
      topItem: itemRow
        ? { name: itemRow.name, emoji: itemRow.emoji, quantity: itemRow.quantity }
        : null,
      biggestOrder: biggestOrderRow
        ? {
            id: biggestOrderRow.id,
            restaurantName: biggestOrderRow.restaurantSnapshot.name,
            restaurantEmoji: biggestOrderRow.restaurantSnapshot.emoji,
            total: fenToYuan(biggestOrderRow.totalFen),
            createdAt: biggestOrderRow.createdAt.toISOString(),
          }
        : null,
    };
    return c.json(stats);
  })
  .get('/:id', requireAuth, async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: '订单不存在' }, 404);
    const [row] = await db.select().from(orders).where(eq(orders.id, id));
    if (!row || row.userId !== user.sub) return c.json({ error: '订单不存在' }, 404);
    const [review] = await db.select().from(reviews).where(eq(reviews.orderId, id));
    return c.json(toOrderDto(row, review ? toReviewDto(review, user.username) : null));
  })
  .patch('/:id/status', requireAuth, validateJson(statusSchema), async (c) => {
    const user = c.get('user');
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) return c.json({ error: '订单不存在' }, 404);
    const [row] = await db.select().from(orders).where(eq(orders.id, id));
    if (!row) return c.json({ error: '订单不存在' }, 404);
    if (row.userId !== user.sub) return c.json({ error: '无权操作该订单' }, 403);

    const target = c.req.valid('json').status;
    if (row.status === 'pending' && target === 'delivering') {
      const [updated] = await db
        .update(orders)
        .set({ status: 'delivering', riderSnapshot: getRandomRider() })
        .where(eq(orders.id, id))
        .returning();
      return c.json(toOrderDto(updated!));
    }
    if (row.status === 'delivering' && target === 'completed') {
      const updated = await db.transaction(async (tx) => {
        const [u] = await tx
          .update(orders)
          .set({ status: 'completed', completedAt: new Date() })
          .where(eq(orders.id, id))
          .returning();
        await tx
          .update(restaurants)
          .set({ monthlyOrders: sql`${restaurants.monthlyOrders} + 1` })
          .where(eq(restaurants.id, row.restaurantId));
        return u;
      });
      return c.json(toOrderDto(updated!));
    }
    return c.json({ error: '订单状态不允许该变更' }, 400);
  });
