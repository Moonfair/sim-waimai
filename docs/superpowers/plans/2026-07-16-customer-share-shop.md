# 顾客视角店铺页分享按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 顾客视角店铺页横幅右上角新增分享按钮，复制店铺链接；复制逻辑抽为公共函数并让商家页复用。

**Architecture:** 新建 `src/lib/share.ts` 承载「构链 + 剪贴板 + 降级」逻辑；`Restaurant.tsx` 在收藏按钮左侧加同样式圆形 🔗 按钮调用它；`MerchantEdit.tsx` 的 `handleShare` 改为调用它（行为不变）。纯前端，无后端改动。

**Tech Stack:** React 19 + TypeScript + Tailwind（既有栈，无新依赖）。

## Global Constraints

- 构链必须带 basename：`new URL(`${import.meta.env.BASE_URL}restaurant/${id}`, window.location.origin).toString()`。
- 复制降级链：`navigator.clipboard.writeText` → 隐藏 textarea + `document.execCommand('copy')` → 返回 `false`。
- 反馈沿用局部 state + `setTimeout`（约 2 秒还原），不引入 toast 组件。
- 顾客页按钮始终显示（能打开即已过审）；`aria-label="分享餐厅"`。
- 商家页按钮行为与文案保持不变（默认「🔗 分享店铺」/「已复制 ✓」/「复制失败」，仅 approved 显示）。
- spec 明确不写单测，以实际运行验证（/verify）为准。

---

### Task 1: 公共函数 `copyRestaurantLink` + 商家页复用

**Files:**
- Create: `src/lib/share.ts`
- Modify: `src/pages/MerchantEdit.tsx`（`handleShare` 函数体，约 :111-133）

**Interfaces:**
- Consumes: `import.meta.env.BASE_URL`、`window.location.origin`。
- Produces: `export async function copyRestaurantLink(id: string): Promise<boolean>` — Task 2 的顾客页按钮依赖此签名。

- [ ] **Step 1: 新建 `src/lib/share.ts`**

```ts
/** 复制餐厅顾客页链接到剪贴板，返回是否成功。 */
export async function copyRestaurantLink(id: string): Promise<boolean> {
  const url = new URL(`${import.meta.env.BASE_URL}restaurant/${id}`, window.location.origin).toString();
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
}
```

- [ ] **Step 2: `MerchantEdit.tsx` 的 `handleShare` 改为调用公共函数**

在 import 区加：

```ts
import { copyRestaurantLink } from '../lib/share';
```

把现有 `handleShare`（内联构链 + 剪贴板 + 降级的整个函数体）替换为：

```tsx
const handleShare = async () => {
  const ok = await copyRestaurantLink(shop.id);
  setShareState(ok ? 'copied' : 'failed');
  setTimeout(() => setShareState('idle'), 2000);
};
```

- [ ] **Step 3: 类型检查**

Run: `npm run build`
Expected: `tsc -b` 与 `vite build` 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/lib/share.ts src/pages/MerchantEdit.tsx
git commit -m "refactor(web): 抽取 copyRestaurantLink 公共函数，商家页分享复用"
```

### Task 2: 顾客页分享按钮

**Files:**
- Modify: `src/pages/Restaurant.tsx`（import 区 :1-10；state 区约 :17-18；横幅右上角收藏按钮处约 :96-102）

**Interfaces:**
- Consumes: Task 1 的 `copyRestaurantLink(id: string): Promise<boolean>`（from `../lib/share`）；已有 `id`（useParams）。
- Produces: 无（终端 UI）。

- [ ] **Step 1: 加 import 与反馈 state**

import 区加：

```ts
import { copyRestaurantLink } from '../lib/share';
```

在 `const [isFav, setIsFav] = useState(false);` 之后加：

```tsx
const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle');
```

- [ ] **Step 2: 加 handleShare 处理函数**

在 `toggleFavorite` 定义之后加：

```tsx
const handleShare = async () => {
  if (!id) return;
  const ok = await copyRestaurantLink(id);
  setShareState(ok ? 'copied' : 'failed');
  setTimeout(() => setShareState('idle'), 2000);
};
```

- [ ] **Step 3: 横幅右上角加分享按钮**

在收藏按钮（`aria-label={isFav ? '取消收藏' : '收藏餐厅'}` 的那个 `<button>`）**之前**加：

```tsx
<button
  className="absolute top-10 right-16 w-9 h-9 bg-black/20 backdrop-blur-sm rounded-full flex items-center justify-center text-lg text-white z-10"
  onClick={handleShare}
  aria-label="分享餐厅"
>
  {shareState === 'copied' ? '✓' : shareState === 'failed' ? '✕' : '🔗'}
</button>
```

（收藏按钮在 `right-4`，分享按钮放 `right-16`，二者间距 12px。）

- [ ] **Step 4: 类型检查与 lint**

Run: `npm run build`
Expected: 无错误。

Run: `npm run lint`
Expected: 无新增告警。

- [ ] **Step 5: 实际运行验证（/verify）**

启动 dev 环境，Playwright 驱动：
1. 未登录直接打开某已过审店铺 `/restaurant/:id` → 横幅右上角出现 🔗 按钮（收藏左侧）。
2. 点击 → 图标变 ✓，约 2 秒还原；剪贴板为 `<origin>/restaurant/<id>`。
3. 回归：登录商家账号进 `/merchant/:id`，分享按钮仍复制成功、显示「已复制 ✓」。

- [ ] **Step 6: Commit**

```bash
git add src/pages/Restaurant.tsx
git commit -m "feat(web): 顾客视角店铺页新增分享按钮"
```
