# 全站图片点击放大与审核列表缩略图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全站所有图片点击后弹出全屏放大预览；审核列表页每条记录展示待审图片的小缩略图。

**Architecture:** 新建可复用组件 `<ZoomableImage>` 作为 `<img>` 的 drop-in 替代（内部调用 `assetUrl()` 解析、自管放大状态、portal 渲染预览层），替换全站 12 处 `<img>`。后端 `ModerationItemDto` 增加 `image` 字段（restaurant 取 `bannerImage`、menuItem 取 `image`），审核列表页有图时用缩略图替代 emoji 方块。

**Tech Stack:** React 18 + TypeScript + Tailwind（web）、Hono + Drizzle（server）、vitest（前后端测试）。

**Spec:** `docs/superpowers/specs/2026-07-16-zoomable-image-and-review-thumbnail-design.md`

## Global Constraints

- 交互决策：图片点击放大须 `stopPropagation()`，卡片其余区域保持原有跳转/加购行为。
- 只做单图放大：全屏遮罩 + 点遮罩/×/Esc 关闭；不做多图切换、不做缩放拖拽。
- 组件用 `export default function`（与 `src/components/` 现有 14 个组件一致）。
- 提交信息用中文、conventional commits 风格（如 `feat(web): …`），结尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 验证命令：typecheck `npx tsc -b`；lint `npm run lint`；web 测试 `npm run test:web`；server 测试 `npm run test:server`（需 `npm run db:up` 先起 Postgres）。

---

### Task 1: assetUrl blob:/data: 直通 + ZoomableImage 组件

`MerchantHome.tsx` 的横幅预览是 `URL.createObjectURL` 生成的 `blob:` URL。现有 `assetUrl()` 只放行 `http(s)` 和 `/api/`，会给 `blob:` 错误拼上 COS 前缀。ZoomableImage 内部统一调用 `assetUrl()`，所以先修 `assetUrl`。

**Files:**
- Modify: `src/lib/assetUrl.ts`
- Create: `src/lib/assetUrl.test.ts`
- Create: `src/components/ZoomableImage.tsx`

**Interfaces:**
- Consumes: `assetUrl(path: string): string`（已存在）
- Produces: `ZoomableImage` 默认导出组件，props `{ src: string; alt: string; className?: string }`。`src` 传原始 path（COS key / 绝对 URL / `blob:` / `data:` / `/api/` 路径），调用方**不要**再包 `assetUrl()`。后续 Task 2/4 全部依赖此接口。

- [ ] **Step 1: 写 assetUrl 直通的失败测试**

创建 `src/lib/assetUrl.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { assetUrl } from './assetUrl';

describe('assetUrl', () => {
  it('blob: 与 data: URL 原样直通', () => {
    expect(assetUrl('blob:http://localhost:5173/abc-123')).toBe('blob:http://localhost:5173/abc-123');
    expect(assetUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
  });

  it('绝对 URL 与 /api/ 路径原样直通', () => {
    expect(assetUrl('https://cos.example.com/x.jpg')).toBe('https://cos.example.com/x.jpg');
    expect(assetUrl('/api/uploads/x.jpg')).toBe('/api/uploads/x.jpg');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/assetUrl.test.ts`
Expected: FAIL —— `blob:` 用例失败（返回值被拼上了 COS 前缀，形如 `/blob:http://…`）；其余用例通过。

- [ ] **Step 3: 修改 assetUrl 放行 blob:/data:**

`src/lib/assetUrl.ts` 中：

```ts
  // Absolute URL (e.g. Tencent COS object) — use as-is.
  if (/^https?:\/\//.test(path)) return path;
```

改为：

```ts
  // Absolute/self-contained URL (COS object, local object URL, inline data) — use as-is.
  if (/^(https?:\/\/|blob:|data:)/.test(path)) return path;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/assetUrl.test.ts`
Expected: PASS（2 个用例全绿）

- [ ] **Step 5: 创建 ZoomableImage 组件**

创建 `src/components/ZoomableImage.tsx`（完整文件）：

