import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** server/logs — mounted as a Docker volume in prod (deploy/docker-compose.yml), so entries
 *  survive `docker compose up -d --build server` recreating the container. Plain `docker logs`
 *  does not: the old container (and its logs) is gone the moment the new one replaces it, which
 *  is exactly the evidence a deploy-restart incident needs. */
export const LOGS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../logs');
const LOG_FILE = path.join(LOGS_DIR, 'app.log');

/** Structured JSON-lines event log for things `docker logs` can't preserve across a deploy:
 *  process start/stop and unhandled errors with their stack traces. Request-level access logging
 *  is already covered by nginx's access.log (real client IP via X-Forwarded-For, status, UA). */
export function logEvent(event: string, data: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === 'test') return;
  const line = JSON.stringify({ time: new Date().toISOString(), event, ...data });
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (err) {
    // Logging must never be the reason the app crashes.
    console.error('[logger] failed to write log file:', err);
  }
}
