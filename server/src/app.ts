import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { timeout } from 'hono/timeout';
import { rateLimit } from './middleware/rateLimit';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { favoriteRoutes } from './routes/favorites';
import { merchantRoutes } from './routes/merchant';
import { recommendationRoutes } from './routes/recommendations';
import { orderRoutes } from './routes/orders';
import { restaurantRoutes } from './routes/restaurants';
import { reviewRoutes } from './routes/reviews';
import { uploadRoutes } from './routes/uploads';

const JSON_BODY_LIMIT = 256 * 1024;
const UPLOAD_BODY_LIMIT = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export function createApp() {
  const app = new Hono().basePath('/api');

  // Cap request latency, then shed per-IP floods before we buffer any body.
  app.use('*', timeout(REQUEST_TIMEOUT_MS));
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
  app.route('/orders', orderRoutes);
  app.route('/orders', reviewRoutes);
  app.route('/favorites', favoriteRoutes);
  app.route('/merchant', merchantRoutes);
  app.route('/uploads', uploadRoutes);
  app.route('/recommendations', recommendationRoutes);
  app.route('/admin', adminRoutes);

  app.notFound((c) => c.json({ error: '接口不存在' }, 404));

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error(err);
    return c.json({ error: '服务器内部错误' }, 500);
  });

  return app;
}
