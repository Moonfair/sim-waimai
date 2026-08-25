import { Hono } from 'hono';
import { publicUrlFor } from '../lib/cos';

/** Same key shapes as uploads.ts's KEY_RE plus the seed restaurant image layout
 *  (restaurants/<id>/...). No `..` or absolute paths — this builds the COS fetch URL itself. */
const KEY_RE = /^(restaurants|uploads)\/[\w-]+(\/[\w-]+)*\.(jpg|jpeg|png|webp)$/i;

/** Streams a COS object through our own origin. Only needed by the cross-origin (Toy) build:
 *  the browser's Private Network Access check blocks direct <img> fetches to the COS domain
 *  from that origin, but same-origin /api requests aren't subject to it. */
export const imageProxyRoutes = new Hono().get('/', async (c) => {
  const key = c.req.query('key');
  if (!key || !KEY_RE.test(key)) return c.json({ error: '无效的图片路径' }, 400);

  const upstream = await fetch(publicUrlFor(key));
  if (!upstream.ok || !upstream.body) {
    return c.json({ error: '图片不存在' }, upstream.status === 404 ? 404 : 502);
  }
  c.header('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
  c.header('Cache-Control', 'public, max-age=86400, immutable');
  return c.body(upstream.body);
});
