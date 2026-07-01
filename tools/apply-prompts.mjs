#!/usr/bin/env node
// Merges authored prompt content (seriesStyle, banner scene, per-item real-characteristic
// descriptions) into a restaurant's JSON, composing full imagePrompt/bannerImagePrompt
// strings per references/visual-style-banner.md and references/visual-style-menu-item.md.
//
// Usage:
//   node tools/apply-prompts.mjs <restaurantId> <promptsJsonPath>
//
// promptsJsonPath shape:
//   { "seriesStyle": "...", "bannerScene": "...", "items": { "<itemId>": "<real characteristics>", ... } }

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './ark-client.mjs';

const GLOBAL_BANNER_STYLE = 'Professional food-delivery-app restaurant banner photograph, wide horizontal composition, warm inviting natural lighting, shallow depth of field, appetizing commercial food photography style, no visible text/logos/watermarks, no people/hands, subject centered with generous negative space margin around it (to survive a wider crop), consistent warm natural color grading.';

const GLOBAL_ITEM_STYLE = 'Top-down or 45-degree angle product photography of a single menu item, square 1:1 crop, plain neutral light-colored background, soft even studio lighting, consistent color grading and exposure, no text/watermark/logo, no hands/utensils holding food, item centered and fully visible, appetizing and true-to-life. Show ONLY this one item and its own container (one bowl, one plate, or one cup/glass) — absolutely no additional bowls, plates, side dishes, rice, or extra cups in frame. If this item is a beverage, the entire frame must contain nothing but that single cup or glass of the beverage.';

function main() {
  const [restaurantId, promptsPath] = process.argv.slice(2);
  if (!restaurantId || !promptsPath) {
    console.error('Usage: node tools/apply-prompts.mjs <restaurantId> <promptsJsonPath>');
    process.exit(1);
  }

  const jsonPath = path.join(repoRoot, 'src/data/restaurants', `${restaurantId}.json`);
  const restaurant = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const prompts = JSON.parse(fs.readFileSync(path.resolve(promptsPath), 'utf8'));

  restaurant.seriesStyle = prompts.seriesStyle;
  restaurant.bannerImagePrompt = `${GLOBAL_BANNER_STYLE} ${prompts.seriesStyle} ${prompts.bannerScene}`;

  let missing = [];
  for (const item of restaurant.menu) {
    const characteristics = prompts.items[item.id];
    if (!characteristics) {
      missing.push(item.id);
      continue;
    }
    item.imagePrompt = `${GLOBAL_ITEM_STYLE} ${prompts.seriesStyle} ${item.name}: ${characteristics}.`;
  }

  fs.writeFileSync(jsonPath, JSON.stringify(restaurant, null, 2) + '\n', 'utf8');

  console.log(`Applied prompts to ${jsonPath}`);
  console.log(`  seriesStyle + bannerImagePrompt set`);
  console.log(`  ${restaurant.menu.length - missing.length}/${restaurant.menu.length} item imagePrompts set`);
  if (missing.length) console.warn(`  Missing prompt content for items: ${missing.join(', ')}`);
}

main();
