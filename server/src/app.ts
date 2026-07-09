import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { authRoutes } from './routes/auth';
import { orderRoutes } from './routes/orders';
import { restaurantRoutes } from './routes/restaurants';

export function createApp() {
  const app = new Hono().basePath('/api');

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/auth', authRoutes);
  app.route('/restaurants', restaurantRoutes);
  app.route('/orders', orderRoutes);

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
