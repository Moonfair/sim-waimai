import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { verifyToken, type AuthPayload } from '../lib/jwt';

export const AUTH_COOKIE = 'sw_token';

/** Sets `user` to the JWT payload or null; never rejects. */
export const optionalAuth = createMiddleware<{ Variables: { user: AuthPayload | null } }>(
  async (c, next) => {
    const token = getCookie(c, AUTH_COOKIE);
    c.set('user', token ? await verifyToken(token) : null);
    await next();
  },
);

/** Rejects with 401 unless a valid JWT cookie is present; sets non-null `user`. */
export const requireAuth = createMiddleware<{ Variables: { user: AuthPayload } }>(
  async (c, next) => {
    const token = getCookie(c, AUTH_COOKIE);
    const payload = token ? await verifyToken(token) : null;
    if (!payload) return c.json({ error: '请先登录' }, 401);
    c.set('user', payload);
    await next();
  },
);
