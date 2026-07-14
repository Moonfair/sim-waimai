import COS from 'cos-nodejs-sdk-v5';
import { env } from '../env';

export function isCosConfigured(): boolean {
  return Boolean(env.COS_SECRET_ID && env.COS_SECRET_KEY && env.COS_BUCKET && env.COS_REGION);
}

let client: COS | null = null;

function cosClient(): COS {
  if (!client) {
    client = new COS({ SecretId: env.COS_SECRET_ID!, SecretKey: env.COS_SECRET_KEY! });
  }
  return client;
}

/** Origin that serves uploaded objects publicly, or null when COS isn't set up. */
export function cosPublicBase(): string | null {
  if (env.COS_PUBLIC_BASE_URL) return env.COS_PUBLIC_BASE_URL.replace(/\/$/, '');
  if (isCosConfigured()) return `https://${env.COS_BUCKET}.cos.${env.COS_REGION}.myqcloud.com`;
  return null;
}

export function publicUrlFor(key: string): string {
  const base = cosPublicBase() ?? `https://${env.COS_BUCKET}.cos.${env.COS_REGION}.myqcloud.com`;
  return `${base}/${key}`;
}

/** Uploads bytes to COS from the server (client never talks to COS directly, so the server
 *  can validate/re-encode the file first — see routes/uploads.ts). */
export function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    cosClient().putObject(
      { Bucket: env.COS_BUCKET!, Region: env.COS_REGION!, Key: key, Body: body, ContentType: contentType },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}
