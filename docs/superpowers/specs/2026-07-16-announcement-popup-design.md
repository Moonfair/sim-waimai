# 公告功能 设计

日期：2026-07-16

## 背景与目标

平台需要向用户发布运营公告。管理员在后台发布公告后，用户在登录态就绪时（登录动作或会话恢复）弹窗看到**最新一条**未读公告，点「知道了」按钮或点遮罩空白处关闭，之后不再重复弹出。用户积压多条未读公告时也只弹最新一条，避免连续关闭一堆弹窗。

## 已确认的需求决策

- 发布方式：管理员后台页面发布（走 `requireAdmin` 接口）。
- 已读状态：存 localStorage，按用户分 key（`announcement:seen:<userId>`），不改 users 表。换设备/清缓存会重新弹一次，可接受。
- 内容形态：标题 + 纯文本正文（保留换行），不支持 Markdown。
- 受众：所有登录用户（顾客、商家、管理员）。
- 触发时机：登录态就绪即检查，包括刷新/重开页面的会话恢复，不限于登录那一刻。

## 数据模型

`server/src/db/schema.ts` 新增 `announcements` 表：

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` primaryKey defaultRandom | 随 users 表风格 |
| `title` | `text` notNull | 标题 |
| `body` | `text` notNull | 纯文本正文，保留换行 |
| `createdBy` | `uuid` references users.id, notNull | 发布的管理员 |
| `createdAt` | `timestamp withTimezone` notNull defaultNow | 发布时间 |

「最新一条」= `createdAt` 倒序第一条（同刻并发发布极罕见，不额外处理）。无生效/下线状态位：发新公告即自然覆盖旧公告。迁移用 `npm -w server run generate` + `migrate` 生成执行。

## API

DTO 定义在 `shared` 包，遵循现有约定（时间序列化为 ISO 字符串）。

```ts
interface AnnouncementDto {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}
```

新建 `server/src/routes/announcements.ts`，在 `app.ts` 挂载 `app.route('/announcements', announcementRoutes)`：

- `GET /api/announcements/latest` — `requireAuth`。返回最新一条 `AnnouncementDto`，无公告时返回 `null`（HTTP 200）。
- `GET /api/announcements/admin` — `requireAdmin`。倒序返回全部公告（含 `createdBy` 对应的 username，字段 `createdByUsername`），供管理页历史列表。上限 100 条（沿用 admin.ts 的 `LIST_LIMIT` 惯例）。
- `POST /api/announcements/admin` — `requireAdmin`。zod 校验：`title` 1–50 字、`body` 1–1000 字（trim 后非空）。创建并返回新公告。

> 管理接口挂在 `/announcements/admin` 而非 `/admin/announcements`，避免动 admin.ts 现有审核路由文件；权限语义由 `requireAdmin` 保证，不依赖路径前缀。

## 前端：弹窗组件

新组件 `src/components/AnnouncementModal.tsx`，挂在 `App.tsx` 的 `<Routes>` 旁（`AuthProvider` 内，所有页面共享）。

逻辑：

1. `useAuth()` 拿 `user`；`user` 为 null 或 loading 时不做任何事。
2. `user` 就绪后请求 `GET /announcements/latest`；请求失败静默忽略（公告非关键路径）。
3. 读 `localStorage.getItem('announcement:seen:' + user.id)`，与最新公告 `id` 比对；不相等才弹窗。
4. 关闭（点「知道了」或点遮罩空白处）时 `localStorage.setItem('announcement:seen:' + user.id, id)` 并隐藏。
5. 用户切换账号（`user.id` 变化）时重新走一遍检查。

已读比对与标记抽成纯函数模块 `src/lib/announcementSeen.ts`（`isUnseen(userId, announcementId)` / `markSeen(userId, announcementId)`），便于单测。

样式沿用现有弹层模式（参考 `AddressEditSheet` / `MenuItemOptionsSheet`）：`fixed inset-0 z-50 bg-black/40` 遮罩点击关闭 + 居中卡片；卡片内标题、`whitespace-pre-wrap` 正文（超长时 `max-h` + 内部滚动）、底部「知道了」主按钮。卡片自身点击 `stopPropagation` 防止误关。

## 前端：管理页

新页面 `src/pages/AdminAnnouncements.tsx`，路由 `/admin/announcements`（`RequireAdmin` 包裹），在 `AdminReview` 页头部加入口链接（双向可达）。

- 顶部发布表单：标题输入框 + 正文多行文本框 + 「发布」按钮；前端同样限制 50/1000 字；发布成功后清空表单并刷新列表。
- 下方历史列表：倒序展示标题、正文摘要、发布时间、发布人 username。
- 发布失败展示接口错误信息，沿用现有 admin 页面的消息展示模式。

## 错误处理

- 弹窗侧：`/announcements/latest` 请求失败静默忽略，不影响正常使用；localStorage 不可用（隐私模式等）时 try/catch 包裹，最坏情况是每次都弹，可接受。
- 管理页：接口错误正常展示给管理员。

## 测试

- server（沿用 `server/src/test` 现有模式）：
  - 未登录访问 `latest` → 401；登录后无公告 → null；发布两条后 → 返回较新一条。
  - 非管理员 POST → 403；管理员 POST 校验（空标题/超长 body 拒绝）；创建成功后 admin 列表可见。
- web（vitest）：`announcementSeen.ts` 纯函数测试——未读判定、标记后不再未读、不同用户 key 互不影响。
- 端到端以 `/verify` 实际跑 App：发布公告 → 顾客账号登录弹窗 → 关闭后刷新不再弹 → 再发新公告刷新又弹且只弹最新一条。