```tsx
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { assetUrl } from '../lib/assetUrl';

interface ZoomableImageProps {
  /** 原始图片 path（COS key、绝对 URL、blob:/data: 或 /api/ 路径），内部用 assetUrl() 解析 */
  src: string;
  alt: string;
  /** 缩略图 <img> 的样式，与替换前的 <img> 保持一致 */
  className?: string;
}

/** <img> 的 drop-in 替代：点击图片弹出全屏放大预览，点遮罩 / × / Esc 关闭。
 *  点击事件 stopPropagation，不触发所在卡片的跳转/加购。 */
export default function ZoomableImage({ src, alt, className }: ZoomableImageProps) {
  const [open, setOpen] = useState(false);
  const url = assetUrl(src);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <img
        src={url}
        alt={alt}
        className={`cursor-zoom-in ${className ?? ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      />
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          >
            <img src={url} alt={alt} className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg" />
            <button
              className="absolute top-10 right-4 w-9 h-9 bg-white/10 rounded-full flex items-center justify-center text-white text-lg"
              aria-label="关闭预览"
            >
              ✕
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
```

说明：× 按钮不需要自己的 onClick——点击会冒泡到遮罩层的 onClick 关闭预览；遮罩层自身也 `stopPropagation`，防止预览层的点击再冒泡回卡片。

- [ ] **Step 6: typecheck + 全量 web 测试**

Run: `npx tsc -b && npm run test:web`
Expected: 均 PASS，无类型错误。

- [ ] **Step 7: Commit**

```bash
git add src/lib/assetUrl.ts src/lib/assetUrl.test.ts src/components/ZoomableImage.tsx
git commit -m "feat(web): 新增 ZoomableImage 点击放大组件，assetUrl 放行 blob:/data:

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 替换全站 12 处 `<img>` 为 ZoomableImage

机械替换：每处把 `<img src={assetUrl(x)} …>` 换成 `<ZoomableImage src={x} …>`（去掉 `assetUrl()` 包裹，className 原样保留）。每个文件都要：加 `import ZoomableImage from '../components/ZoomableImage';`（components 内相互引用用 `./ZoomableImage`；pages 用 `../components/ZoomableImage`）；若替换后文件里 `assetUrl` 不再被使用，删除它的 import（`npx tsc -b` 的 noUnused 检查和 oxlint 会兜底报错）。

**Files:**
- Modify: `src/components/RestaurantCard.tsx`
- Modify: `src/components/MenuItem.tsx`
- Modify: `src/components/ReviewList.tsx`
- Modify: `src/components/ReviewForm.tsx`
- Modify: `src/components/MenuItemEditor.tsx`
- Modify: `src/pages/Home.tsx`
- Modify: `src/pages/Restaurant.tsx`
- Modify: `src/pages/OrderDetail.tsx`
- Modify: `src/pages/MerchantEdit.tsx`
- Modify: `src/pages/MerchantHome.tsx`
- Modify: `src/pages/AdminReviewDetail.tsx`（2 处）

**Interfaces:**
- Consumes: Task 1 的 `ZoomableImage`（默认导出，props `{ src, alt, className? }`，src 传原始 path）

- [ ] **Step 1: 替换 5 个 components**

`src/components/RestaurantCard.tsx`（原第 22 行，卡片整体 onClick 进店，图片点击由组件内 stopPropagation 拦截）：

```tsx
<ZoomableImage src={restaurant.bannerImage} alt={restaurant.name} className="absolute inset-0 w-full h-full object-cover" />
```

`src/components/MenuItem.tsx`（原 41-45 行）：

```tsx
<ZoomableImage
  src={item.image}
  alt={item.name}
  className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
/>
```

`src/components/ReviewList.tsx`（原 86-91 行，photos map 内，`key` 留在 ZoomableImage 上）：

```tsx
<ZoomableImage
  key={photo}
  src={photo}
  alt="评价图片"
  className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
/>
```

`src/components/ReviewForm.tsx`（原第 86 行，右上角 ✕ 删除按钮保持不动）：

```tsx
<ZoomableImage src={photo} alt="评价图片" className="w-14 h-14 rounded-lg object-cover" />
```

`src/components/MenuItemEditor.tsx`（原第 161 行）：

```tsx
<ZoomableImage src={image} alt="菜品图" className="w-16 h-16 rounded-xl object-cover" />
```

- [ ] **Step 2: 替换 6 个 pages**

`src/pages/Home.tsx`（原第 103 行，卡片可点进店）：

```tsx
<ZoomableImage src={r.bannerImage} alt={r.name} className="absolute inset-0 w-full h-full object-cover" />
```

`src/pages/Restaurant.tsx`（原 93-97 行，注意保留 `z-0`）：

```tsx
<ZoomableImage
  src={restaurant.bannerImage}
  alt={restaurant.name}
  className="absolute inset-0 w-full h-full object-cover z-0"
/>
```

`src/pages/OrderDetail.tsx`（原第 76 行）：

```tsx
<ZoomableImage src={item.image} alt={item.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
```

`src/pages/MerchantEdit.tsx`（原第 201 行）：

```tsx
<ZoomableImage src={shop.bannerImage} alt="店铺横幅" className="w-full h-28 object-cover rounded-xl" />
```

`src/pages/MerchantHome.tsx`（原第 185 行，`bannerPreview` 是 blob: URL，直接传入——Task 1 已让 assetUrl 直通）：

```tsx
<ZoomableImage src={bannerPreview} alt="店铺横幅预览" className="w-full h-28 object-cover rounded-xl" />
```

`src/pages/AdminReviewDetail.tsx`（原 113-119 行与 140-146 行两处）：

```tsx
<ZoomableImage
  src={data.restaurant.bannerImage}
  alt="横幅"
  className="w-full h-32 object-cover rounded-xl"
/>
```

```tsx
<ZoomableImage
  src={data.item.image}
  alt={data.item.name}
  className="w-32 h-32 object-cover rounded-xl"
/>
```

- [ ] **Step 3: typecheck + lint + web 测试**

Run: `npx tsc -b && npm run lint && npm run test:web`
Expected: 均 PASS。若报 `assetUrl` unused，删除对应文件的 import。

注意：`grep -rn "<img" src/` 此时应只剩 `ZoomableImage.tsx` 内部的两处。

- [ ] **Step 4: 手动验证（dev 环境）**

Run: `npm run dev`（需先 `npm run db:up`；如种子数据缺失再 `npm run db:migrate && npm run db:seed`）

核对清单（对照 spec 测试节）：
- 首页：点店铺卡片横幅 → 放大预览，不进店；点卡片文字区 → 正常进店。
- 店铺页：点菜品图 → 放大，不加购；点横幅 → 放大。
- 评价区图片、订单详情菜品图 → 点击放大。
- 商家横幅上传预览（blob:）→ 点击放大且图片正常显示。
- Esc / 点遮罩 / 点 × 均可关闭；深色模式下预览正常。

- [ ] **Step 5: Commit**

```bash
git add src/components src/pages
git commit -m "feat(web): 全站图片接入 ZoomableImage 点击放大

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: ModerationItemDto 增加 image 字段（后端，TDD）

**Files:**
- Modify: `shared/src/api.ts`（`ModerationItemDto`，约 157 行）
- Modify: `server/src/routes/admin.ts`（`toRestaurantModerationItem` 约 57 行、`toItemModerationItem` 约 76 行）
- Test: `server/src/test/moderation.test.ts`

**Interfaces:**
- Produces: `ModerationItemDto.image?: string | null` —— restaurant 行为 `bannerImage`，menuItem 行为菜品 `image`，无图为 null/undefined。Task 4 的前端缩略图依赖此字段。

- [ ] **Step 1: shared 类型先行**

`shared/src/api.ts` 的 `ModerationItemDto` 中，在 `aiConfidence?: number | null;` 之后加：

```ts
  /** 待审图片：restaurant 为 bannerImage，menuItem 为菜品 image；无图为空。 */
  image?: string | null;
```

（先加类型再写测试，否则测试文件访问 `.image` 过不了 typecheck。）

- [ ] **Step 2: 写失败测试**

`server/src/test/moderation.test.ts` 文件末尾追加（复用已有的 `createShop`/`req`/`stamp` 等 helper；`imageUrlSchema` 只放行 `/api/uploads/` 前缀或 COS base，测试用前者）：

```ts
describe('审核队列图片字段', () => {
  it('queue rows carry bannerImage / item image for list thumbnails', async () => {
    const shop = await createShop(`图片店_${stamp}`);
    const patched = await req(`/api/merchant/restaurants/${shop.id}`, ownerCookie, {
      method: 'PATCH',
      body: { bannerImage: '/api/uploads/mod-banner.jpg' },
    });
    expect(patched.status).toBe(200);

    const itemRes = await req(`/api/merchant/restaurants/${shop.id}/items`, ownerCookie, {
      method: 'POST',
      body: {
        name: `图片菜_${stamp}`,
        price: 18,
        emoji: '🍜',
        menuCategory: '招牌',
        image: '/api/uploads/mod-item.jpg',
      },
    });
    expect(itemRes.status).toBe(200);
    const item = (await itemRes.json()) as MerchantMenuItemDto;

    await __awaitReviews();
    const res = await req('/api/admin/moderation', adminCookie);
    expect(res.status).toBe(200);
    const queue = (await res.json()) as ModerationItemDto[];
    const shopRow = queue.find((m) => m.targetType === 'restaurant' && m.restaurantId === shop.id);
    const itemRow = queue.find((m) => m.targetType === 'menuItem' && m.itemId === item.id);
    expect(shopRow?.image).toBe('/api/uploads/mod-banner.jpg');
    expect(itemRow?.image).toBe('/api/uploads/mod-item.jpg');
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm run db:up && npm run test:server`
Expected: 新用例 FAIL —— `shopRow?.image` 为 `undefined`，期望 `'/api/uploads/mod-banner.jpg'`。其余用例保持 PASS。

- [ ] **Step 4: mapper 带出 image**

`server/src/routes/admin.ts`：

`toRestaurantModerationItem` 的返回对象中，`tags: row.tags,` 之后加一行：

```ts
    image: row.bannerImage,
```

`toItemModerationItem` 的返回对象中，`description: row.description || undefined,` 之后加一行：

```ts
    image: row.image,
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm run test:server`
Expected: 全部 PASS（含新用例）。

- [ ] **Step 6: typecheck + Commit**

Run: `npx tsc -b`
Expected: 无错误。

```bash
git add shared/src/api.ts server/src/routes/admin.ts server/src/test/moderation.test.ts
git commit -m "feat(server): 审核队列 DTO 增加 image 字段供列表缩略图使用

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 审核列表页缩略图

**Files:**
- Modify: `src/pages/AdminReview.tsx`（emoji 方块约 128-130 行）

**Interfaces:**
- Consumes: Task 1 的 `ZoomableImage`；Task 3 的 `ModerationItemDto.image`

- [ ] **Step 1: 有图渲染缩略图，无图保持 emoji**

`src/pages/AdminReview.tsx` 顶部加 import：

```ts
import ZoomableImage from '../components/ZoomableImage';
```

把列表卡片左侧方块：

```tsx
<div className="w-12 h-12 rounded-xl bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center text-2xl flex-shrink-0">
  {item.emoji}
</div>
```

改为：

```tsx
{item.image ? (
  <ZoomableImage
    src={item.image}
    alt={item.name}
    className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
  />
) : (
  <div className="w-12 h-12 rounded-xl bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center text-2xl flex-shrink-0">
    {item.emoji}
  </div>
)}
```

- [ ] **Step 2: typecheck + lint**

Run: `npx tsc -b && npm run lint`
Expected: 均 PASS。

- [ ] **Step 3: 手动验证**

Run: `npm run dev`，用管理员账号打开 `/admin/review`：
- 带图的待审店铺/菜品显示 12×12 圆角缩略图，点击放大且不触发卡片内其他按钮；
- 无图记录仍显示 emoji 方块；
- 「已通过 / 已驳回」tab 同样正常。

- [ ] **Step 4: Commit**

```bash
git add src/pages/AdminReview.tsx
git commit -m "feat(web): 审核列表展示待审图片缩略图

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
