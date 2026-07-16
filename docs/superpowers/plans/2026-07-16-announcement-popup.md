# 公告功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理员后台发布公告；所有登录用户在登录态就绪时弹窗看到最新一条未读公告，关闭后不再弹。

**Architecture:** 后端新增 `announcements` 表和 `/api/announcements` 路由（`latest` 给登录用户、`admin` 子路径给管理员发布/列表）；前端全局挂 `AnnouncementModal`，用 localStorage 按用户记录已读公告 id；新增 `/admin/announcements` 管理页。

**Tech Stack:** Hono + Drizzle(PG) + zod（server）、React 19 + Tailwind + vitest（web）、DTO 放 `@sim-waimai/shared`。

**Spec:** `docs/superpowers/specs/2026-07-16-announcement-popup-design.md`

## Global Constraints

- 公告是标题 + 纯文本正文；`title` 1–50 字、`body` 1–1000 字（trim 后非空），前后端都校验。
- 已读 key 固定为 `announcement:seen:<userId>`，存 localStorage。
- 管理接口挂 `/announcements/admin`（不动 `routes/admin.ts`），权限靠 `requireAdmin`。
- 时间字段序列化为 ISO 字符串（`.toISOString()`），与现有 DTO 约定一致。
- 中文错误文案，接口错误统一 `{ error: string }` 形态。
- 提交信息末尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 测试前置：数据库需已启动并迁移（`npm run db:up && npm -w server run migrate`）。

---

### Task 1: 后端 — DTO、announcements 表、路由与测试

**Files:**
- Modify: `shared/src/api.ts`（文件末尾追加 DTO）
- Modify: `server/src/db/schema.ts`（文件末尾追加表定义）
- Create: `server/src/routes/announcements.ts`
- Modify: `server/src/app.ts:14`（import）与 `server/src/app.ts:50`（挂载路由）
- Create: `server/drizzle/0004_*.sql`（由 drizzle-kit generate 生成，不手写）
- Test: `server/src/test/announcements.test.ts`

**Interfaces:**
- Consumes: `requireAuth` / `requireAdmin`（`server/src/middleware/auth.ts`，`c.get('user')` 为 `{ sub: string; username: string }`）、`validateJson`（`server/src/lib/validate.ts`）、`registerTestUser`（`server/src/test/testHelpers.ts`）。
- Produces:
  - `AnnouncementDto { id: string; title: string; body: string; createdAt: string }`、`AdminAnnouncementDto extends AnnouncementDto { createdByUsername: string }`（`@sim-waimai/shared`）。
  - `GET /api/announcements/latest`（requireAuth）→ `AnnouncementDto | null`；`GET /api/announcements/admin`（requireAdmin）→ `AdminAnnouncementDto[]` 倒序；`POST /api/announcements/admin`（requireAdmin，body `{ title, body }`）→ 201 + `AnnouncementDto`。

- [ ] **Step 1: 在 shared 包追加 DTO**

在 `shared/src/api.ts` 文件末尾追加：

```ts
/** 平台公告：登录用户弹窗展示最新一条。 */
export interface AnnouncementDto {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

/** 管理端公告列表项，多带发布人用户名。 */
export interface AdminAnnouncementDto extends AnnouncementDto {
  createdByUsername: string;
}
```

- [ ] **Step 2: 在 schema 追加 announcements 表**

在 `server/src/db/schema.ts` 文件末尾追加（无生效/下线状态位——始终只取 `createdAt` 最新一条）：

