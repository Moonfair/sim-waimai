import { zValidator } from '@hono/zod-validator';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { z } from 'zod';
import type { UserDto } from '@sim-waimai/shared';
import { db } from '../db/client';
import { users } from '../db/schema';
import { env } from '../env';
import { isAdmin } from '../lib/admin';
import { issueCaptcha, verifyCaptcha } from '../lib/captcha';
import { signToken } from '../lib/jwt';
import { hashPassword, verifyPassword } from '../lib/password';
import { AUTH_COOKIE, optionalAuth, requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';

// Throttle credential endpoints per IP to blunt brute-force / credential-stuffing and mass signups.
const loginRateLimit = rateLimit({ windowMs: 5 * 60_000, max: 10, message: '尝试过于频繁，请稍后再试' });
const registerRateLimit = rateLimit({ windowMs: 60 * 60_000, max: 20, message: '操作过于频繁，请稍后再试' });

const credentialsSchema = z.object({
  username: z
    .string()
    .min(3, '用户名至少3个字符')
    .max(20, '用户名最多20个字符')
    .regex(/^[\w一-龥-]+$/, '用户名只能包含中英文、数字、下划线'),
  password: z.string().min(6, '密码至少6位').max(72, '密码过长'),
});

const registerSchema = credentialsSchema.extend({
  captchaToken: z.string().min(1, '请完成验证'),
  captchaAnswer: z.coerce.number(),
});

const validateCredentials = zValidator('json', credentialsSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: result.error.issues[0]?.message ?? '参数错误' }, 400);
  }
});

const validateRegister = zValidator('json', registerSchema, (result, c) => {
  if (!result.success) {
    return c.json({ error: result.error.issues[0]?.message ?? '参数错误' }, 400);
  }
});

function toUserDto(row: { id: string; username: string; createdAt: Date }): UserDto {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.createdAt.toISOString(),
    isAdmin: isAdmin(row.username),
  };
}

async function setAuthCookie(c: Context, user: { id: string; username: string }) {
  setCookie(c, AUTH_COOKIE, await signToken(user), {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 3600,
  });
}

async function findByUsername(username: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`);
  return row;
}

export const authRoutes = new Hono()
  .get('/captcha', async (c) => c.json(await issueCaptcha()))
  .post('/register', registerRateLimit, validateRegister, async (c) => {
    const { username, password, captchaToken, captchaAnswer } = c.req.valid('json');
    if (!(await verifyCaptcha(captchaToken, captchaAnswer))) {
      return c.json({ error: '验证码错误或已过期' }, 400);
    }
    if (await findByUsername(username)) {
      return c.json({ error: '用户名已存在' }, 409);
    }
    const passwordHash = await hashPassword(password);
    let row;
    try {
      [row] = await db.insert(users).values({ username, passwordHash }).returning();
    } catch (err) {
      // unique_violation from a concurrent register
      if ((err as { code?: string }).code === '23505') {
        return c.json({ error: '用户名已存在' }, 409);
      }
      throw err;
    }
    await setAuthCookie(c, row!);
    return c.json(toUserDto(row!));
  })
  .post('/login', loginRateLimit, validateCredentials, async (c) => {
    const { username, password } = c.req.valid('json');
    const row = await findByUsername(username);
    if (!row || !(await verifyPassword(password, row.passwordHash))) {
      return c.json({ error: '用户名或密码错误' }, 401);
    }
    await setAuthCookie(c, row);
    return c.json(toUserDto(row));
  })
  .post('/logout', requireAuth, (c) => {
    deleteCookie(c, AUTH_COOKIE, { path: '/' });
    return c.json({ ok: true });
  })
  .get('/me', optionalAuth, async (c) => {
    const payload = c.get('user');
    if (!payload) return c.json({ error: '请先登录' }, 401);
    const [row] = await db.select().from(users).where(eq(users.id, payload.sub));
    if (!row) return c.json({ error: '请先登录' }, 401);
    return c.json(toUserDto(row));
  });
