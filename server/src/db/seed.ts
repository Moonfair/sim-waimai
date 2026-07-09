import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { yuanToFen, type Restaurant } from '@sim-waimai/shared';
import { rootPath } from '../env';
import { db, pool } from './client';
import { menuItems, restaurants } from './schema';

/** Idempotent: restaurants are upserted, each restaurant's menu is replaced wholesale. */
async function seed() {
  const dir = path.join(rootPath, 'src/data/restaurants');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  let itemCount = 0;
  for (const file of files) {
    const r = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Restaurant;
    const row = {
      sortOrder: r.order,
      name: r.name,
      category: r.category,
      rating: r.rating,
      ratingCount: r.ratingCount,
      ratingSum: Math.round(r.rating * r.ratingCount),
      monthlyOrders: r.monthlyOrders,
      deliveryFeeFen: yuanToFen(r.deliveryFee),
      minOrderFen: yuanToFen(r.minOrder),
      deliveryTime: r.deliveryTime,
      emoji: r.emoji,
      bgColor: r.bgColor,
      tags: r.tags,
      menuCategories: r.menuCategories,
      bannerImage: r.bannerImage ?? null,
    };
    await db
      .insert(restaurants)
      .values({ id: r.id, ...row })
      .onConflictDoUpdate({ target: restaurants.id, set: row });

    await db.delete(menuItems).where(eq(menuItems.restaurantId, r.id));
    await db.insert(menuItems).values(
      r.menu.map((m, i) => ({
        restaurantId: r.id,
        id: m.id,
        name: m.name,
        description: m.description,
        priceFen: yuanToFen(m.price),
        calories: m.calories,
        emoji: m.emoji,
        menuCategory: m.menuCategory,
        popular: m.popular ?? false,
        image: m.image ?? null,
        optionGroups: m.optionGroups ?? null,
        sortOrder: i,
      })),
    );
    itemCount += r.menu.length;
  }

  console.log(`Seeded ${files.length} restaurants, ${itemCount} menu items.`);
}

seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
