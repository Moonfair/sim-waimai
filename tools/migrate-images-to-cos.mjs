#!/usr/bin/env node
// One-off bulk migration: uploads every existing file under public/restaurants/** to the
// Tencent COS bucket, using the file's path relative to public/ as the COS key — which is
// exactly the value already stored in `image`/`bannerImage` fields in src/data/restaurants/*.json,
// so no JSON changes are needed.
//
// Usage:
//   node tools/migrate-images-to-cos.mjs [--dry-run]
//
// Requires COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION in .env (see .env.example).
// Safe to re-run: re-uploads (overwrites) every file, so an interrupted run can just be repeated.
//
// After a successful (non-dry-run) run, verify a few URLs are publicly reachable, then delete
// public/restaurants/ from the repo — it's no longer needed once the frontend reads from COS.

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, loadEnvFile } from './ark-client.mjs';
import { isCosConfigured, publicUrlFor, uploadObject } from './cos-client.mjs';

function walk(dir, baseDir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, baseDir, out);
    } else if (entry.isFile()) {
      out.push(path.relative(baseDir, full).split(path.sep).join('/'));
    }
  }
  return out;
}

async function main() {
  loadEnvFile();
  const dryRun = process.argv.includes('--dry-run');

  if (!dryRun && !isCosConfigured()) {
    console.error('Missing COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET/COS_REGION (set them in .env — see .env.example)');
    process.exit(1);
  }

  const publicDir = path.join(repoRoot, 'public');
  const restaurantsDir = path.join(publicDir, 'restaurants');
  if (!fs.existsSync(restaurantsDir)) {
    console.error(`No such directory: ${restaurantsDir}`);
    process.exit(1);
  }

  const keys = walk(restaurantsDir, publicDir).sort();
  console.log(`Found ${keys.length} files under public/restaurants/`);

  if (dryRun) {
    for (const key of keys) console.log(`[dry-run] would upload ${key} -> ${isCosConfigured() ? publicUrlFor(key) : '(COS not configured, URL unavailable)'}`);
    console.log(`\n[dry-run] ${keys.length} files, nothing uploaded.`);
    return;
  }

  let done = 0;
  let failed = 0;
  for (const key of keys) {
    const buffer = fs.readFileSync(path.join(publicDir, key));
    try {
      await uploadObject(key, buffer);
      done++;
      console.log(`[${done + failed}/${keys.length}] uploaded ${key}`);
    } catch (err) {
      failed++;
      console.error(`[${done + failed}/${keys.length}] FAILED ${key}: ${err.message}`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Uploaded: ${done}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    console.log('Re-run the same command to retry — uploads are overwrite-safe.');
    process.exit(1);
  }
  console.log(`\nSpot-check a URL, then remove public/restaurants/ from the repo:`);
  console.log(`  ${publicUrlFor(keys[0])}`);
}

main();
