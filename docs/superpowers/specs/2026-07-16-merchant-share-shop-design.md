# 商家店铺页分享按钮 设计

日期：2026-07-16

## 背景与目标

商家在店铺管理页（`/merchant/:id`，`src/pages/MerchantEdit.tsx`）目前没有办法把自己的店铺分享给别人。目标：加一个「分享店铺」按钮，点击后复制顾客视角链接到剪贴板；任何人点开链接可直接进入该店铺的顾客页。

## 前提确认

- 顾客页路由 `/restaurant/:id` 无需登录（App.tsx 中未包 `RequireAuth`）。
- 部署侧 nginx 已配置 `try_files $uri /index.html`（`deploy/nginx.conf:19`），SPA 深链接直接可达。
- 分享形式：仅复制链接（不用 Web Share API、不做二维码/分享面板）。

## 方案

纯前端改动，只改 `src/pages/MerchantEdit.tsx` 一个文件，不改后端。

### 按钮位置与可见性

- 位于头部「查看顾客视角 ›」旁，同风格文字按钮，文案「🔗 分享店铺」。
- 仅当 `shop.reviewStatus === 'approved'` 时渲染——未过审店铺对顾客不可见，分享出去会是「店铺不存在」，因此不显示按钮。

### 链接构造

```ts
new URL(`${import.meta.env.BASE_URL}restaurant/${shop.id}`, window.location.origin).toString()
```

兼容 `BrowserRouter basename={import.meta.env.BASE_URL}`。

### 复制与反馈

- 首选 `navigator.clipboard.writeText`。
- 失败时（非安全上下文等）降级：隐藏 textarea + `document.execCommand('copy')`。
- 复制成功后按钮文案变「已复制 ✓」，约 2 秒后还原（局部 state + `setTimeout`，沿用页面现有消息模式，不引入 toast 组件）。
- 两种方式都失败时按钮短暂显示「复制失败」。

## 错误处理

复制失败不阻断页面，仅按钮文案反馈。无其它错误路径。

## 测试

- 逻辑仅一行链接拼接 + 剪贴板调用，不单独抽函数做单测。
- 以 `/verify` 实际运行 App 点按验证：按钮出现条件、复制内容正确、点开链接进入顾客页。