```ts
export const announcements = pgTable('announcements', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

（`pgTable`/`uuid`/`text`/`timestamp` 均已在该文件 import。）

- [ ] **Step 3: 生成并执行迁移**

Run: `npm run db:up && npm -w server run generate && npm -w server run migrate`
Expected: 生成 `server/drizzle/0004_*.sql`（内容为 `CREATE TABLE "announcements" ...` 及外键），migrate 无报错退出。

- [ ] **Step 4: 写失败的路由测试**

创建 `server/src/test/announcements.test.ts`：

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { AdminAnnouncementDto, AnnouncementDto } from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { announcements, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const admin = { username: `t_ann_a_${stamp}`, password: 'secret123' };
const customer = { username: `t_ann_c_${stamp}`, password: 'secret123' };
let adminCookie = '';
let customerCookie = '';
let adminId = '';
let customerId = '';
let savedAdmins: string | undefined;

async function register(cred: { username: string; password: string }) {
  const res = await registerTestUser(app, cred);
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  const user = (await res.json()) as { id: string; isAdmin?: boolean };
  return { cookie, user };
}

function post(cookie: string, body: unknown) {
  return app.request('/api/announcements/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  // lib/admin.ts 惰性读 process.env，运行期追加管理员即可生效（同 moderation.test.ts）。
  savedAdmins = process.env.ADMIN_USERNAMES;
  process.env.ADMIN_USERNAMES = [savedAdmins, admin.username].filter(Boolean).join(',');
  const a = await register(admin);
  adminCookie = a.cookie;
  adminId = a.user.id;
  expect(a.user.isAdmin).toBe(true);
  const c = await register(customer);
  customerCookie = c.cookie;
  customerId = c.user.id;
});

afterAll(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = savedAdmins;
  await db.delete(announcements).where(eq(announcements.createdBy, adminId));
  await db.delete(users).where(inArray(users.id, [adminId, customerId]));
  await pool.end();
});

describe('announcements', () => {
  it('latest 未登录 401', async () => {
    expect((await app.request('/api/announcements/latest')).status).toBe(401);
  });

  it('发布与管理列表需要管理员', async () => {
    expect((await post('', { title: 'a', body: 'b' })).status).toBe(401);
    expect((await post(customerCookie, { title: 'a', body: 'b' })).status).toBe(403);
    const list = await app.request('/api/announcements/admin', {
      headers: { Cookie: customerCookie },
    });
    expect(list.status).toBe(403);
  });

  it('发布校验：空标题 / 超长正文拒绝', async () => {
    expect((await post(adminCookie, { title: '  ', body: '内容' })).status).toBe(400);
    expect((await post(adminCookie, { title: '标题', body: 'x'.repeat(1001) })).status).toBe(400);
  });

  it('latest 返回最新一条；admin 列表倒序且带发布人', async () => {
    const resA = await post(adminCookie, { title: '第一条', body: '正文A' });
    expect(resA.status).toBe(201);
    // createdAt 用于排序，隔开两次插入避免同刻。
    await new Promise((r) => setTimeout(r, 20));
    const resB = await post(adminCookie, { title: '第二条', body: '正文B\n第二行' });
    expect(resB.status).toBe(201);
    const b = (await resB.json()) as AnnouncementDto;

    const latest = (await (
      await app.request('/api/announcements/latest', { headers: { Cookie: customerCookie } })
    ).json()) as AnnouncementDto;
    expect(latest.id).toBe(b.id);
    expect(latest.title).toBe('第二条');
    expect(latest.body).toBe('正文B\n第二行');

    const list = (await (
      await app.request('/api/announcements/admin', { headers: { Cookie: adminCookie } })
    ).json()) as AdminAnnouncementDto[];
    const mine = list.filter((x) => x.createdByUsername === admin.username);
    expect(mine.map((x) => x.title)).toEqual(['第二条', '第一条']);
  });
});
```

> 注意：dev 库是共享的，可能已有其他公告，所以不断言「无公告返回 null」，只断言我们刚发布的是最新一条。

- [ ] **Step 5: 跑测试确认失败**

Run: `npm -w server run test -- announcements`
Expected: FAIL —— `latest 未登录 401` 之后的用例 404（路由不存在，`{"error":"接口不存在"}`）。

- [ ] **Step 6: 实现路由**

创建 `server/src/routes/announcements.ts`：

```ts
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AdminAnnouncementDto, AnnouncementDto } from '@sim-waimai/shared';
import { db } from '../db/client';
import { announcements, users } from '../db/schema';
import { validateJson } from '../lib/validate';
import { requireAdmin, requireAuth } from '../middleware/auth';

const LIST_LIMIT = 100;

const createSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(50, '标题不能超过50字'),
  body: z.string().trim().min(1, '正文不能为空').max(1000, '正文不能超过1000字'),
});

function toDto(row: typeof announcements.$inferSelect): AnnouncementDto {
  return { id: row.id, title: row.title, body: row.body, createdAt: row.createdAt.toISOString() };
}

export const announcementRoutes = new Hono()
  // 只取最新一条：用户积压多条未读也只会看到它（产品要求，避免连环弹窗）。
  .get('/latest', requireAuth, async (c) => {
    const [row] = await db
      .select()
      .from(announcements)
      .orderBy(desc(announcements.createdAt))
      .limit(1);
    return c.json(row ? toDto(row) : null);
  })
  .get('/admin', requireAdmin, async (c) => {
    const rows = await db
      .select({ announcement: announcements, createdByUsername: users.username })
      .from(announcements)
      .innerJoin(users, eq(users.id, announcements.createdBy))
      .orderBy(desc(announcements.createdAt))
      .limit(LIST_LIMIT);
    const dtos: AdminAnnouncementDto[] = rows.map((r) => ({
      ...toDto(r.announcement),
      createdByUsername: r.createdByUsername,
    }));
    return c.json(dtos);
  })
  .post('/admin', requireAdmin, validateJson(createSchema), async (c) => {
    const user = c.get('user');
    const { title, body } = c.req.valid('json');
    const [row] = await db
      .insert(announcements)
      .values({ title, body, createdBy: user.sub })
      .returning();
    return c.json(toDto(row!), 201);
  });
```

