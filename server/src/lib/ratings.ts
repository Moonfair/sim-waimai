import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { restaurants } from '../db/schema';

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 店铺评分聚合只统计 approved 评价：评价审核通过时 +delta，通过后被推翻时 -delta。
 * rating = rating_sum / rating_count（保留 1 位小数）；count 归零时回落建店默认 5 分。
 */
export async function applyRatingDelta(
  tx: DbOrTx,
  restaurantId: string,
  deltaSum: number,
  deltaCount: number,
): Promise<void> {
  await tx
    .update(restaurants)
    .set({
      ratingSum: sql`${restaurants.ratingSum} + ${deltaSum}`,
      ratingCount: sql`${restaurants.ratingCount} + ${deltaCount}`,
      rating: sql`COALESCE(ROUND((${restaurants.ratingSum} + ${deltaSum})::numeric / NULLIF(${restaurants.ratingCount} + ${deltaCount}, 0), 1), 5)`,
    })
    .where(eq(restaurants.id, restaurantId));
}
