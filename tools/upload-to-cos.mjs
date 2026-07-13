#!/usr/bin/env node
// Uploads a single local file to Tencent COS. Pairs with tools/generate-image.mjs for the
// manual single-image retry path (generate to a local file, then push it to COS) — the
// batch path (tools/backfill-images.mjs) uploads directly and never touches disk.
//
// Usage:
//   node tools/upload-to-cos.mjs --file <localPath> --key <cosKey>
//
// Requires COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION in .env (see .env.example).
// Prints the object's public URL on success; exit code 0 = uploaded, 1 = error.

import fs from 'node:fs';
import { loadEnvFile } from './ark-client.mjs';
import { isCosConfigured, publicUrlFor, uploadObject } from './cos-client.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--file': args.file = argv[++i]; break;
      case '--key': args.key = argv[++i]; break;
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(1);
    }
  }
  return args;
}

async function main() {
  loadEnvFile();
  const args = parseArgs(process.argv.slice(2));

  if (!args.file) { console.error('Missing required --file'); process.exit(1); }
  if (!args.key) { console.error('Missing required --key (e.g. restaurants/<id>/banner.jpg)'); process.exit(1); }
  if (!fs.existsSync(args.file)) { console.error(`No such file: ${args.file}`); process.exit(1); }
  if (!isCosConfigured()) {
    console.error('Missing COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET/COS_REGION (set them in .env — see .env.example)');
    process.exit(1);
  }

  const buffer = fs.readFileSync(args.file);
  await uploadObject(args.key, buffer);
  console.log(`Uploaded ${args.file} -> ${args.key}`);
  console.log(publicUrlFor(args.key));
}

main();
