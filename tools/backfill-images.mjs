#!/usr/bin/env node
// Batch-generates all missing images (banner + menu items) for one restaurant, uploading
// each result straight to Tencent COS and writing the object key back into its JSON file
// incrementally so the run is resumable — items that already have `image`/`bannerImage`
// set are skipped, so re-running only fills gaps.
//
// Usage:
//   node tools/backfill-images.mjs <restaurantId> [--limit N] [--banner-only] [--items-only]
//
// Requires seriesStyle/bannerImagePrompt/imagePrompt fields to already be written into
// the restaurant's JSON (this script only calls the image API, it does not author prompts).
// Also requires COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET/COS_REGION in .env (see .env.example).
//
// Exit codes:
//   0  finished (some images may have been skipped as item-failed, see summary)
//   1  fatal error (missing config/prompts, auth failure, bad request) — stopped early
//   3  network/timeout error — stopped early, retryable

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot, SIZE_PRESETS, loadEnvFile, generateImage } from './ark-client.mjs';
import { isCosConfigured, uploadObject } from './cos-client.mjs';

function parseArgs(argv) {
  const args = { limit: Infinity, bannerOnly: false, itemsOnly: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--limit': args.limit = Number(argv[++i]); break;
      case '--banner-only': args.bannerOnly = true; break;
      case '--items-only': args.itemsOnly = true; break;
      default: positional.push(a);
    }
  }
  args.restaurantId = positional[0];
  return args;
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function saveRestaurant(jsonPath, restaurant) {
  fs.writeFileSync(jsonPath, JSON.stringify(restaurant, null, 2) + '\n', 'utf8');
}

/** Generates one image to a scratch temp file, uploads it to COS at `key`, then deletes
 *  the temp file. Returns the same result shape as generateImage(). */
async function generateAndUpload({ prompt, size, model, apiKey, key }) {
  const tmpPath = path.join(os.tmpdir(), `sim-waimai-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  const result = await generateImage({ prompt, size, model, apiKey, outPath: tmpPath });
  if (result.status === 'ok') {
    const buffer = fs.readFileSync(tmpPath);
    fs.unlinkSync(tmpPath);
    await uploadObject(key, buffer);
  }
  return result;
}

async function main() {
  loadEnvFile();
  const args = parseArgs(process.argv.slice(2));

  if (!args.restaurantId) fail('Usage: node tools/backfill-images.mjs <restaurantId> [--limit N] [--banner-only] [--items-only]');
  if (args.bannerOnly && args.itemsOnly) fail('--banner-only and --items-only are mutually exclusive');

  const apiKey = process.env.ARK_API_KEY;
  const model = process.env.ARK_IMAGE_MODEL;
  if (!apiKey) fail('Missing ARK_API_KEY (set it in .env — see .env.example)');
  if (!model) fail('Missing ARK_IMAGE_MODEL (set it in .env — see .env.example)');
  if (!isCosConfigured()) fail('Missing COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET/COS_REGION (set them in .env — see .env.example)');

  const jsonPath = path.join(repoRoot, 'src/data/restaurants', `${args.restaurantId}.json`);
  if (!fs.existsSync(jsonPath)) fail(`No such restaurant JSON: ${jsonPath}`);

  const restaurant = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  const summary = { generated: 0, skippedExisting: 0, itemFailed: [] };
  let remainingBudget = args.limit;

  // Banner
  if (!args.itemsOnly) {
    if (restaurant.bannerImage) {
      summary.skippedExisting++;
      console.log(`[banner] skip (already has bannerImage)`);
    } else if (!restaurant.bannerImagePrompt) {
      console.warn(`[banner] skip — no bannerImagePrompt set yet, author it before running this script`);
    } else if (remainingBudget > 0) {
      const key = `restaurants/${restaurant.id}/banner.jpg`;
      console.log(`[banner] generating...`);
      const result = await generateAndUpload({
        prompt: restaurant.bannerImagePrompt,
        size: SIZE_PRESETS.banner,
        model,
        apiKey,
        key,
      });
      if (result.status === 'ok') {
        restaurant.bannerImage = key;
        saveRestaurant(jsonPath, restaurant);
        summary.generated++;
        remainingBudget--;
        console.log(`[banner] done -> ${restaurant.bannerImage}`);
      } else if (result.status === 'item-failed') {
        summary.itemFailed.push({ name: `${restaurant.name} (banner)`, message: result.message });
        console.warn(`[banner] failed, continuing: ${result.message}`);
      } else {
        fail(`[banner] fatal: ${result.message}`, result.status === 'network-error' ? 3 : 1);
      }
    }
  }

  // Menu items
  if (!args.bannerOnly) {
    for (const item of restaurant.menu) {
      if (remainingBudget <= 0) {
        console.log(`Reached --limit, stopping (remaining items left for next run).`);
        break;
      }
      if (item.image) {
        summary.skippedExisting++;
        continue;
      }
      if (!item.imagePrompt) {
        console.warn(`[item ${item.id}] skip — no imagePrompt set yet, author it before running this script`);
        continue;
      }

      const key = `restaurants/${restaurant.id}/items/${item.id}.jpg`;
      console.log(`[item ${item.id}] generating "${item.name}"...`);
      const result = await generateAndUpload({
        prompt: item.imagePrompt,
        size: SIZE_PRESETS.item,
        model,
        apiKey,
        key,
      });

      if (result.status === 'ok') {
        item.image = key;
        saveRestaurant(jsonPath, restaurant);
        summary.generated++;
        remainingBudget--;
        console.log(`[item ${item.id}] done -> ${item.image}`);
      } else if (result.status === 'item-failed') {
        summary.itemFailed.push({ name: `${restaurant.name} / ${item.name}`, message: result.message });
        console.warn(`[item ${item.id}] failed, continuing: ${result.message}`);
      } else {
        fail(`[item ${item.id}] fatal: ${result.message}`, result.status === 'network-error' ? 3 : 1);
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Generated: ${summary.generated}`);
  console.log(`Skipped (already had image): ${summary.skippedExisting}`);
  console.log(`Failed: ${summary.itemFailed.length}`);
  for (const f of summary.itemFailed) console.log(`  - ${f.name}: ${f.message}`);
}

main();
