import { serve } from '@hono/node-server';
import { createApp } from './app';
import { env } from './env';
import { logEvent } from './lib/logger';
import { checkModerationBacklog } from './lib/moderationAlert';

serve({ fetch: createApp().fetch, port: env.PORT }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
  logEvent('server_start', { pid: process.pid, port: info.port });
});

// docker compose sends SIGTERM on every `--build server` redeploy, not just on crashes — log it
// so a future outage investigation can tell "was this a deploy" from the persisted log file
// alone, without digging through `journalctl -u docker`.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logEvent('server_stop', { signal });
    process.exit(0);
  });
}

// Both are otherwise fatal-by-default in Node 20 (uncaughtException prints to stderr and exits;
// an unhandled rejection throws). Log the stack before exiting so the crash reason survives the
// container recreation that `restart: unless-stopped` triggers next.
process.on('uncaughtException', (err) => {
  logEvent('uncaught_exception', { message: err.message, stack: err.stack });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logEvent('unhandled_rejection', {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  process.exit(1);
});

if (env.SMTP_HOST) {
  const intervalMs = env.MODERATION_ALERT_CHECK_INTERVAL_MINUTES * 60_000;
  setInterval(() => {
    checkModerationBacklog().catch((err) => console.error('[moderation-alert] check failed:', err));
  }, intervalMs);
} else {
  console.warn('[moderation-alert] SMTP_HOST 未配置，审核积压邮件提醒已禁用');
}
