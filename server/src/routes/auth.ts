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
import { getRole } from '../lib/admin';
import { issueCaptcha, verifyCaptcha } from '../lib/captcha';
import { canManageChangelog } from '../lib/changelogAccess';
import { isDeviceBanned, recordDeviceSeen } from '../lib/deviceTracking';
import { signToken } from '../lib/jwt';
import { moderateTextSync } from '../lib/moderationProvider';
import { hashPassword, verifyPassword } from '../lib/password';
import { AUTH_COOKIE, optionalAuth, requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';

// Throttle credential endpoints per IP to blunt brute-force / credential-stuffing and mass signups.
const loginRateLimit = rateLimit({ windowMs: 5 * 60_000, max: 10, message: '登录尝试太多次啦，请5分钟后再试' });
const registerRateLimit = rateLimit({ windowMs: 60 * 60_000, max: 20, message: '注册尝试太多次啦，请1小时后再试' });

const credentialsSchema = z.object({
  username: z
    .string()
    .min(3, '用户名太短啦，至少要3个字符')
    .max(20, '用户名太长啦，最多20个字符')
    .regex(/^[\w一-龥-]+$/, '用户名里有不支持的符号，只能用中文、英文、数字和下划线'),
  password: z.string().min(6, '密码太短啦，至少要6位').max(72, '密码太长啦，换短一点的'),
  deviceId: z.string().min(16, '参数错误').max(128, '参数错误'),
});

const registerSchema = credentialsSchema.extend({
  captchaToken: z.string().min(1, '请先完成验证码'),
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

async function toUserDto(row: { id: string; username: string; createdAt: Date }): Promise<UserDto> {
  const role = await getRole(row.username);
  return {
    id: row.id,
    username: row.username,
    createdAt: row.createdAt.toISOString(),
    isAdmin: role !== null,
    isSuperAdmin: role === 'superadmin',
    canManageChangelog: await canManageChangelog(row.username),
  };
}

/** Sets the httpOnly session cookie (used by same-origin deploys) and returns the raw JWT
 *  so callers can also hand it to a cross-origin client (the Toy build) as a Bearer token. */
async function issueSession(c: Context, user: { id: string; username: string }): Promise<string> {
  const token = await signToken(user);
  setCookie(c, AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 3600,
  });
  return token;
}

/** The cross-origin Toy build can't rely on the cookie (third-party cookie blocking), so it
 *  flags itself with this header to also get the raw JWT back in the response body. Gated
 *  behind an explicit opt-in so the normal site's login/register response — read by page JS —
 *  never carries the token, preserving the httpOnly cookie's XSS protection there. */
function wantsBearerToken(c: Context): boolean {
  return c.req.header('X-Client') === 'toy-bearer';
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
    const { username, password, deviceId, captchaToken, captchaAnswer } = c.req.valid('json');
    if (!(await verifyCaptcha(captchaToken, captchaAnswer))) {
      return c.json({ error: '验证码填错啦，已经换一道，再试一次' }, 400);
    }
    if (await isDeviceBanned(deviceId)) {
      return c.json({ error: '这台设备暂时无法注册，如有疑问请联系客服' }, 403);
    }
    if (await findByUsername(username)) {
      return c.json({ error: '这个用户名已经被抢注啦，换一个再试试' }, 409);
    }
    // 用户名全站可见，同步送 AI 文本审核；仅明确违规（reject）拒绝注册，
    // 存疑/未配置/超时/报错一律放行（fail-open，不阻塞注册）。
    const verdict = await moderateTextSync(username);
    if (verdict?.verdict === 'reject') {
      return c.json({ error: '用户名里有不太合适的内容，换个名字吧' }, 400);
    }
    const passwordHash = await hashPassword(password);
    let row;
    try {
      [row] = await db.insert(users).values({ username, passwordHash }).returning();
    } catch (err) {
      // unique_violation from a concurrent register
      if ((err as { code?: string }).code === '23505') {
        return c.json({ error: '这个用户名已经被抢注啦，换一个再试试' }, 409);
      }
      throw err;
    }
    await recordDeviceSeen(row!.id, deviceId);
    const token = await issueSession(c, row!);
    const dto = await toUserDto(row!);
    return c.json(wantsBearerToken(c) ? { ...dto, token } : dto);
  })
  .post('/login', loginRateLimit, validateCredentials, async (c) => {
    const { username, password, deviceId } = c.req.valid('json');
    if (await isDeviceBanned(deviceId)) {
      return c.json({ error: '这台设备暂时无法登录，如有疑问请联系客服' }, 403);
    }
    const row = await findByUsername(username);
    if (!row || !(await verifyPassword(password, row.passwordHash))) {
      return c.json({ error: '用户名或密码不对，请检查后重试' }, 401);
    }
    await recordDeviceSeen(row.id, deviceId);
    const token = await issueSession(c, row);
    const dto = await toUserDto(row);
    return c.json(wantsBearerToken(c) ? { ...dto, token } : dto);
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
    return c.json(await toUserDto(row));
  });
