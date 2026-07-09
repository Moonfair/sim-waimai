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

export function publicUrlFor(key: string): string {
  const base =
    env.COS_PUBLIC_BASE_URL || `https://${env.COS_BUCKET}.cos.${env.COS_REGION}.myqcloud.com`;
  return `${base.replace(/\/$/, '')}/${key}`;
}

/** Presigned PUT URL so the client uploads straight to COS (expires in 300s). */
export function presignPut(key: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cosClient().getObjectUrl(
      {
        Bucket: env.COS_BUCKET!,
        Region: env.COS_REGION!,
        Key: key,
        Method: 'PUT',
        Sign: true,
        Expires: 300,
      },
      (err, data) => (err ? reject(err) : resolve(data.Url)),
    );
  });
}
