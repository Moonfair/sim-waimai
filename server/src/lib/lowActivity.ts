import { getTableName, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { menuItems, restaurants } from '../db/schema';

export const LOW_ACTIVITY_DAYS = 3;
export const LOW_ACTIVITY_MAX_PRODUCTS = 10;

// Drizzle's single-table `.select()` unqualifies every plain Column reference inside a raw SQL
// field (see PgDialect#buildSelection's `isSingleTable` branch) — including ones nested in a
// correlated subquery, which silently breaks the correlation when the inner and outer tables
// share a column name (both restaurants and menu_items have `id`/`updated_at`). Building the
// qualified name by hand with sql.identifier sidesteps that rewrite.
function qualified(column: PgColumn): SQL {
  return sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}

/**
 * True when a shop hasn't touched its info or menu in LOW_ACTIVITY_DAYS days, OR lists at most
 * LOW_ACTIVITY_MAX_PRODUCTS customer-visible products — either alone is enough to flag it.
 * Correlates against whichever `restaurants` row is in scope in the enclosing query via
 * subqueries, so it needs no join/groupBy of its own and can be dropped into a `.select()`,
 * `.where()`, or `.orderBy()` on any restaurants query.
 */
export function lowActivityCondition(): SQL<boolean> {
  const rId = qualified(restaurants.id);
  const rUpdatedAt = qualified(restaurants.updatedAt);
  const mRestaurantId = qualified(menuItems.restaurantId);
  const mUpdatedAt = qualified(menuItems.updatedAt);
  const mIsListed = qualified(menuItems.isListed);
  const mReviewStatus = qualified(menuItems.reviewStatus);

  return sql<boolean>`(
    greatest(
      ${rUpdatedAt},
      coalesce(
        (select max(${mUpdatedAt}) from ${menuItems} where ${mRestaurantId} = ${rId}),
        ${rUpdatedAt}
      )
    ) < now() - interval '1 day' * ${LOW_ACTIVITY_DAYS}
    or (
      select count(*) from ${menuItems}
      where ${mRestaurantId} = ${rId}
        and ${mIsListed} = true
        and ${mReviewStatus} = 'approved'
    ) <= ${LOW_ACTIVITY_MAX_PRODUCTS}
  )`;
}
