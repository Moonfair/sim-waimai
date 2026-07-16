# 顾客视角店铺页分享按钮 设计

日期：2026-07-16

## 背景与目标

商家店铺管理页已有「分享店铺」按钮（见 `2026-07-16-merchant-share-shop-design.md`）。本次把同样的分享能力加到顾客视角店铺页（`/restaurant/:id`，`src/pages/Restaurant.tsx`），让任何浏览店铺的用户也能一键复制店铺链接。

## 方案

纯前端改动，涉及三个文件：新建 `src/lib/share.ts`，修改 `src/pages/Restaurant.tsx` 与 `src/pages/MerchantEdit.tsx`。

### 公共帮手 `src/lib/share.ts`

复制逻辑即将出现第二处，抽成共享函数：

```ts
/** 复制餐厅顾客页链接到剪贴板，返回是否成功。 */
export async function copyRestaurantLink(id: string): Promise<boolean>
```

- 构链：`new URL(`${import.meta.env.BASE_URL}restaurant/${id}`, window.location.origin).toString()`。
- 首选 `navigator.clipboard.writeText`；失败降级隐藏 textarea + `document.execCommand('copy')`；两者都失败返回 `false`。
- `MerchantEdit.tsx` 的 `handleShare` 改为调用该函数，只保留按钮 UI 与反馈 state（行为不变）。

### 顾客页按钮（Restaurant.tsx）

- 位置：横幅右上角，收藏按钮左侧，同样式圆形按钮（`bg-black/20 backdrop-blur-sm rounded-full`），图标 `🔗`。
- 反馈：复制成功图标变 `✓`（白色），失败变 `✕`，约 2 秒后还原（局部 state + `setTimeout`）。
- 可见性：始终显示——顾客页能打开即说明店铺已过审可见，无需条件。
- 无障碍：`aria-label="分享餐厅"`。

## 错误处理

复制失败仅图标反馈（`✕`），不阻断页面。

## 测试

- 帮手函数逻辑简单（构链 + 剪贴板调用），不写单测；以 `/verify` 实际运行验证：顾客页按钮出现、点击复制内容正确、商家页行为回归不变。