在 `server/src/app.ts` 中挂载：import 区（第 6 行 `adminRoutes` 之后）加

```ts
import { announcementRoutes } from './routes/announcements';
```

路由区（第 50 行 `app.route('/admin', adminRoutes);` 之后）加

```ts
app.route('/announcements', announcementRoutes);
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npm -w server run test -- announcements`
Expected: PASS（4 个用例全绿）。再跑全量 `npm run test:server` 确认没破坏其他用例。

- [ ] **Step 8: Commit**

```bash
git add shared/src/api.ts server/src/db/schema.ts server/drizzle server/src/routes/announcements.ts server/src/app.ts server/src/test/announcements.test.ts
git commit -m "feat(server): 公告表与公告接口（latest/管理员发布）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 前端 — 已读判定纯函数 announcementSeen

**Files:**
- Create: `src/lib/announcementSeen.ts`
- Test: `src/lib/announcementSeen.test.ts`

**Interfaces:**
- Consumes: 浏览器 `localStorage`（测试里用 `vi.stubGlobal` 打桩）。
- Produces: `isUnseen(userId: string, announcementId: string): boolean`、`markSeen(userId: string, announcementId: string): void`，key 格式 `announcement:seen:<userId>`。

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/announcementSeen.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isUnseen, markSeen } from './announcementSeen';

const store = new Map<string, string>();

function fakeStorage(): Storage {
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
}

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', fakeStorage());
});

describe('announcementSeen', () => {
  it('从未标记过的公告是未读', () => {
    expect(isUnseen('u1', 'a1')).toBe(true);
  });

  it('markSeen 后同一条公告不再未读', () => {
    markSeen('u1', 'a1');
    expect(isUnseen('u1', 'a1')).toBe(false);
  });

  it('已读旧公告后，新公告仍是未读（只记最新一条）', () => {
    markSeen('u1', 'a1');
    expect(isUnseen('u1', 'a2')).toBe(true);
  });

  it('不同用户的已读互不影响', () => {
    markSeen('u1', 'a1');
    expect(isUnseen('u2', 'a1')).toBe(true);
  });

  it('localStorage 不可用时视为未读且不抛错', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage);
    expect(isUnseen('u1', 'a1')).toBe(true);
    expect(() => markSeen('u1', 'a1')).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/announcementSeen.test.ts`
Expected: FAIL —— 模块不存在（Cannot find module './announcementSeen'）。

- [ ] **Step 3: 实现**

创建 `src/lib/announcementSeen.ts`：

```ts
/** 已读公告记录：localStorage 按用户分 key，只存「最后已读的公告 id」。 */
const key = (userId: string) => `announcement:seen:${userId}`;

export function isUnseen(userId: string, announcementId: string): boolean {
  try {
    return localStorage.getItem(key(userId)) !== announcementId;
  } catch {
    // localStorage 不可用（隐私模式等）：宁可多弹一次也不报错
    return true;
  }
}

export function markSeen(userId: string, announcementId: string): void {
  try {
    localStorage.setItem(key(userId), announcementId);
  } catch {
    // 写不进去就算了，下次会再弹一次
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/announcementSeen.test.ts`
Expected: PASS（5 个用例全绿）。再跑 `npm run test:web` 确认整体绿。

- [ ] **Step 5: Commit**

```bash
git add src/lib/announcementSeen.ts src/lib/announcementSeen.test.ts
git commit -m "feat(web): 公告已读判定纯函数（localStorage 按用户分 key）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 前端 — AnnouncementModal 全局弹窗

**Files:**
- Create: `src/components/AnnouncementModal.tsx`
- Modify: `src/App.tsx`（import + 在 `</Routes>` 之后挂载）

**Interfaces:**
- Consumes: `useAuth()`（`src/context/AuthContext.tsx`，`user: UserDto | null`）、`api.get`（`src/lib/api.ts`）、`isUnseen`/`markSeen`（Task 2）、`AnnouncementDto`（Task 1）。
- Produces: `<AnnouncementModal />` 无 props 组件，挂在 AuthProvider 内任意位置即生效。

- [ ] **Step 1: 实现组件**

> 项目无组件测试基建（无 jsdom/testing-library），本组件的可测逻辑已抽到 Task 2 的纯函数；组件本身靠 typecheck + Task 5 端到端验证。

创建 `src/components/AnnouncementModal.tsx`：

```tsx
import { useEffect, useState } from 'react';
import type { AnnouncementDto } from '@sim-waimai/shared';
import { useAuth } from '../context/AuthContext';
import { isUnseen, markSeen } from '../lib/announcementSeen';
import { api } from '../lib/api';

