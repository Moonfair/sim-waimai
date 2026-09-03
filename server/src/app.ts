import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { timeout } from 'hono/timeout';
import { env } from './env';
import { logEvent } from './lib/logger';
import { rateLimit } from './middleware/rateLimit';
import { adminRoutes } from './routes/admin';
import { adminAuditRoutes } from './routes/adminAudit';
import { adminReportsRoutes } from './routes/adminReports';
import { adminShopsRoutes } from './routes/adminShops';
import { adminStatsRoutes } from './routes/adminStats';
import { adminRolesRoutes } from './routes/adminRoles';
import { adminUsersRoutes } from './routes/adminUsers';
import { authRoutes } from './routes/auth';
import { adminChangelogRoutes, changelogRoutes } from './routes/changelog';
import { favoriteRoutes } from './routes/favorites';
import { imageProxyRoutes } from './routes/imageProxy';
import { merchantRoutes } from './routes/merchant';
import { recommendationRoutes } from './routes/recommendations';
import { orderRoutes } from './routes/orders';
import { reportRoutes } from './routes/reports';
import { restaurantRoutes } from './routes/restaurants';
import { reviewRoutes } from './routes/reviews';
import { riderHallRoutes } from './routes/riderHall';
import { searchRoutes } from './routes/search';
import { uploadRoutes } from './routes/uploads';

const JSON_BODY_LIMIT = 256 * 1024;
const UPLOAD_BODY_LIMIT = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export function createApp() {
  const app = new Hono().basePath('/api');

  // Origin never set Cache-Control on /api responses, so the EdgeOne CDN in front of prod was
  // free to cache them at its own discretion — including a since-stale CORS preflight/response
  // pair from before an origin was added to CORS_ALLOWED_ORIGINS, and (worse) potentially
  // user-specific JSON like /auth/me across different visitors. Responses here are all dynamic
  // and often per-session; never let a shared CDN cache them.
  app.use('*', async (c, next) => {
    await next();
    // Image proxy responses set their own long-lived Cache-Control; everything else is
    // dynamic/per-session and must never be cached by a shared CDN.
    if (!c.req.path.startsWith('/api/image-proxy')) c.header('Cache-Control', 'no-store');
  });

  // Cross-origin static hosts (e.g. the Toy build) authenticate via Bearer token, not the
  // cookie, so this doesn't need credentials:true. Off entirely unless explicitly configured.
  const corsOrigins = (env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (corsOrigins.length > 0) {
    app.use(
      '*',
      cors({
        origin: corsOrigins,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Client'],
        allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      }),
    );
  }

  // Cap request latency, then shed per-IP floods before we buffer any body.
  // Exempt the 抢单大厅 SSE stream (a deliberately long-lived connection, not a slow request)
  // and the image proxy: this middleware firing mid-stream — after headers/some body bytes
  // are already flushed — truncates the HTTP/2 response instead of cleanly erroring, which
  // showed up as net::ERR_HTTP2_PROTOCOL_ERROR for slow concurrent image loads. The proxy
  // bounds its own upstream fetch instead (see routes/imageProxy.ts), which fails before any
  // bytes are sent.
  const requestTimeout = timeout(REQUEST_TIMEOUT_MS);
  const timeoutExempt = new Set(['/api/rider-hall/stream', '/api/image-proxy']);
  app.use('*', (c, next) => (timeoutExempt.has(c.req.path) ? next() : requestTimeout(c, next)));
  app.use('*', rateLimit({ windowMs: 60_000, max: 300, message: '请求过于频繁，请稍后再试' }));

  // Bound how much we buffer per request. Uploads carry raw image bytes, so they get a wider cap;
  // everything else is small JSON.
  const jsonBody = bodyLimit({
    maxSize: JSON_BODY_LIMIT,
    onError: (c) => c.json({ error: '请求体过大' }, 413),
  });
  const uploadBody = bodyLimit({
    maxSize: UPLOAD_BODY_LIMIT,
    onError: (c) => c.json({ error: '图片不能超过5MB' }, 413),
  });
  app.use('*', (c, next) =>
    (c.req.path.startsWith('/api/uploads') ? uploadBody : jsonBody)(c, next),
  );

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/auth', authRoutes);
  app.route('/restaurants', restaurantRoutes);
  app.route('/search', searchRoutes);
  app.route('/orders', orderRoutes);
  app.route('/orders', reviewRoutes);
  app.route('/rider-hall', riderHallRoutes);
  app.route('/favorites', favoriteRoutes);
  app.route('/image-proxy', imageProxyRoutes);
  app.route('/merchant', merchantRoutes);
  app.route('/uploads', uploadRoutes);
  app.route('/recommendations', recommendationRoutes);
  app.route('/reports', reportRoutes);
  app.route('/changelog', changelogRoutes);
  app.route('/admin', adminRoutes);
  app.route('/admin', adminStatsRoutes);
  app.route('/admin', adminShopsRoutes);
  app.route('/admin', adminReportsRoutes);
  app.route('/admin', adminUsersRoutes);
  app.route('/admin', adminChangelogRoutes);
  app.route('/admin', adminRolesRoutes);
  app.route('/admin', adminAuditRoutes);

  app.notFound((c) => c.json({ error: '接口不存在' }, 404));

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error(err);
    logEvent('unhandled_error', {
      method: c.req.method,
      path: c.req.path,
      message: err.message,
      stack: err.stack,
    });
    return c.json({ error: '服务器内部错误' }, 500);
  });

  return app;
}
