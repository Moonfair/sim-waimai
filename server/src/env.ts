import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { z } from 'zod';

/** Repo root (server/src/env.ts → ../../..). The .env file lives at the root. */
export const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

config({ path: path.join(rootPath, '.env'), quiet: true });

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/sim_waimai'),
  JWT_SECRET: z.string().default('dev-secret-change-me'),
  COS_SECRET_ID: z.string().optional(),
  COS_SECRET_KEY: z.string().optional(),
  COS_BUCKET: z.string().optional(),
  COS_REGION: z.string().optional(),
  COS_PUBLIC_BASE_URL: z.string().optional(),
  /** 留空则新发布内容全部进入人工审核队列。 */
  ANTHROPIC_API_KEY: z.string().optional(),
  MODERATION_MODEL: z.string().default('claude-haiku-4-5-20251001'),
});

export const env = envSchema.parse(process.env);

// Uploads always proxy through this server now (never a direct-to-COS presigned PUT from the
// browser), so a developer's real COS credentials in .env would otherwise make the test suite
// write to the production bucket. Force the local-disk fallback under test regardless of .env.
if (env.NODE_ENV === 'test') {
  env.COS_SECRET_ID = undefined;
  env.COS_SECRET_KEY = undefined;
  env.COS_BUCKET = undefined;
  env.COS_REGION = undefined;
  env.COS_PUBLIC_BASE_URL = undefined;
}

if (env.NODE_ENV === 'production' && env.JWT_SECRET === 'dev-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
