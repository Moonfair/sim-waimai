import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { isAdmin, isSuperAdmin } from '../lib/admin';
import { canManageChangelog } from '../lib/changelogAccess';
import { verifyToken, type AuthPayload } from '../lib/jwt';

export const AUTH_COOKIE = 'sw_token';

/** Same-origin deploys authenticate via the httpOnly cookie; the cross-origin Toy build has no
 *  usable cookie there (third-party cookie blocking), so it sends the JWT as a Bearer header
 *  instead — check that first, fall back to the cookie for the normal site. */
function extractToken(c: Context): string | null {
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return getCookie(c, AUTH_COOKIE) ?? null;
}

/** Sets `user` to the JWT payload or null; never rejects. */
export const optionalAuth = createMiddleware<{ Variables: { user: AuthPayload | null } }>(
  async (c, next) => {
    const token = extractToken(c);
    c.set('user', token ? await verifyToken(token) : null);
    await next();
  },
);

/** Rejects with 401 unless a valid JWT (cookie or Bearer header) is present; sets non-null `user`. */
export const requireAuth = createMiddleware<{ Variables: { user: AuthPayload } }>(
  async (c, next) => {
    const token = extractToken(c);
    const payload = token ? await verifyToken(token) : null;
    if (!payload) return c.json({ error: '请先登录' }, 401);
    c.set('user', payload);
    await next();
  },
);

/** Like requireAuth, but additionally 403s unless the user's role is 'admin' or 'superadmin'. */
export const requireAdmin = createMiddleware<{ Variables: { user: AuthPayload } }>(
  async (c, next) => {
    const token = extractToken(c);
    const payload = token ? await verifyToken(token) : null;
    if (!payload) return c.json({ error: '请先登录' }, 401);
    if (!(await isAdmin(payload.username))) return c.json({ error: '无权访问' }, 403);
    c.set('user', payload);
    await next();
  },
);

/** Like requireAuth, but additionally 403s unless the user's role is 'superadmin' —
 *  reserved for managing other admins' roles. */
export const requireSuperAdmin = createMiddleware<{ Variables: { user: AuthPayload } }>(
  async (c, next) => {
    const token = extractToken(c);
    const payload = token ? await verifyToken(token) : null;
    if (!payload) return c.json({ error: '请先登录' }, 401);
    if (!(await isSuperAdmin(payload.username))) return c.json({ error: '无权访问' }, 403);
    c.set('user', payload);
    await next();
  },
);

/** Like requireAuth, but additionally 403s unless the user is a full admin or a
 *  designated 更新日志 editor (see changelog_editors). */
export const requireChangelogEditor = createMiddleware<{ Variables: { user: AuthPayload } }>(
  async (c, next) => {
    const token = extractToken(c);
    const payload = token ? await verifyToken(token) : null;
    if (!payload) return c.json({ error: '请先登录' }, 401);
    if (!(await canManageChangelog(payload.username))) return c.json({ error: '无权访问' }, 403);
    c.set('user', payload);
    await next();
  },
);

/** Like requireAuth, but also accepts the token via a `?token=` query param.
 *  Scoped to the rider-hall SSE stream only: native EventSource can't send custom
 *  headers cross-origin, and the querystring fallback isn't extended to other routes
 *  to avoid leaking the JWT into general server/CDN access logs. */
export const requireAuthAllowQueryToken = createMiddleware<{ Variables: { user: AuthPayload } }>(
  async (c, next) => {
    const token = extractToken(c) ?? c.req.query('token') ?? null;
    const payload = token ? await verifyToken(token) : null;
    if (!payload) return c.json({ error: '请先登录' }, 401);
    c.set('user', payload);
    await next();
  },
);
