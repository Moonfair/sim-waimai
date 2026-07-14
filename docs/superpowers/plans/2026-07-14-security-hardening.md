# 生产安全加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 `https://sim-waimai.moonfair.cn`（已上线，用户打算公开分享）实测验证出的安全缺口——证书自动续期、数据库每日备份、fail2ban、firewalld、注册验证码、Docker 日志限制——并把 CDN/WAF、可用性监控、管理后台 IP 白名单整理成可执行/可复用的操作清单。

**Architecture:** 后端新增无状态算术验证码（签名 JWT 存答案，不引入 Redis/session），接入 `POST /api/auth/register`；`deploy/docker-compose.yml` 加日志大小限制与 `server` 容器 healthcheck；新增 `deploy/backup-db.sh` + `deploy/backup-upload.mjs`，用 host cron 驱动每日 `pg_dump` → gzip → 上传现有 COS bucket 并清理 7 天前的旧备份；fail2ban/firewalld/certbot-renew 直接在 CVM 上用 `yum`/`systemctl`/`firewall-cmd` 配置；管理后台 IP 白名单和 CDN 回源 IP 段因为含真实公网 IP/易变的官方网段，不写入这个公开仓库跟踪的 `deploy/nginx.conf`，改为运行手册（`deploy/ADMIN-IP-WHITELIST.md`、`deploy/CDN-MONITORING.md`）指导直接在 CVM 上应用。

**Tech Stack:** Hono、`hono/jwt`（复用现有 JWT 签名机制）、zod、cos-nodejs-sdk-v5（root workspace 已有 devDependency）、Docker Compose logging/healthcheck 配置、CentOS 7 `yum`/`firewalld`/`fail2ban`/`certbot`。

**设计文档：** `docs/superpowers/specs/2026-07-14-security-hardening-design.md`

## Global Constraints

以下事实已核实，直接照抄执行即可，不要重新猜测：

- **目标机**：SSH 别名 `txy`（`root@106.55.231.31`），CentOS Linux 7 (x86_64)，部署目录 `/srv/sim-waimai`（见 `docs/superpowers/plans/2026-07-14-cvm-deployment.md`，本计划的远程任务全部复用这次部署的既有约定）。
- **目标机现状（已通过 SSH 验证）**：`PasswordAuthentication no`（已关）；`fail2ban` 未装；`firewalld` 处于 `inactive`；`certbot-renew.timer` 处于 `disabled`（证书 10 月 12 日到期后会静默失效）；数据库无任何备份机制；`server` 容器无 healthcheck；EPEL 已装（`epel-release`，之前部署 certbot 时装的，fail2ban 可以直接 `yum install`）。
- **SSH 连接不稳定**：约 30% 概率中途返回 `Connection closed by 106.55.231.31 port 22`（exit 255），和命令是否成功无关。所有 `ssh txy '...'` 调用都要带 `-o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6`，遇到 exit 255 直接重跑同一条命令。
- **GitHub 连接不稳定**：`git pull`/`git clone` 经常超时，失败要重跑 2-3 次。
- **`POST /api/auth/login` 的限流已经在生产代码里（本计划开始前就有，2026-07-11 提交）**：`server/src/routes/auth.ts` 里 `loginRateLimit = rateLimit({ windowMs: 5 * 60_000, max: 10, ... })`（5 分钟 10 次），比设计文档提议的"10 次/15 分钟"更严格。`POST /api/auth/register` 也已经有 `registerRateLimit`（60 分钟 20 次）。**这两项设计文档里列的限流目标已经达成，本计划不重复实现**，只在 Task 9 的端到端验证里确认它们仍然生效。
- **不要把真实公网 IP 提交进这个仓库**：仓库是公开的（`https://github.com/Moonfair/sim-waimai.git`），管理后台 IP 白名单和任何人的家庭/办公网络 IP 都不能出现在 git 历史里。这类规则直接改在 CVM 上部署好的 `/etc/nginx/conf.d/sim-waimai.conf`，`deploy/nginx.conf`（这个仓库跟踪的模板）保持不变——这和 certbot 会自动往部署后的配置里追加 443 块、但从不回写 `deploy/nginx.conf` 是同一个既有模式。
- **验证码不引入新基础设施**：答案编码进用 `env.JWT_SECRET` 签名、5 分钟过期的 JWT 里随 token 一起发给客户端，服务端不存任何验证码状态。
- **CDN 回源 IP 段不能抄旧文档**：腾讯云 EdgeOne 的回源 IP 网段会变化，写死一份当前查到的列表到committed 文件里会随时间失效且不会有人記得更新；这部分作为操作手册里的"当时去控制台查"步骤，不作为本计划产出的固定配置。
- **本次范围外**：不迁移 CentOS 7（见 Task 6 `deploy/KNOWN-RISKS.md`）；不引入外部验证码服务；不做管理后台 TOTP；不引入 Redis/会话存储。

---

## 文件结构

```
server/src/
  lib/captcha.ts              # 新增：无状态算术验证码签发/校验
  routes/auth.ts               # 修改：新增 GET /captcha，POST /register 接入验证码校验
  test/testHelpers.ts          # 新增：registerTestUser() 共享测试辅助（解验证码 + 注册）
  test/captcha.test.ts         # 新增：验证码签发/校验的专项测试
  test/auth.test.ts            # 修改：改用 registerTestUser
  test/orders.test.ts          # 修改：同上
  test/moderation.test.ts      # 修改：同上
  test/merchant.test.ts        # 修改：同上
  test/reviews.test.ts         # 修改：同上
  test/restaurants.test.ts     # 修改：同上
  test/favorites.test.ts       # 修改：同上
  test/uploads.test.ts         # 修改：同上
  test/stats.test.ts           # 修改：同上（两处调用）
  test/recommendations.test.ts # 修改：同上
shared/src/
  api.ts                       # 修改：新增 CaptchaChallenge 类型
src/
  context/AuthContext.tsx      # 修改：register() 签名新增 captchaToken/captchaAnswer
  components/AuthForm.tsx      # 修改：注册模式下新增验证码输入 UI
deploy/
  docker-compose.yml           # 修改：db/server 加 logging 限制；server 加 healthcheck
  backup-db.sh                 # 新增：host cron 驱动的每日备份脚本
  backup-upload.mjs            # 新增：备份文件上传 COS + 清理 7 天前旧备份
  sim-waimai-backup.cron       # 新增：/etc/cron.d 定时任务模板
  KNOWN-RISKS.md                # 新增：记录 CentOS 7 EOL 已知风险
  ADMIN-IP-WHITELIST.md         # 新增：管理后台 IP 白名单运行手册
  CDN-MONITORING.md             # 新增：EdgeOne CDN/WAF + UptimeRobot 操作清单
```

