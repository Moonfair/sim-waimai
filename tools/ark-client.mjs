// Shared client for the Volcengine Ark "Seedream" text-to-image API.
// Used by both generate-image.mjs (single-shot CLI) and backfill-images.mjs (batch runner).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ARK_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';

// Tuned for doubao-seedream-4.0, whose explicit-WxH mode requires total pixels in
// [1280x720=921600, 4096x4096=16777216] with aspect ratio in [1/16, 16]. Both values
// below are official "recommended" 1K presets for that model. Re-check this table if
// the configured model changes.
export const SIZE_PRESETS = {
  banner: '1280x720', // 16:9 @1K — closest valid preset to the app's ~2.5:1 banner box
  item: '1024x1024',  // 1:1 @1K
};

export const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');

export function loadEnvFile() {
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

/**
 * Calls the Ark image generation endpoint for a single prompt and, on success, writes
 * the decoded image to `outPath` (creating parent directories as needed).
 *
 * Returns a structured result object rather than throwing/exiting, so callers (CLI or batch
 * runner) decide how to react:
 *   { status: 'ok', outPath, size }
 *   { status: 'item-failed', message }     — this single prompt failed (e.g. content policy), safe to skip
 *   { status: 'fatal', message }           — config/auth/request error, do not retry the batch
 *   { status: 'network-error', message }   — retryable
 */
export async function generateImage({ prompt, size, model, apiKey, outPath }) {
  const body = {
    model,
    prompt,
    size,
    response_format: 'b64_json',
    watermark: false,
  };

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
    return { status: 'network-error', message: `Network error calling Volcengine Ark: ${err.message}` };
  }

  let json;
  try {
    json = await response.json();
  } catch (err) {
    return { status: 'network-error', message: `Failed to parse Volcengine Ark response as JSON: ${err.message}` };
  }

  if (!response.ok || json.error) {
    return {
      status: 'fatal',
      message: `Volcengine Ark request failed: ${json.error?.code ?? response.status} ${json.error?.message ?? response.statusText}`,
    };
  }

  const entry = json.data?.[0];
  if (!entry) {
    return { status: 'fatal', message: 'Volcengine Ark response contained no image data' };
  }

  if (entry.error) {
    return { status: 'item-failed', message: `${entry.error.code} ${entry.error.message}` };
  }

  if (!entry.b64_json) {
    return { status: 'fatal', message: 'Volcengine Ark response did not include b64_json data (check response_format)' };
  }

  const buffer = Buffer.from(entry.b64_json, 'base64');
  const resolvedOut = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  fs.writeFileSync(resolvedOut, buffer);

  return { status: 'ok', outPath: resolvedOut, size: entry.size ?? size };
}
