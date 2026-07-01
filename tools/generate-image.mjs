#!/usr/bin/env node
// Generates a single image via the Volcengine Ark "Seedream" text-to-image API and
// writes it to disk. One CLI invocation = one API call = one output file.
//
// Usage:
//   node tools/generate-image.mjs --kind banner|item --prompt "<text>" --out <path> [--model <id>] [--size WxH] [--dry-run]
//
// For generating a whole restaurant's images in one go, use tools/backfill-images.mjs
// instead — this script is for single-image manual/debug use.
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

import { ARK_ENDPOINT, SIZE_PRESETS, loadEnvFile, generateImage } from './ark-client.mjs';

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

  if (args.dryRun) {
    const body = { model, prompt: args.prompt, size, response_format: 'b64_json', watermark: false };
    console.log(JSON.stringify({ endpoint: ARK_ENDPOINT, out: args.out, body }, null, 2));
    process.exit(0);
  }

  if (!apiKey) fail('Missing ARK_API_KEY (set it in .env or the environment — see .env.example)');
  if (!model) fail('Missing ARK_IMAGE_MODEL (set it in .env or the environment, or pass --model)');

  const result = await generateImage({ prompt: args.prompt, size, model, apiKey, outPath: args.out });

  if (result.status === 'ok') {
    console.log(`Wrote ${result.outPath} (${result.size})`);
    process.exit(0);
  } else if (result.status === 'item-failed') {
    console.error(`Image generation failed for this prompt: ${result.message}`);
    console.error(`Prompt was: ${args.prompt}`);
    process.exit(2);
  } else if (result.status === 'network-error') {
    fail(result.message, 3);
  } else {
    fail(result.message, 1);
  }
}

main();
