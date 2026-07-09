import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { authRoutes } from './routes/auth';
import { favoriteRoutes } from './routes/favorites';
import { merchantRoutes } from './routes/merchant';
import { orderRoutes } from './routes/orders';
import { restaurantRoutes } from './routes/restaurants';
import { reviewRoutes } from './routes/reviews';

export function createApp() {
  const app = new Hono().basePath('/api');

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/auth', authRoutes);
  app.route('/restaurants', restaurantRoutes);
  app.route('/orders', orderRoutes);
  app.route('/orders', reviewRoutes);
  app.route('/favorites', favoriteRoutes);
  app.route('/merchant', merchantRoutes);

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
