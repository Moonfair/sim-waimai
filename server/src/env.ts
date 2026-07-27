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
  /** 腾讯云内容安全（天御 TMS/IMS）凭证：留空则新发布内容全部进入人工审核队列。
   *  可与 COS 用同一对密钥（需 CAM 授权 TMS/IMS），但必须显式填写，不做静默回落。 */
  TENCENT_MODERATION_SECRET_ID: z.string().optional(),
  TENCENT_MODERATION_SECRET_KEY: z.string().optional(),
  TENCENT_MODERATION_REGION: z.string().default('ap-guangzhou'),
  /** 天御控制台的自定义审核策略/词库（可选）。 */
  TENCENT_TMS_BIZTYPE: z.string().optional(),
  TENCENT_IMS_BIZTYPE: z.string().optional(),
  /** 审核积压邮件提醒：SMTP_HOST 留空则功能整体禁用（不报错）。 */
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  /** 收件邮箱，逗号分隔支持多个。 */
  MODERATION_ALERT_EMAIL: z.string().optional(),
  MODERATION_ALERT_COUNT_THRESHOLD: z.coerce.number().default(10),
  MODERATION_ALERT_AGE_MINUTES: z.coerce.number().default(120),
  MODERATION_ALERT_CHECK_INTERVAL_MINUTES: z.coerce.number().default(15),
  MODERATION_ALERT_COOLDOWN_MINUTES: z.coerce.number().default(120),
  /** 可选：邮件里拼审核页链接用，不填就不放链接。 */
  APP_PUBLIC_URL: z.string().optional(),
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
  // 天御凭证是运行期从 process.env 读的（lib/moderationProvider.ts），且注册路径会同步送审
  // 用户名——不清掉的话，带真实 .env 的开发机跑任何注册用户的测试都会触网计费。
  delete process.env.TENCENT_MODERATION_SECRET_ID;
  delete process.env.TENCENT_MODERATION_SECRET_KEY;
  // 同理：测试环境不应该因为开发机 .env 里配了真实 SMTP 就悄悄发出真实邮件。
  env.SMTP_HOST = undefined;
  env.SMTP_USER = undefined;
  env.SMTP_PASSWORD = undefined;
}

if (env.NODE_ENV === 'production' && env.JWT_SECRET === 'dev-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
