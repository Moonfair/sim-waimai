// Shared Tencent Cloud COS client for the image tooling (migrate-images-to-cos.mjs,
// upload-to-cos.mjs, backfill-images.mjs). Mirrors the conventions used by the backend's
// server/src/lib/cos.ts so the two can converge if/when that branch merges.

import COS from 'cos-nodejs-sdk-v5';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} (set it in .env — see .env.example)`);
  return value;
}

export function isCosConfigured() {
  return Boolean(
    process.env.COS_SECRET_ID &&
      process.env.COS_SECRET_KEY &&
      process.env.COS_BUCKET &&
      process.env.COS_REGION,
  );
}

let client = null;

function cosClient() {
  if (!client) {
    client = new COS({
      SecretId: requireEnv('COS_SECRET_ID'),
      SecretKey: requireEnv('COS_SECRET_KEY'),
    });
  }
  return client;
}

export function publicUrlFor(key) {
  const base =
    process.env.COS_PUBLIC_BASE_URL ||
    `https://${requireEnv('COS_BUCKET')}.cos.${requireEnv('COS_REGION')}.myqcloud.com`;
  return `${base.replace(/\/$/, '')}/${key}`;
}

const CONTENT_TYPE_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function contentTypeForKey(key) {
  const ext = key.split('.').pop()?.toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';
}

/** Uploads a buffer to `key`, public-cacheable (long max-age — keys are content-addressed
 *  by restaurant/item id, not by content hash, so bust the cache by changing the key if a
 *  regenerated image needs to replace one already served). */
export function uploadObject(key, buffer, contentType = contentTypeForKey(key)) {
  return new Promise((resolve, reject) => {
    cosClient().putObject(
      {
        Bucket: requireEnv('COS_BUCKET'),
        Region: requireEnv('COS_REGION'),
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      },
      (err, data) => (err ? reject(err) : resolve(data)),
    );
  });
}
