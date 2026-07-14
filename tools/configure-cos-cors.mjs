#!/usr/bin/env node
// One-time (idempotent) setup: writes a CORS rule onto the COS bucket so browsers can PUT
// directly to presigned upload URLs (server/src/routes/uploads.ts, src/lib/upload.ts).
// Without this, the browser's preflight OPTIONS request gets no Access-Control-Allow-Origin
// header and the upload fails client-side before it ever reaches COS.
//
// Usage:
//   node tools/configure-cos-cors.mjs
//
// Requires COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION in .env (see .env.example).
// Safe to re-run: putBucketCors replaces the bucket's CORS config wholesale.

import { loadEnvFile } from './ark-client.mjs';
import { isCosConfigured } from './cos-client.mjs';
import COS from 'cos-nodejs-sdk-v5';

loadEnvFile();

if (!isCosConfigured()) {
  console.error('COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET/COS_REGION must all be set in .env');
  process.exit(1);
}

const cos = new COS({
  SecretId: process.env.COS_SECRET_ID,
  SecretKey: process.env.COS_SECRET_KEY,
});

cos.putBucketCors(
  {
    Bucket: process.env.COS_BUCKET,
    Region: process.env.COS_REGION,
    CORSRules: [
      {
        AllowedOrigin: ['*'],
        AllowedMethod: ['GET', 'PUT', 'POST', 'HEAD'],
        AllowedHeader: ['*'],
        ExposeHeader: ['ETag'],
        MaxAgeSeconds: '600',
      },
    ],
  },
  (err) => {
    if (err) {
      console.error('Failed to set bucket CORS:', err);
      process.exit(1);
    }
    console.log(`CORS configured on bucket ${process.env.COS_BUCKET} (${process.env.COS_REGION}).`);
  },
);