---

### Task 1: 注册验证码——后端

**Files:**
- Create: `server/src/lib/captcha.ts`
- Modify: `server/src/routes/auth.ts`（全文件）
- Modify: `shared/src/api.ts`（新增 `CaptchaChallenge` 类型）
- Create: `server/src/test/testHelpers.ts`
- Create: `server/src/test/captcha.test.ts`
- Modify: `server/src/test/auth.test.ts:34`, `:44-47`
- Modify: `server/src/test/orders.test.ts:20-24`
- Modify: `server/src/test/moderation.test.ts:30-34`
- Modify: `server/src/test/merchant.test.ts:24-28`
- Modify: `server/src/test/reviews.test.ts:28-32`
- Modify: `server/src/test/restaurants.test.ts:19-23`
- Modify: `server/src/test/favorites.test.ts:14-18`
- Modify: `server/src/test/uploads.test.ts:19-23`
- Modify: `server/src/test/stats.test.ts:19-23`, `:150-154`
- Modify: `server/src/test/recommendations.test.ts:14-18`

**Interfaces:**
- Produces：`issueCaptcha(): Promise<CaptchaChallenge>`、`verifyCaptcha(token: string, answer: number): Promise<boolean>`（`server/src/lib/captcha.ts`），`GET /api/auth/captcha`、`POST /api/auth/register` 新增必填 `captchaToken`/`captchaAnswer` 字段。
- Produces：`registerTestUser(app, cred): Promise<Response>`（`server/src/test/testHelpers.ts`），供本任务和之后所有测试文件复用。
- Consumes：`env.JWT_SECRET`（`server/src/env.ts`，已存在）、`hono/jwt` 的 `sign`/`verify`（`server/src/lib/jwt.ts` 已有先例）。

- [ ] **Step 1: 写 `shared/src/api.ts` 的 `CaptchaChallenge` 类型**

在 `PresignResponse` 定义之后追加：

```typescript
/** Stateless arithmetic captcha challenge returned by GET /auth/captcha. */
export interface CaptchaChallenge {
  token: string;
  question: string;
}
```

- [ ] **Step 2: 写 `server/src/lib/captcha.ts`**

```typescript
import { sign, verify } from 'hono/jwt';
import type { CaptchaChallenge } from '@sim-waimai/shared';
import { env } from '../env';

const CAPTCHA_TTL_S = 5 * 60;

interface CaptchaPayload {
  answer: number;
  exp: number;
  [key: string]: unknown;
}

function randomDigit(): number {
  return Math.floor(Math.random() * 9) + 1;
}

/** Stateless arithmetic captcha: the answer travels inside a signed, short-lived JWT rather
 *  than server-side session state, so a single process needs no Redis to verify it later. */
export async function issueCaptcha(): Promise<CaptchaChallenge> {
  const a = randomDigit();
  const b = randomDigit();
  const token = await sign(
    { answer: a + b, exp: Math.floor(Date.now() / 1000) + CAPTCHA_TTL_S },
    env.JWT_SECRET,
  );
  return { token, question: `${a} + ${b}` };
}

export async function verifyCaptcha(token: string, answer: number): Promise<boolean> {
  try {
    const payload = (await verify(token, env.JWT_SECRET, 'HS256')) as CaptchaPayload;
    return payload.answer === answer;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: 改写 `server/src/routes/auth.ts`（全文件替换）**

```typescript
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
```

- [ ] **Step 4: 写 `server/src/test/testHelpers.ts`**

```typescript
import type { createApp } from '../app';

/** Solves the arithmetic captcha and registers a user, mirroring the real browser flow
 *  (POST /auth/register requires a valid captchaToken + captchaAnswer since the
 *  2026-07-14 security hardening). Every other test file that needs a logged-in user
 *  should call this instead of posting to /auth/register directly. */
export async function registerTestUser(
  app: ReturnType<typeof createApp>,
  cred: { username: string; password: string },
): Promise<Response> {
  const challenge = (await (await app.request('/api/auth/captcha')).json()) as {
    token: string;
    question: string;
  };
  const [a, b] = challenge.question.split('+').map((n) => Number(n.trim()));
  return app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...cred, captchaToken: challenge.token, captchaAnswer: a! + b! }),
  });
}
```

- [ ] **Step 5: 写 `server/src/test/captcha.test.ts`**

```typescript
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { users } from '../db/schema';
import { registerTestUser } from './testHelpers';

const app = createApp();
const username = `t_cap_${Date.now().toString(36)}`;

afterAll(async () => {
  await db.delete(users).where(eq(users.username, username));
  await pool.end();
});

describe('captcha-gated registration', () => {
  it('issues a solvable arithmetic challenge', async () => {
    const res = await app.request('/api/auth/captcha');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; question: string };
    expect(body.token).toBeTruthy();
    expect(body.question).toMatch(/^\d+ \+ \d+$/);
  });

  it('rejects register with a wrong answer', async () => {
    const challenge = (await (await app.request('/api/auth/captcha')).json()) as {
      token: string;
      question: string;
    };
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: `${username}_wrong`,
        password: 'secret123',
        captchaToken: challenge.token,
        captchaAnswer: -1,
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('验证码错误或已过期');
  });

  it('rejects register missing captcha fields entirely', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `${username}_none`, password: 'secret123' }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts register with the correct answer', async () => {
    const res = await registerTestUser(app, { username, password: 'secret123' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { username: string };
    expect(body.username).toBe(username);
  });
});
```

- [ ] **Step 6: 修 `server/src/test/auth.test.ts`**

在文件顶部 import 区加一行：

```typescript
import { registerTestUser } from './testHelpers';
```

把第 34 行：

```typescript
    const res = await postJson('/api/auth/register', { username, password });
```

改成：

```typescript
    const res = await registerTestUser(app, { username, password });
```

把第 44-47 行：

```typescript
    const res = await postJson('/api/auth/register', {
      username: username.toUpperCase(),
      password,
    });
```

改成：

```typescript
    const res = await registerTestUser(app, { username: username.toUpperCase(), password });
