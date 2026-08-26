import { Hono } from 'hono';
import { publicUrlFor } from '../lib/cos';

/** Same key shapes as uploads.ts's KEY_RE plus the seed restaurant image layout
 *  (restaurants/<id>/...). No `..` or absolute paths — this builds the COS fetch URL itself. */
const KEY_RE = /^(restaurants|uploads)\/[\w-]+(\/[\w-]+)*\.(jpg|jpeg|png|webp)$/i;

/** Streams a COS object through our own origin. Only needed by the cross-origin (Toy) build:
 *  the browser's Private Network Access check blocks direct <img> fetches to the COS domain
 *  from that origin, but same-origin /api requests aren't subject to it. */
const UPSTREAM_TIMEOUT_MS = 20_000;

export const imageProxyRoutes = new Hono().get('/', async (c) => {
  const key = c.req.query('key');
  if (!key || !KEY_RE.test(key)) return c.json({ error: '无效的图片路径' }, 400);

  let upstream: Response;
  try {
    upstream = await fetch(publicUrlFor(key), { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch {
    // Times out (or otherwise fails) before any response headers/bytes reach the client, so this
    // always fails cleanly — unlike a mid-stream abort, which corrupts the HTTP/2 response.
    return c.json({ error: '图片加载超时' }, 504);
  }
  if (!upstream.ok || !upstream.body) {
    return c.json({ error: '图片不存在' }, upstream.status === 404 ? 404 : 502);
  }
  c.header('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
  c.header('Cache-Control', 'public, max-age=86400, immutable');
  return c.body(upstream.body);
});
