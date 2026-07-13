import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { isAdmin } from '../lib/admin';
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

/** Like requireAuth, but additionally 403s unless the username is in ADMIN_USERNAMES. */
export const requireAdmin = createMiddleware<{ Variables: { user: AuthPayload } }>(
  async (c, next) => {
    const token = getCookie(c, AUTH_COOKIE);
    const payload = token ? await verifyToken(token) : null;
    if (!payload) return c.json({ error: '请先登录' }, 401);
    if (!isAdmin(payload.username)) return c.json({ error: '无权访问' }, 403);
    c.set('user', payload);
    await next();
  },
);
