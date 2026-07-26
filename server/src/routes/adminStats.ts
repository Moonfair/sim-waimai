import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { SiteStatsDto, SiteStatsTopRestaurantDto } from '@sim-waimai/shared';
import { fenToYuan } from '@sim-waimai/shared';
import { db } from '../db/client';
import { orders, restaurants, users } from '../db/schema';
import { requireAdmin } from '../middleware/auth';

/** "今天"和趋势窗口的边界全部由 Postgres 的 now() 计算，不在 Node 端算，
 *  避免应用时钟和数据库时钟不一致（仓库里没有任何时区/日期工具）。 */

interface RestaurantAggRow {
  id: string;
  name: string;
  emoji: string;
  bgColor: string;
  category: string;
  orderCount: number;
  gmvFen: number;
}

function toTopRestaurantDto(row: RestaurantAggRow): SiteStatsTopRestaurantDto {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    bgColor: row.bgColor,
    category: row.category,
    orderCount: row.orderCount,
    gmv: fenToYuan(row.gmvFen),
  };
}

export const adminStatsRoutes = new Hono().get('/stats', requireAdmin, async (c) => {
  const [orderStats, userStats, merchantTotals, categoryRows, restaurantAgg, trendResult] = await Promise.all([
    db
      .select({
        totalOrders: sql<number>`count(*)::int`,
        gmvFen: sql<number>`COALESCE(sum(${orders.totalFen}), 0)::int`,
        completedOrders: sql<number>`count(*) FILTER (WHERE ${orders.status} = 'completed')::int`,
        todayOrders: sql<number>`count(*) FILTER (WHERE ${orders.createdAt} >= date_trunc('day', now()))::int`,
        todayGmvFen: sql<number>`COALESCE(sum(${orders.totalFen}) FILTER (WHERE ${orders.createdAt} >= date_trunc('day', now())), 0)::int`,
      })
      .from(orders)
      .then((rows) => rows[0]),
    db
      .select({
        totalUsers: sql<number>`count(*)::int`,
        todayNewUsers: sql<number>`count(*) FILTER (WHERE ${users.createdAt} >= date_trunc('day', now()))::int`,
      })
      .from(users)
      .then((rows) => rows[0]),
    db
      .select({
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) FILTER (WHERE ${restaurants.reviewStatus} = 'pending')::int`,
        approved: sql<number>`count(*) FILTER (WHERE ${restaurants.reviewStatus} = 'approved')::int`,
        rejected: sql<number>`count(*) FILTER (WHERE ${restaurants.reviewStatus} = 'rejected')::int`,
        // 与 admin.ts 的 reviewerCondition() 语义一致：AI 桶 = reviewedBy = 'ai'；人工桶 = 空或非 'ai'。
        aiReviewed: sql<number>`count(*) FILTER (WHERE ${restaurants.reviewedBy} = 'ai')::int`,
        humanReviewed: sql<number>`count(*) FILTER (WHERE ${restaurants.reviewedBy} IS NULL OR ${restaurants.reviewedBy} <> 'ai')::int`,
      })
      .from(restaurants)
      .then((rows) => rows[0]),
    db
      .select({ category: restaurants.category, count: sql<number>`count(*)::int` })
      .from(restaurants)
      .groupBy(restaurants.category)
      .orderBy(sql`count(*) DESC`),
    db
      .select({
        id: restaurants.id,
        name: restaurants.name,
        emoji: restaurants.emoji,
        bgColor: restaurants.bgColor,
        category: restaurants.category,
        orderCount: sql<number>`count(${orders.id})::int`,
        gmvFen: sql<number>`COALESCE(sum(${orders.totalFen}), 0)::int`,
      })
      .from(restaurants)
      .leftJoin(orders, sql`${orders.restaurantId} = ${restaurants.id}`)
      .groupBy(restaurants.id, restaurants.name, restaurants.emoji, restaurants.bgColor, restaurants.category),
    db.execute<{ day: string; order_count: number; gmv_fen: number; new_users: number }>(sql`
      WITH days AS (
        SELECT generate_series(
          date_trunc('day', now()) - interval '29 days',
          date_trunc('day', now()),
          interval '1 day'
        )::date AS day
      ),
      order_agg AS (
        SELECT date_trunc('day', created_at)::date AS day,
               count(*)::int AS order_count,
               COALESCE(sum(total_fen), 0)::int AS gmv_fen
        FROM orders
        WHERE created_at >= date_trunc('day', now()) - interval '29 days'
        GROUP BY 1
      ),
      user_agg AS (
        SELECT date_trunc('day', created_at)::date AS day,
               count(*)::int AS new_users
        FROM users
        WHERE created_at >= date_trunc('day', now()) - interval '29 days'
        GROUP BY 1
      )
      SELECT days.day::text AS day,
             COALESCE(order_agg.order_count, 0) AS order_count,
             COALESCE(order_agg.gmv_fen, 0) AS gmv_fen,
             COALESCE(user_agg.new_users, 0) AS new_users
      FROM days
      LEFT JOIN order_agg ON order_agg.day = days.day
      LEFT JOIN user_agg ON user_agg.day = days.day
      ORDER BY days.day ASC
    `),
  ]);

  const totalOrders = orderStats?.totalOrders ?? 0;
  const gmvFen = orderStats?.gmvFen ?? 0;
  const completedOrders = orderStats?.completedOrders ?? 0;

  const restaurantAggRows = restaurantAgg as RestaurantAggRow[];
  const topByOrders = [...restaurantAggRows].sort((a, b) => b.orderCount - a.orderCount).slice(0, 10);
  const topByGmv = [...restaurantAggRows].sort((a, b) => b.gmvFen - a.gmvFen).slice(0, 10);

  const stats: SiteStatsDto = {
    overview: {
      totalUsers: userStats?.totalUsers ?? 0,
      totalOrders,
      gmv: fenToYuan(gmvFen),
      aov: totalOrders > 0 ? fenToYuan(gmvFen) / totalOrders : 0,
      completionRate: totalOrders > 0 ? completedOrders / totalOrders : 0,
    },
    today: {
      newUsers: userStats?.todayNewUsers ?? 0,
      newOrders: orderStats?.todayOrders ?? 0,
      gmv: fenToYuan(orderStats?.todayGmvFen ?? 0),
    },
    trend: trendResult.rows.map((r) => ({
      date: r.day,
      orders: r.order_count,
      gmv: fenToYuan(r.gmv_fen),
      newUsers: r.new_users,
    })),
    merchants: {
      total: merchantTotals?.total ?? 0,
      byReviewStatus: {
        pending: merchantTotals?.pending ?? 0,
        approved: merchantTotals?.approved ?? 0,
        rejected: merchantTotals?.rejected ?? 0,
      },
      reviewerSplit: {
        ai: merchantTotals?.aiReviewed ?? 0,
        human: merchantTotals?.humanReviewed ?? 0,
      },
      byCategory: categoryRows,
      topByOrders: topByOrders.map(toTopRestaurantDto),
      topByGmv: topByGmv.map(toTopRestaurantDto),
    },
  };
  return c.json(stats);
});