```

（第 53-54 行两条"用户名/密码太短返回 400"的断言不用改——缺少 `captchaToken`/`captchaAnswer` 时 zod 校验同样会先于验证码检查失败，仍然是 400，断言原样成立。）

- [ ] **Step 7: 修 `server/src/test/orders.test.ts`**

顶部加：`import { registerTestUser } from './testHelpers';`

把第 20-24 行的 `registerAndLogin` 函数体：

```typescript
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cred),
  });
```

改成：

```typescript
  const res = await registerTestUser(app, cred);
```

- [ ] **Step 8: 修 `server/src/test/moderation.test.ts`**

顶部加：`import { registerTestUser } from './testHelpers';`

把第 30-34 行的 `register` 函数体：

```typescript
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cred),
  });
```

改成：

```typescript
  const res = await registerTestUser(app, cred);
```

- [ ] **Step 9: 修 `server/src/test/merchant.test.ts`**

顶部加：`import { registerTestUser } from './testHelpers';`

把第 24-28 行的 `register` 函数体同样替换成 `const res = await registerTestUser(app, cred);`

- [ ] **Step 10: 修 `server/src/test/reviews.test.ts`**

顶部加：`import { registerTestUser } from './testHelpers';`

把第 28-32 行：

```typescript
  const res = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cred),
  });
```

改成：`const res = await registerTestUser(app, cred);`

- [ ] **Step 11: 修 `server/src/test/restaurants.test.ts`**

顶部加：`import { registerTestUser } from './testHelpers';`

把第 19-23 行（`registerAndCreatePendingShop` 函数体开头）：

```typescript
  const registerRes = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'secret123' }),
  });
```

改成：

```typescript
  const registerRes = await registerTestUser(app, { username, password: 'secret123' });
```

- [ ] **Step 12: 修 `server/src/test/favorites.test.ts`**

顶部加：`import { registerTestUser } from './testHelpers';`

把第 14-18 行替换成 `const res = await registerTestUser(app, cred);`

- [ ] **Step 13: 修 `server/src/test/uploads.test.ts`**

顶部加：`import { registerTestUser } from './testHelpers';`

把第 19-23 行（`register` 函数体）替换成 `const res = await registerTestUser(app, cred);`

- [ ] **Step 14: 修 `server/src/test/stats.test.ts`**

顶部加：`import { registerTestUser } from './testHelpers';`

把第 19-23 行替换成 `const res = await registerTestUser(app, cred);`

把第 150-154 行：

```typescript
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(other),
    });
```

改成：

```typescript
    const res = await registerTestUser(app, other);
```

- [ ] **Step 15: 修 `server/src/test/recommendations.test.ts`**

顶部加：`import { registerTestUser } from './testHelpers';`

把第 14-18 行替换成 `const res = await registerTestUser(app, cred);`

- [ ] **Step 16: 跑全量测试确认没有遗漏的直连 `/auth/register` 调用**

```bash
cd /Users/moonfair/Projects/sim-waimai
grep -rn "auth/register" server/src/test
```

Expected: 每个文件里唯一匹配到的是 `testHelpers.ts` 内部实现和各文件里已经改成 `registerTestUser(app, ...)` 的调用——不应该再有任何一处是直接 `app.request('/api/auth/register', ...)` 手写 body。

- [ ] **Step 17: 跑测试套件**

```bash
npm run db:up
npm run test:server
```

Expected: 全部测试通过（`captcha.test.ts` 新增用例 + 所有既有测试文件因为改用 `registerTestUser` 而继续通过）。

- [ ] **Step 18: 类型检查**

```bash
npm -w server run typecheck
npm run build
```

Expected: 两条都无报错退出。

- [ ] **Step 19: Commit**

```bash
git add shared/src/api.ts server/src/lib/captcha.ts server/src/routes/auth.ts \
  server/src/test/testHelpers.ts server/src/test/captcha.test.ts \
  server/src/test/auth.test.ts server/src/test/orders.test.ts \
  server/src/test/moderation.test.ts server/src/test/merchant.test.ts \
  server/src/test/reviews.test.ts server/src/test/restaurants.test.ts \
  server/src/test/favorites.test.ts server/src/test/uploads.test.ts \
  server/src/test/stats.test.ts server/src/test/recommendations.test.ts
git commit -m "feat(server): require a stateless arithmetic captcha to register"
```

---

### Task 2: 注册验证码——前端

**Files:**
- Modify: `src/context/AuthContext.tsx`（全文件）
- Modify: `src/components/AuthForm.tsx`（全文件）

**Interfaces:**
- Consumes：Task 1 的 `GET /api/auth/captcha`（返回 `CaptchaChallenge`）、`POST /api/auth/register` 新增必填字段。
- Consumes：`CaptchaChallenge` 类型（`shared/src/api.ts`，Task 1 已新增）。

- [ ] **Step 1: 改写 `src/context/AuthContext.tsx`（全文件替换）**

```typescript
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { UserDto } from '@sim-waimai/shared';
import { api } from '../lib/api';

