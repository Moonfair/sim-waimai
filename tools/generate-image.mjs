#!/usr/bin/env node
// Generates a single image via the Volcengine Ark "Seedream" text-to-image API and
// writes it to disk. One CLI invocation = one API call = one output file.
//
// Usage:
//   node tools/generate-image.mjs --kind banner|item --prompt "<text>" --out <path> [--model <id>] [--size WxH] [--dry-run]
//
// Env (read from process.env, auto-loaded from a .env file in the repo root if present):
//   ARK_API_KEY       required — Volcengine Ark console API key
//   ARK_IMAGE_MODEL   required — the Seedream model/endpoint id enabled on the account
//
// Exit codes:
//   0  success (or --dry-run)
//   1  fatal error: missing config, bad request, auth failure — do not retry the batch
//   2  this single image failed (e.g. content policy) — safe to skip and continue the batch
//   3  network/timeout error — retryable

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ARK_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';

const SIZE_PRESETS = {
  banner: '1600x640', // ~2.5:1, matches the app's restaurant banner aspect (h-36 card / h-48 detail page)
  item: '1024x1024',  // 1:1 square menu-item thumbnail
};

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');

function loadEnvFile() {
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--kind': args.kind = argv[++i]; break;
      case '--prompt': args.prompt = argv[++i]; break;
      case '--out': args.out = argv[++i]; break;
      case '--model': args.model = argv[++i]; break;
      case '--size': args.size = argv[++i]; break;
      case '--dry-run': args.dryRun = true; break;
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(1);
    }
  }
  return args;
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

async function main() {
  loadEnvFile();
  const args = parseArgs(process.argv.slice(2));

  if (!args.prompt) fail('Missing required --prompt');
  if (!args.out) fail('Missing required --out');
  if (!args.size && !args.kind) fail('Provide either --kind banner|item or --size WxH');
  if (args.kind && !(args.kind in SIZE_PRESETS)) {
    fail(`Unknown --kind "${args.kind}", expected one of: ${Object.keys(SIZE_PRESETS).join(', ')}`);
  }

  const size = args.size ?? SIZE_PRESETS[args.kind];
  const model = args.model ?? process.env.ARK_IMAGE_MODEL;
  const apiKey = process.env.ARK_API_KEY;

  const body = {
    model,
    prompt: args.prompt,
    size,
    response_format: 'b64_json',
    watermark: false,
  };

  if (args.dryRun) {
    console.log(JSON.stringify({ endpoint: ARK_ENDPOINT, out: args.out, body }, null, 2));
    process.exit(0);
  }

  if (!apiKey) fail('Missing ARK_API_KEY (set it in .env or the environment — see .env.example)');
  if (!model) fail('Missing ARK_IMAGE_MODEL (set it in .env or the environment, or pass --model)');

  let response;
  try {
    response = await fetch(ARK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    fail(`Network error calling Volcengine Ark: ${err.message}`, 3);
    return;
  }

  let json;
  try {
    json = await response.json();
  } catch (err) {
    fail(`Failed to parse Volcengine Ark response as JSON: ${err.message}`, 3);
    return;
  }

  if (!response.ok || json.error) {
    fail(`Volcengine Ark request failed: ${json.error?.code ?? response.status} ${json.error?.message ?? response.statusText}`, 1);
    return;
  }

  const entry = json.data?.[0];
  if (!entry) {
    fail('Volcengine Ark response contained no image data', 1);
    return;
  }

  if (entry.error) {
    console.error(`Image generation failed for this prompt: ${entry.error.code} ${entry.error.message}`);
    console.error(`Prompt was: ${args.prompt}`);
    process.exit(2);
  }

  if (!entry.b64_json) {
    fail('Volcengine Ark response did not include b64_json data (check response_format)', 1);
    return;
  }

  const buffer = Buffer.from(entry.b64_json, 'base64');
  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buffer);

  console.log(`Wrote ${outPath} (${entry.size ?? size})`);
}

main();
