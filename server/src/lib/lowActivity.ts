import { getTableName, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { menuItems, restaurants } from '../db/schema';

export const LOW_ACTIVITY_MAX_PRODUCTS = 10;

// Drizzle's single-table `.select()` unqualifies every plain Column reference inside a raw SQL
// field (see PgDialect#buildSelection's `isSingleTable` branch) — including ones nested in a
// correlated subquery, which silently breaks the correlation when the inner and outer tables
// share a column name (both restaurants and menu_items have `id`/`review_status`). Building the
// qualified name by hand with sql.identifier sidesteps that rewrite.
function qualified(column: PgColumn): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}

/**
 * True when a shop lists at most LOW_ACTIVITY_MAX_PRODUCTS customer-visible products.
 * Correlates against whichever `restaurants` row is in scope in the enclosing query via a
 * subquery, so it needs no join/groupBy of its own and can be dropped into a `.select()`,
 * `.where()`, or `.orderBy()` on any restaurants query.
 */
export function lowActivityCondition(): SQL<boolean> {
  const rId = qualified(restaurants.id);
  const mRestaurantId = qualified(menuItems.restaurantId);
  const mIsListed = qualified(menuItems.isListed);
  const mReviewStatus = qualified(menuItems.reviewStatus);

  return sql<boolean>`(
    select count(*) from ${menuItems}
    where ${mRestaurantId} = ${rId}
      and ${mIsListed} = true
      and ${mReviewStatus} = 'approved'
  ) <= ${LOW_ACTIVITY_MAX_PRODUCTS}`;
}