/** 登录态就绪（登录或会话恢复）后弹出最新一条未读公告，点确认或遮罩关闭并记为已读。 */
export default function AnnouncementModal() {
  const { user } = useAuth();
  const [announcement, setAnnouncement] = useState<AnnouncementDto | null>(null);

  useEffect(() => {
    if (!user) {
      setAnnouncement(null);
      return;
    }
    let cancelled = false;
    api
      .get<AnnouncementDto | null>('/announcements/latest')
      .then((latest) => {
        if (!cancelled && latest && isUnseen(user.id, latest.id)) setAnnouncement(latest);
      })
      .catch(() => {
        // 公告非关键路径，拉取失败静默忽略
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user || !announcement) return null;

  const close = () => {
    markSeen(user.id, announcement.id);
    setAnnouncement(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-8"
      onClick={close}
    >
      <div
        className="w-full max-w-[360px] bg-white dark:bg-gray-800 rounded-2xl p-5 flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-gray-900 dark:text-gray-100 font-bold text-base text-center">
          📢 {announcement.title}
        </h2>
        <p className="text-gray-600 dark:text-gray-300 text-sm mt-3 whitespace-pre-wrap overflow-y-auto flex-1">
          {announcement.body}
        </p>
        <button
          className="mt-4 w-full bg-orange-500 text-white py-3 rounded-2xl font-black active:scale-95 transition-transform"
          onClick={close}
        >
          知道了
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 挂到 App.tsx**

`src/App.tsx` import 区加：

```tsx
import AnnouncementModal from './components/AnnouncementModal';
```

在 `</Routes>` 闭合标签之后、`</CartProvider>` 之前加一行：

```tsx
<AnnouncementModal />
```

- [ ] **Step 3: typecheck + lint 通过**

Run: `npm run build && npm run lint`
Expected: `tsc -b` 与 vite build 无错误，oxlint 无新告警。

- [ ] **Step 4: Commit**

```bash
git add src/components/AnnouncementModal.tsx src/App.tsx
git commit -m "feat(web): 全局公告弹窗，登录态就绪弹最新一条未读公告

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 前端 — 公告管理页与入口

**Files:**
- Create: `src/pages/AdminAnnouncements.tsx`
- Modify: `src/App.tsx`（import + `/admin/announcements` 路由）
- Modify: `src/pages/AdminReview.tsx:76`（标题行加入口链接）

**Interfaces:**
- Consumes: `useApi`（`src/hooks/useApi.ts`）、`api.post`、`AdminAnnouncementDto`（Task 1）、`RequireAdmin`。
- Produces: 路由 `/admin/announcements`；AdminReview 头部「📢 公告管理 ›」入口。

- [ ] **Step 1: 实现管理页**

创建 `src/pages/AdminAnnouncements.tsx`（结构与消息模式沿用 AdminReview）：

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AdminAnnouncementDto } from '@sim-waimai/shared';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';

const TITLE_MAX = 50;
const BODY_MAX = 1000;

export default function AdminAnnouncements() {
  const navigate = useNavigate();
  const { data: items, loading, error, reload } =
    useApi<AdminAnnouncementDto[]>('/announcements/admin');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 2500);
  };

  const canPublish = !submitting && title.trim().length > 0 && body.trim().length > 0;

  const publish = async () => {
    setSubmitting(true);
    try {
      await api.post('/announcements/admin', { title: title.trim(), body: body.trim() });
      setTitle('');
      setBody('');
      flash('发布成功 ✓');
      reload();
    } catch (err) {
      flash(err instanceof Error ? err.message : '发布失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900 pb-10">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 px-4 pt-10 pb-4 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <button
            className="w-8 h-8 flex items-center justify-center text-gray-600 dark:text-gray-300"
            onClick={() => navigate(-1)}
          >
            ←
          </button>
          <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg">公告管理</h1>
        </div>
      </div>

      {message && (
        <p className="text-center text-xs text-orange-500 py-2 bg-orange-50 dark:bg-orange-500/10">
          {message}
        </p>
      )}

      {/* 发布表单 */}
      <div className="mx-4 mt-4 bg-white dark:bg-gray-800 rounded-2xl p-4 space-y-3">
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
            标题（{title.trim().length}/{TITLE_MAX}）
          </label>
          <input
            type="text"
            maxLength={TITLE_MAX}
            className="w-full border border-gray-100 dark:border-gray-700 dark:bg-gray-900 rounded-lg p-2.5 text-sm text-gray-700 dark:text-gray-200 outline-none focus:border-orange-300"
            placeholder="请输入公告标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
            正文（{body.trim().length}/{BODY_MAX}）
          </label>
          <textarea
            maxLength={BODY_MAX}
            rows={5}
            className="w-full border border-gray-100 dark:border-gray-700 dark:bg-gray-900 rounded-lg p-2.5 text-sm text-gray-700 dark:text-gray-200 resize-none outline-none focus:border-orange-300"
            placeholder="请输入公告正文（保留换行）"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <button
          className="w-full bg-orange-500 text-white py-3 rounded-2xl font-black active:scale-95 transition-transform disabled:opacity-50"
          disabled={!canPublish}
          onClick={publish}
        >
          {submitting ? '发布中…' : '发布公告'}
        </button>
        <p className="text-gray-300 dark:text-gray-600 text-xs text-center">
          发布后所有用户下次打开时会弹窗看到最新一条公告
        </p>
      </div>

      {/* 历史列表 */}
      <div className="px-4 mt-4">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl h-20 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-10">{error}</p>
        ) : (items ?? []).length === 0 ? (
          <div className="py-12 text-center text-gray-400 dark:text-gray-500">
            <div className="text-5xl mb-3">📢</div>
            <p className="text-sm">还没有发布过公告</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items!.map((item, index) => (
              <div key={item.id} className="bg-white dark:bg-gray-800 rounded-2xl p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-gray-900 dark:text-gray-100 text-sm">
                    {item.title}
                  </span>
                  {index === 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-50 dark:bg-orange-500/10 text-orange-500">
                      当前生效
                    </span>
                  )}
                </div>
                <p className="text-gray-500 dark:text-gray-400 text-xs mt-1 whitespace-pre-wrap line-clamp-3">
                  {item.body}
                </p>
                <p className="text-gray-400 dark:text-gray-500 text-xs mt-2">
                  {new Date(item.createdAt).toLocaleString('zh-CN')} · {item.createdByUsername}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 加路由与入口**

`src/App.tsx` import 区加：

```tsx
import AdminAnnouncements from './pages/AdminAnnouncements';
```

在 `/admin/review` 路由之后加：

```tsx
<Route
  path="/admin/announcements"
  element={
    <RequireAdmin>
      <AdminAnnouncements />
    </RequireAdmin>
  }
/>
```

`src/pages/AdminReview.tsx` 头部标题行（`<h1 ...>审核管理</h1>` 所在的 flex 容器内、h1 之后）加入口：

```tsx
<button
  type="button"
  className="ml-auto text-xs text-orange-500"
  onClick={() => navigate('/admin/announcements')}
>
  📢 公告管理 ›
</button>
```

- [ ] **Step 3: typecheck + lint 通过**

Run: `npm run build && npm run lint`
Expected: 无错误、无新告警。

- [ ] **Step 4: Commit**

```bash
git add src/pages/AdminAnnouncements.tsx src/pages/AdminReview.tsx src/App.tsx
git commit -m "feat(web): 公告管理页（发布 + 历史列表）与审核后台入口

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 端到端验证

**Files:** 无新增/修改（发现问题回上面任务修）。

- [ ] **Step 1: 全量测试与构建**

Run: `npm run test:server && npm run test:web && npm run build && npm run lint`
Expected: 全部通过。

- [ ] **Step 2: /verify 实跑验证**

用 `/verify` skill 启动 `npm run dev`（需 `npm run db:up`），按 spec 验证闭环：

1. 管理员账号（`ADMIN_USERNAMES` 内用户）登录 → 个人页/审核管理 → 进入「公告管理」→ 发布一条公告 → 列表出现且标「当前生效」。
2. 顾客账号登录 → 弹窗显示该公告（标题 + 正文换行保留）→ 点「知道了」关闭 → 刷新页面不再弹。
3. 点遮罩空白处关闭路径同样生效（可先清 localStorage 对应 key 重试）。
4. 管理员再发一条新公告 → 顾客刷新 → 只弹新的一条（不会连弹两条）。
5. 未登录访客浏览首页 → 不弹窗、无 401 报错弹出（请求只在登录态发起）。

Expected: 五条全部符合。

- [ ] **Step 3: 完成分支收尾**

验证通过后走 superpowers:finishing-a-development-branch 流程。
