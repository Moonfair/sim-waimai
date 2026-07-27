import { serve } from '@hono/node-server';
import { createApp } from './app';
import { env } from './env';
import { checkModerationBacklog } from './lib/moderationAlert';

serve({ fetch: createApp().fetch, port: env.PORT }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});

if (env.SMTP_HOST) {
  const intervalMs = env.MODERATION_ALERT_CHECK_INTERVAL_MINUTES * 60_000;
  setInterval(() => {
    checkModerationBacklog().catch((err) => console.error('[moderation-alert] check failed:', err));
  }, intervalMs);
} else {
  console.warn('[moderation-alert] SMTP_HOST 未配置，审核积压邮件提醒已禁用');
}