interface AuthContextType {
  user: UserDto | null;
  /** True while the initial /auth/me bootstrap is in flight. */
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (
    username: string,
    password: string,
    captchaToken: string,
    captchaAnswer: number,
  ) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<UserDto>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    setUser(await api.post<UserDto>('/auth/login', { username, password }));
  };

  const register = async (
    username: string,
    password: string,
    captchaToken: string,
    captchaAnswer: number,
  ) => {
    setUser(
      await api.post<UserDto>('/auth/register', {
        username,
        password,
        captchaToken,
        captchaAnswer,
      }),
    );
  };

  const logout = async () => {
    await api.post('/auth/logout');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

- [ ] **Step 2: 改写 `src/components/AuthForm.tsx`（全文件替换）**

```tsx
import { useEffect, useState } from 'react';
import type { SubmitEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { CaptchaChallenge } from '@sim-waimai/shared';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

interface Props {
  mode: 'login' | 'register';
}

export default function AuthForm({ mode }: Props) {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') ?? '/';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [captcha, setCaptcha] = useState<CaptchaChallenge | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isLogin = mode === 'login';
  const title = isLogin ? '登录' : '注册';

  const refreshCaptcha = () => {
    setCaptchaAnswer('');
    api
      .get<CaptchaChallenge>('/auth/captcha')
      .then(setCaptcha)
      .catch(() => setCaptcha(null));
  };

  useEffect(() => {
    if (!isLogin) refreshCaptcha();
  }, [isLogin]);

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (!isLogin && password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (isLogin) {
        await login(username.trim(), password);
      } else {
        if (!captcha) throw new Error('验证码加载失败，请重试');
        await register(username.trim(), password, captcha.token, Number(captchaAnswer));
      }
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请稍后重试');
      if (!isLogin) refreshCaptcha();
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-orange-400 text-sm';

  return (
    <div className="app-container min-h-screen">
      <div className="bg-orange-500 pt-10 pb-8 px-4 relative">
        <button
          className="absolute top-10 left-4 w-9 h-9 bg-white/20 rounded-full flex items-center justify-center text-white"
          onClick={() => navigate(-1)}
          aria-label="返回"
        >
          ←
        </button>
        <div className="text-center">
          <div className="text-5xl">🥡</div>
          <h1 className="text-white text-2xl font-black mt-2">吃了嘛外卖</h1>
          <p className="text-orange-100 text-xs mt-1">{title}后开启省钱省卡路里之旅</p>
        </div>
      </div>

      <form className="px-6 mt-4" onSubmit={handleSubmit}>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 space-y-3">
          <h2 className="text-gray-800 dark:text-gray-100 font-bold text-lg">{title}</h2>
          <input
            className={inputClass}
            placeholder="用户名（3-20个字符）"
            value={username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className={inputClass}
            type="password"
            placeholder="密码（至少6位）"
            value={password}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            onChange={(e) => setPassword(e.target.value)}
          />
          {!isLogin && (
            <input
              className={inputClass}
              type="password"
              placeholder="确认密码"
              value={confirm}
              autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
          {!isLogin && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                验证：{captcha ? `${captcha.question} =` : '加载中…'}
              </span>
              <input
                className={inputClass}
                inputMode="numeric"
                placeholder="请输入结果"
                value={captchaAnswer}
                onChange={(e) => setCaptchaAnswer(e.target.value)}
              />
            </div>
          )}
          {error && <p className="text-red-500 text-xs px-1">{error}</p>}
          <button
            type="submit"
            disabled={
              submitting || !username || !password || (!isLogin && (!captcha || !captchaAnswer))
            }
            className="w-full bg-orange-500 text-white py-3 rounded-xl font-bold text-sm disabled:opacity-50"
          >
            {submitting ? `${title}中…` : title}
          </button>
        </div>

        <p className="text-center text-sm text-gray-400 dark:text-gray-500 mt-4">
          {isLogin ? (
            <>
              还没有账号？
              <Link className="text-orange-500 font-medium" to={`/register?redirect=${encodeURIComponent(redirect)}`}>
                去注册
              </Link>
            </>
          ) : (
            <>
              已有账号？
              <Link className="text-orange-500 font-medium" to={`/login?redirect=${encodeURIComponent(redirect)}`}>
                去登录
              </Link>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: 类型检查 + lint**

```bash
cd /Users/moonfair/Projects/sim-waimai
npm run build
npm run lint
```

Expected: 均无报错。

- [ ] **Step 4: 本地浏览器手动验证**

```bash
npm run dev
```

打开 `http://localhost:5173/register`：确认页面显示"验证：`a + b` ="的算式和一个输入框；输入用户名/密码/确认密码/正确答案后提交，应该注册成功并跳转；故意填错答案提交，应该看到"验证码错误或已过期"的报错，且题目自动换了一道新的（`captcha.question` 变化）。确认 `http://localhost:5173/login` 页面**没有**验证码框（只有注册流程要求）。

- [ ] **Step 5: Commit**

```bash
git add src/context/AuthContext.tsx src/components/AuthForm.tsx
git commit -m "feat: add arithmetic captcha UI to the register form"
```

---

### Task 3: Docker 日志大小限制 + `server` 容器 healthcheck

**Files:**
- Modify: `deploy/docker-compose.yml`（全文件）

**Interfaces:**
- Produces：`db`/`server` 两个服务都带 `logging.options.max-size: "10m"` / `max-file: "3"`；`server` 服务新增 `healthcheck`。Task 9 的远程重新部署会验证这两项在真实容器上生效。

- [ ] **Step 1: 改写 `deploy/docker-compose.yml`（全文件替换）**

```yaml
services:
  db:
    image: postgres:16-alpine
    container_name: sim-waimai-db
    restart: unless-stopped
    # CentOS 7 的 3.10 内核在 Docker 默认 seccomp profile 下会让 Postgres 的 WAL 预分配
    # (posix_fallocate) 报 "Operation not permitted" 直接崩溃退出，放宽 seccomp 是标准
    # 的已知修复。真正兜底的不是"没开端口"（这跟 seccomp 无关），而是 db 只能被同一
    # compose 网络里的 server 访问——攻击者必须先攻陷 server 才够得到 db。
    security_opt:
      - seccomp:unconfined
    # 只给 db 需要的两个变量，不用 env_file 整个 .env（那样会把 JWT_SECRET/COS_* 等
    # app 密钥也塞进这个开了 seccomp:unconfined 的容器，白白扩大泄露面）。
    env_file: .env.db
    environment:
      POSTGRES_DB: sim_waimai
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 10
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  server:
    build:
      context: ../
      dockerfile: server/Dockerfile
    container_name: sim-waimai-server
    restart: unless-stopped
    env_file: ../.env
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "127.0.0.1:3001:3001"
    volumes:
      - uploads:/app/server/uploads
    # node:20-alpine 没有 curl/wget，用 Node 20 自带的 fetch 写健康检查命令。
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 3
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  pgdata:
  uploads:
```

- [ ] **Step 2: 本地验证 YAML 语法**

```bash
cd /Users/moonfair/Projects/sim-waimai
docker compose -f deploy/docker-compose.yml config --quiet && echo COMPOSE_CONFIG_VALID
```

Expected: 输出 `COMPOSE_CONFIG_VALID`，无报错。

- [ ] **Step 3: Commit**

```bash
git add deploy/docker-compose.yml
git commit -m "chore(deploy): cap container log size and add server healthcheck"
```

---

### Task 4: 数据库每日备份脚本

**Files:**
- Create: `deploy/backup-db.sh`
- Create: `deploy/backup-upload.mjs`
- Create: `deploy/sim-waimai-backup.cron`

**Interfaces:**
- Consumes：Task 3 之后的 `deploy/docker-compose.yml`（`docker compose exec db pg_dump`）、CVM 上 `/srv/sim-waimai/.env` 里的 `COS_SECRET_ID`/`COS_SECRET_KEY`/`COS_BUCKET`/`COS_REGION`（部署时已经写入，见 `deploy/DEPLOY.md`）、`node_modules/cos-nodejs-sdk-v5`（CVM 上构建前端时 `npm ci` 已经装好，见 CVM 部署计划 Task 9）。
- Produces：本地 `/srv/sim-waimai/backups/*.sql.gz` + COS 上 `backups/*.sql.gz`，7 天前的都会被两边一起清理。供 Task 13（远程部署+验证）使用。

- [ ] **Step 1: 写 `deploy/backup-upload.mjs`**

```javascript
import fs from 'node:fs';
import path from 'node:path';
import COS from 'cos-nodejs-sdk-v5';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const filename = process.argv[2];
if (!filename) {
  console.error('Usage: node deploy/backup-upload.mjs <filename-under-backups/>');
  process.exit(1);
}

// Overridable only so Task 13's remote verification can force an immediate cleanup instead
// of waiting 7 real days to prove the retention logic actually deletes stale objects.
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? 7);
const Bucket = requireEnv('COS_BUCKET');
const Region = requireEnv('COS_REGION');
const cos = new COS({ SecretId: requireEnv('COS_SECRET_ID'), SecretKey: requireEnv('COS_SECRET_KEY') });

function putObject(key, body) {
  return new Promise((resolve, reject) => {
    cos.putObject({ Bucket, Region, Key: key, Body: body }, (err) => (err ? reject(err) : resolve()));
  });
}

function listBackups() {
  return new Promise((resolve, reject) => {
    cos.getBucket({ Bucket, Region, Prefix: 'backups/' }, (err, data) =>
      err ? reject(err) : resolve(data.Contents ?? []),
    );
  });
}

function deleteObjects(keys) {
  if (keys.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    cos.deleteMultipleObject({ Bucket, Region, Objects: keys.map((Key) => ({ Key })) }, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}

const body = fs.readFileSync(path.join('backups', filename));
await putObject(`backups/${filename}`, body);
console.log(`Uploaded backups/${filename}`);

const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
const objects = await listBackups();
const stale = objects.filter((obj) => new Date(obj.LastModified).getTime() < cutoff);
await deleteObjects(stale.map((obj) => obj.Key));
if (stale.length > 0) {
  console.log(`Deleted ${stale.length} stale backup(s) from COS: ${stale.map((o) => o.Key).join(', ')}`);
}

const remaining = await listBackups();
console.log('Current backups/ objects on COS:');
for (const obj of remaining) console.log(`  ${obj.Key}  (${obj.LastModified})`);
```

- [ ] **Step 2: 写 `deploy/backup-db.sh`**

```bash
#!/bin/bash
set -euo pipefail
cd /srv/sim-waimai

mkdir -p backups
STAMP=$(date +%F)
FILE="sim_waimai_${STAMP}.sql.gz"

docker compose -f deploy/docker-compose.yml exec -T db pg_dump -U postgres sim_waimai | gzip > "backups/${FILE}"

# Local retention: drop anything older than 7 days.
find backups -name '*.sql.gz' -mtime +7 -delete

# Upload today's dump to COS and let the script clean up stale COS-side backups too.
docker run --rm --env-file .env -v "$(pwd):/app" -w /app node:20-alpine node deploy/backup-upload.mjs "${FILE}"
```

- [ ] **Step 3: 写 `deploy/sim-waimai-backup.cron`**

```
0 3 * * * root /srv/sim-waimai/deploy/backup-db.sh >> /var/log/sim-waimai-backup.log 2>&1
```

- [ ] **Step 4: 本地语法检查（没有真实 COS/CVM 环境，只做静态检查；功能性验证放在 Task 13 的远程任务里）**

```bash
cd /Users/moonfair/Projects/sim-waimai
bash -n deploy/backup-db.sh && echo BACKUP_SH_SYNTAX_OK
node --check deploy/backup-upload.mjs && echo BACKUP_UPLOAD_SYNTAX_OK
```

Expected: 两行都输出对应的 `..._OK`。

- [ ] **Step 5: Commit**

```bash
chmod +x deploy/backup-db.sh
git add deploy/backup-db.sh deploy/backup-upload.mjs deploy/sim-waimai-backup.cron
git commit -m "feat(deploy): add daily Postgres backup script with 7-day retention"
```

---

### Task 5: `deploy/KNOWN-RISKS.md`

**Files:**
- Create: `deploy/KNOWN-RISKS.md`

**Interfaces:** 纯文档，无代码依赖。

- [ ] **Step 1: 写 `deploy/KNOWN-RISKS.md`**

```markdown
# 已知风险（有意不处理）

## CentOS 7 EOL

`sim-waimai.moonfair.cn` 部署在 CentOS Linux 7 (x86_64) 上。CentOS 7 已于 2024 年 6 月 30 日结束官方
维护，不再收到安全补丁。操作系统换代（迁移到 CentOS Stream / Rocky Linux / Ubuntu 等）工作量大、
风险高，本次安全加固（见 `docs/superpowers/specs/2026-07-14-security-hardening-design.md`）不处理，
只记录为已知风险，留待单独立项评估。

缓解措施（已落地，见同一份设计文档 + `docs/superpowers/plans/2026-07-14-security-hardening.md`）：
`firewalld` 主机防火墙 + `fail2ban` sshd 防护 + 腾讯云安全组，在不换操作系统的前提下缩小攻击面。
```

- [ ] **Step 2: Commit**

```bash
git add deploy/KNOWN-RISKS.md
git commit -m "docs(deploy): record CentOS 7 EOL as an accepted known risk"
```

---

### Task 6: `deploy/ADMIN-IP-WHITELIST.md`

**Files:**
- Create: `deploy/ADMIN-IP-WHITELIST.md`

**Interfaces:** 纯运行手册；Task 14 的远程任务会照着这份手册执行。**不修改 `deploy/nginx.conf`**——见 Global Constraints 里"不要把真实公网 IP 提交进这个仓库"。

- [ ] **Step 1: 写 `deploy/ADMIN-IP-WHITELIST.md`**

```markdown
# 管理后台 IP 白名单

`/api/admin/*` 只允许指定公网 IP 访问，其余一律拒绝。这条规则**不通过 `deploy/nginx.conf` 下发**——
真实 IP 是运维者的个人出口 IP，写进这个公开仓库的版本控制文件会把它永久暴露在 GitHub 历史里。
规则直接改在 CVM 上部署好的 `/etc/nginx/conf.d/sim-waimai.conf`，不进 git。

## 首次配置 / IP 变更后更新

1. 在**本机**（不是 CVM 上）查当前公网 IP：

   ```bash
   curl -s ifconfig.me
   ```

2. SSH 到 CVM，在 `/etc/nginx/conf.d/sim-waimai.conf` 里加一个 `location /api/admin/` block
   （Nginx 对前缀 location 按最长匹配优先，写在文件里靠前还是靠后不影响生效，放前面只是方便人读）：

   ```nginx
   location /api/admin/ {
       allow <YOUR_PUBLIC_IP>;
       deny all;
       proxy_pass http://127.0.0.1:3001;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```

   把 `<YOUR_PUBLIC_IP>` 换成第 1 步查到的地址（可以是单个 IP，也可以是 CIDR，如 `1.2.3.0/24`）。

3. `nginx -t && systemctl reload nginx`。

4. 验证：白名单外的来源访问 `https://sim-waimai.moonfair.cn/api/admin/...` 应该收到 403（或连接被
   拒绝）；白名单内的来源正常拿到响应。

## 动态 IP 场景

家庭/移动网络的公网 IP 通常会变。IP 变化后，管理后台会开始返回 403——这不是故障，重新跑一遍上面
1-3 步换成新 IP 即可。
```

- [ ] **Step 2: Commit**

```bash
git add deploy/ADMIN-IP-WHITELIST.md
git commit -m "docs(deploy): add admin IP whitelist runbook"
```

---

### Task 7: `deploy/CDN-MONITORING.md`

**Files:**
- Create: `deploy/CDN-MONITORING.md`

**Interfaces:** 纯操作清单；CDN 回源 IP 段模板里的具体网段留空，要求执行者当时去控制台查（见 Global
Constraints）。

- [ ] **Step 1: 写 `deploy/CDN-MONITORING.md`**

```markdown
# CDN（EdgeOne）与可用性监控——操作清单

这两项本质是控制台手动操作，无法通过 SSH/脚本自动化。下面按顺序列出需要在浏览器里完成的步骤；
标注"可自动化"的那一小步除外。验收标准是"没有上下文的人能照着做完"，不是要求这次执行时真的注册好
账号——账号/域名接入是用户自己后续在浏览器里完成的操作。

## EdgeOne CDN + WAF

1. 【手动，控制台】登录腾讯云 EdgeOne 控制台，接入域名 `sim-waimai.moonfair.cn`。
2. 【手动，控制台】按控制台向导把域名 DNS 切到 EdgeOne 提供的 CNAME（或改用 EdgeOne 的 NS 接入方式，
   以控制台实际提供的选项为准）。
3. 【手动，控制台】源站配置指回 CVM 的真实 IP（`106.55.231.31`），源站端口 443（保持 HTTPS 回源，
   证书由 CVM 上的 certbot 证书提供）。
4. 【手动，控制台】开启 WAF 基础防护规则（EdgeOne 自带的 Web 应用防火墙模块，按控制台默认推荐规则
   开启即可，不需要自定义规则）。
5. 【可自动化】接入 CDN 后，源站看到的所有请求都会来自 EdgeOne 的回源节点 IP，而不是访客的真实 IP，
   Nginx 必须显式信任这些节点、从 `X-Forwarded-For` 里取真实客户端 IP，否则限流
   （`server/src/middleware/rateLimit.ts`）和访问日志会把所有请求都记成同一批 EdgeOne 节点 IP。

   在腾讯云 EdgeOne 控制台当前页面查到官方最新的回源 IP 网段列表（网段会变化，以控制台/官方文档
   当时展示的为准，不要抄旧文档里的网段），按下面的模板加到 CVM 的
   `/etc/nginx/conf.d/sim-waimai.conf` 里 `server {` block 之前（`http` 作用域）：

   ```nginx
   # EdgeOne 回源 IP 段——从腾讯云 EdgeOne 控制台复制，网段更新时同步这里
   set_real_ip_from <EDGEONE_CIDR_1>;
   set_real_ip_from <EDGEONE_CIDR_2>;
   # ……按控制台列出的网段数量重复
   real_ip_header X-Forwarded-For;
   ```

   改完 `nginx -t && systemctl reload nginx`。

6. 【手动，验证】CDN 生效后，用 `curl -s https://sim-waimai.moonfair.cn/api/health` 确认站点仍可
   访问；在 CVM 上 `tail -f /var/log/nginx/access.log` 观察请求日志里的来源 IP 是否变回访客真实 IP
   （而不是全部变成同几个 EdgeOne 节点 IP），确认 `real_ip` 生效。

## 可用性监控（UptimeRobot）

1. 【手动，控制台】注册 UptimeRobot 账号（或复用已有账号）。
2. 【手动，控制台】新建一个 HTTP(s) 监控项，URL 填 `https://sim-waimai.moonfair.cn/api/health`，
   检测间隔用免费版最小间隔（通常是 5 分钟）。
3. 【手动，控制台】断言规则设为"响应体包含 `"ok":true`"（而不只是 HTTP 200），这样服务端进程假死
   但端口还开着的情况也能被发现。
4. 【手动，控制台】配置告警通道（邮箱/短信/Webhook，任选其一），确保站点下线时能实际收到通知。
```

- [ ] **Step 2: Commit**

```bash
git add deploy/CDN-MONITORING.md
git commit -m "docs(deploy): add CDN/WAF and uptime monitoring operational checklist"
```

---

### Task 8: 推送并在 CVM 上重新部署（接入验证码、日志限制、healthcheck）

**Files:** 无本地文件改动。

**Interfaces:**
- Consumes：Task 1-4 的全部本地改动（必须已经 push 到 `origin/main`）。
- Produces：CVM 上运行验证码/日志限制/healthcheck 都生效的容器，供 Task 9-13 使用。

**先决条件**：

```bash
cd /Users/moonfair/Projects/sim-waimai
git push origin main
```

- [ ] **Step 1: 拉取最新代码并重新构建**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'cd /srv/sim-waimai && git pull'
```

若报连接错误直接重跑；若 `/srv/sim-waimai` 当初是用 tarball 方式部署的（没有 `.git`），改用
`deploy/DEPLOY.md` 里记录的 tarball 重新下载+解压覆盖方式。

```bash
ssh -o ConnectTimeout=60 -o ServerAliveInterval=5 -o ServerAliveCountMax=15 txy \
  'cd /srv/sim-waimai && docker compose -f deploy/docker-compose.yml up -d --build'
```

Expected: 两个服务都 `Started`/`Healthy`。第一次带 healthcheck 的 `server` 容器状态从 `starting` 变
`healthy` 大概需要 10-30 秒。

- [ ] **Step 2: 验证 healthcheck 生效**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'sleep 15 && docker compose -f /srv/sim-waimai/deploy/docker-compose.yml ps'
```

Expected: `sim-waimai-server` 那一行的 STATUS 里包含 `(healthy)`。

- [ ] **Step 3: 验证 Docker 日志限制生效**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'docker inspect sim-waimai-db --format "{{json .HostConfig.LogConfig}}"'
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'docker inspect sim-waimai-server --format "{{json .HostConfig.LogConfig}}"'
```

Expected: 两条输出的 JSON 里都含 `"max-size":"10m"` 和 `"max-file":"3"`。

- [ ] **Step 4: 端到端验证验证码流程（真实域名，真实注册）**

```bash
CHALLENGE=$(curl -s https://sim-waimai.moonfair.cn/api/auth/captcha)
echo "$CHALLENGE"
TOKEN=$(echo "$CHALLENGE" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")
QUESTION=$(echo "$CHALLENGE" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).question))")
ANSWER=$(node -e "const [a,b]=process.argv[1].split('+').map(s=>Number(s.trim()));console.log(a+b)" "$QUESTION")
STAMP=$(date +%s)

curl -s -X POST https://sim-waimai.moonfair.cn/api/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"e2e_captcha_${STAMP}\",\"password\":\"Test1234!\",\"captchaToken\":\"${TOKEN}\",\"captchaAnswer\":${ANSWER}}"
echo
```

Expected: 返回创建的用户对象（含 `id`/`username`），不是 400。

- [ ] **Step 5: 验证不带验证码注册会被拒绝**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://sim-waimai.moonfair.cn/api/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"e2e_nocaptcha_${STAMP}\",\"password\":\"Test1234!\"}"
```

Expected: `400`。

- [ ] **Step 6: 确认既有登录限流没有被这次改动破坏**

```bash
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code} " -X POST https://sim-waimai.moonfair.cn/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"no_such_user_e2e","password":"whatever123"}'
done
echo
```

Expected: 前 10 次是 `401`，第 11、12 次变成 `429`。

---

### Task 9: 启用 certbot 自动续期

**Files:** 无本地文件改动。

**Interfaces:** 无——纯 CVM 状态变更。

- [ ] **Step 1: 确认续期 timer 当前处于 disabled（基线）**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'systemctl list-timers --all | grep certbot'
```

- [ ] **Step 2: 启用 timer**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'systemctl enable --now certbot-renew.timer'
```

- [ ] **Step 3: 验证 timer 已启用且排了下次触发时间**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'systemctl list-timers | grep certbot'
```

Expected: 有一行 `certbot-renew.timer`，NEXT 列是一个未来的具体时间，不是空。

- [ ] **Step 4: dry-run 验证续期机制本身真的能跑通（不是只验证 timer 排上了）**

```bash
ssh -o ConnectTimeout=30 -o ServerAliveInterval=5 -o ServerAliveCountMax=10 txy \
  'certbot renew --dry-run'
```

Expected: 输出包含 `Congratulations, all simulated renewals succeeded`。

---

### Task 10: 安装配置 fail2ban

**Files:** 无本地文件改动。

**Interfaces:** 无——纯 CVM 状态变更。

- [ ] **Step 1: 安装 fail2ban（EPEL 已装，直接可装）**

```bash
ssh -o ConnectTimeout=30 -o ServerAliveInterval=5 -o ServerAliveCountMax=10 txy \
  'yum install -y fail2ban'
```

Expected: 结尾 `Complete!`。

- [ ] **Step 2: 写 sshd jail 配置（官方默认参数，5 次失败/10 分钟窗口/封禁 1 小时）**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  "cat > /etc/fail2ban/jail.d/sshd.local" <<'EOF'
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/secure
maxretry = 5
findtime = 600
bantime = 3600
EOF
```

- [ ] **Step 3: 启动并设置开机自启**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'systemctl enable --now fail2ban'
```

- [ ] **Step 4: 验证服务状态和 jail 生效**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'systemctl is-active fail2ban'
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'fail2ban-client status sshd'
```

Expected: 第一条输出 `active`；第二条输出里包含 `Status for the jail: sshd`，`Currently banned: 0`
（刚启用还没有真实封禁记录是正常的）。

---

### Task 11: 启用 firewalld（严格按安全顺序，避免把自己锁在外面）

**Files:** 无本地文件改动。

**Interfaces:** 无——纯 CVM 状态变更。

**必须遵守的顺序**（来自设计文档的明确要求）：每一步都用独立的、全新的 SSH 连接执行（本计划里每条
`ssh txy '...'` 本来就是各自独立的新连接），改完规则立刻用新连接验证能不能连上，不能图省事把好几步
塞进一次交互式会话。

- [ ] **Step 1: 基线——确认 firewalld 当前是 inactive**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'systemctl is-active firewalld || true'
```

Expected: `inactive`（或非 0 退出码，视 systemd 版本而定，都算符合预期）。

- [ ] **Step 2: 启动 firewalld，立刻用新连接验证 SSH 没被断**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'systemctl enable --now firewalld'
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'echo FIREWALLD_STARTED_SSH_STILL_OK && firewall-cmd --state'
```

Expected: 第二条命令输出 `FIREWALLD_STARTED_SSH_STILL_OK` 和 `running`。如果这一步之后就连不上了，
说明 firewalld 默认 zone 没有放行 ssh，需要通过云厂商控制台的带外方式（VNC/Serial Console）修复，
不能继续往下走。

- [ ] **Step 3: 显式放行 ssh/http/https（幂等，即使默认 zone 已经放行 ssh 也不冲突），reload**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'firewall-cmd --permanent --add-service=ssh'
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'firewall-cmd --permanent --add-service=http'
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'firewall-cmd --permanent --add-service=https'
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'firewall-cmd --reload'
```

- [ ] **Step 4: 用全新连接验证 reload 之后 SSH 仍然正常，且规则列表符合预期**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'echo RELOAD_OK && firewall-cmd --list-services'
```

Expected: 输出 `RELOAD_OK`，接下来一行是 `http https ssh`（顺序可能不同，但只应该有这三个 service，
不多不少）。

---

### Task 12: 部署并验证数据库每日备份

**Files:** 无本地文件改动。

**Interfaces:**
- Consumes：Task 4 的 `deploy/backup-db.sh`/`deploy/backup-upload.mjs`/`deploy/sim-waimai-backup.cron`
  （随 Task 8 的 `git pull` 已经同步到 `/srv/sim-waimai`）。

- [ ] **Step 1: 安装 cron 定时任务**

```bash
scp -o ConnectTimeout=20 /Users/moonfair/Projects/sim-waimai/deploy/sim-waimai-backup.cron \
  txy:/etc/cron.d/sim-waimai-backup
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'chmod 644 /etc/cron.d/sim-waimai-backup && systemctl restart crond'
```

- [ ] **Step 2: 手动跑一次备份**

```bash
ssh -o ConnectTimeout=60 -o ServerAliveInterval=5 -o ServerAliveCountMax=15 txy \
  'cd /srv/sim-waimai && chmod +x deploy/backup-db.sh && bash deploy/backup-db.sh'
```

Expected: 输出里包含 `Uploaded backups/sim_waimai_<今天日期>.sql.gz` 和 `Current backups/ objects on
COS:` 后面跟着至少一行刚上传的文件。

- [ ] **Step 3: 验证本地文件存在**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'ls -la /srv/sim-waimai/backups/'
```

Expected: 能看到今天日期的 `sim_waimai_<日期>.sql.gz`，文件大小非 0。

- [ ] **Step 4: 验证本地 7 天保留期清理逻辑（伪造一个 8 天前的文件，不用真等）**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'touch -d "8 days ago" /srv/sim-waimai/backups/sim_waimai_dummy_old.sql.gz'
ssh -o ConnectTimeout=60 -o ServerAliveInterval=5 -o ServerAliveCountMax=15 txy \
  'cd /srv/sim-waimai && bash deploy/backup-db.sh'
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'ls /srv/sim-waimai/backups/ | grep dummy_old || echo DUMMY_CLEANED_UP'
```

Expected: 最后一条输出 `DUMMY_CLEANED_UP`（伪造的旧文件被 `find -mtime +7 -delete` 清理掉了）。

- [ ] **Step 5: 验证 COS 侧保留期清理逻辑（用 `BACKUP_RETENTION_DAYS=0` 强制立即触发，不用真等 7 天）**

```bash
ssh -o ConnectTimeout=60 -o ServerAliveInterval=5 -o ServerAliveCountMax=15 txy \
  'cd /srv/sim-waimai && LATEST=$(ls -t backups/*.sql.gz | head -1 | xargs basename) && \
   docker run --rm --env-file .env -e BACKUP_RETENTION_DAYS=0 -v "$(pwd):/app" -w /app \
   node:20-alpine node deploy/backup-upload.mjs "$LATEST"'
```

Expected: 输出里包含 `Deleted N stale backup(s) from COS`（N ≥ 1，因为 `BACKUP_RETENTION_DAYS=0`
让所有已存在的对象都算"过期"），紧跟着的 `Current backups/ objects on COS:` 列表应该只剩刚刚这次
重新上传的那一个文件。

---

### Task 13: 应用管理后台 IP 白名单

**Files:** 无本地文件改动（改的是 CVM 上部署好的 `/etc/nginx/conf.d/sim-waimai.conf`，不进 git——
见 `deploy/ADMIN-IP-WHITELIST.md`）。

**Interfaces:**
- Consumes：Task 6 的 `deploy/ADMIN-IP-WHITELIST.md` 运行手册。

- [ ] **Step 1: 在本机查当前公网 IP**

```bash
curl -s ifconfig.me
```

记下这个 IP（下面记作 `$MY_IP`，只在本地 shell 变量里用，不写进任何要提交的文件）。

- [ ] **Step 2: 在 CVM 上把白名单 block 插入部署好的 Nginx 配置**

```bash
MY_IP=$(curl -s ifconfig.me)
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  "python3 -c \"
import re
p = '/etc/nginx/conf.d/sim-waimai.conf'
conf = open(p).read()
block = '''    location /api/admin/ {
        allow ${MY_IP};
        deny all;
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
    }
'''
if 'location /api/admin/' not in conf:
    conf = conf.replace('    location /api/ {', block + '\n    location /api/ {', 1)
    open(p, 'w').write(conf)
    print('INSERTED')
else:
    print('ALREADY_PRESENT')
\""
```

Expected: 输出 `INSERTED`（重复执行本任务会输出 `ALREADY_PRESENT`，是幂等的）。

- [ ] **Step 3: 验证配置语法并重载**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
  'nginx -t && systemctl reload nginx'
```

Expected: `syntax is ok` / `test is successful`。

- [ ] **Step 4: 验证白名单内的当前 IP 能正常访问**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://sim-waimai.moonfair.cn/api/admin/review
```

Expected: 不是 `403`（具体状态码取决于是否带了合法的管理员登录态，未登录预期是 `401`；关键是不是
`403`，`403` 才代表被 IP 白名单拦了）。

- [ ] **Step 5: 记录到手册（可选，仅供人工参考，不提交 git）**

告知执行者：以后这台机器的公网 IP 变化后，重新跑一遍本任务的 Step 1-3（或按
`deploy/ADMIN-IP-WHITELIST.md` 手动操作）即可更新白名单。

---

## 收尾核对（对照设计文档"验收"章节逐条确认）

- [ ] `systemctl list-timers | grep certbot` 显示 timer 已启用且有下次触发时间 —— Task 9
- [ ] 手动跑一次 `deploy/backup-db.sh`，本地和 COS 上都出现当天的 `.sql.gz`；7 天前的旧备份被正确
  清理（用改短测试窗口的方式验证，不用真等 7 天）—— Task 12
- [ ] `systemctl status fail2ban` 为 active，`fail2ban-client status sshd` 能看到 jail 生效 —— Task 10
- [ ] `firewall-cmd --list-services` 只有 ssh/http/https；改动过程中 SSH 会话未断线 —— Task 11
- [ ] 用错误密码连续请求 `/api/auth/login` 超过 10 次后收到 429 —— 已有能力，Task 8 Step 6 复核
- [ ] 不带验证码或验证码错误调用 `/api/auth/register` 返回 400；正确验证码能正常注册 —— Task 1/2/8
- [ ] `docker inspect` 确认 `db`/`server` 容器的 `LogConfig` 里 `max-size`/`max-file` 生效 —— Task 8
- [ ] 从白名单外的 IP 访问 `/api/admin/*` 返回 403（或连接被拒绝），白名单内 IP 正常 —— Task 13
- [ ] `deploy/KNOWN-RISKS.md` 存在且包含 CentOS 7 EOL 的记录 —— Task 5
- [ ] CDN/监控两项：操作清单完整、可被没有上下文的人照做 —— Task 7
