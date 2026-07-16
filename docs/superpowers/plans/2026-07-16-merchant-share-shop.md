# 商家店铺页分享按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在商家店铺管理页头部加「🔗 分享店铺」按钮，点击复制顾客视角链接到剪贴板。

**Architecture:** 纯前端改动，仅修改 `src/pages/MerchantEdit.tsx`：新增一个复制状态 state 和 `handleShare` 处理函数，在头部「查看顾客视角 ›」旁条件渲染分享按钮（仅 `reviewStatus === 'approved'`）。链接指向无需登录的顾客页 `/restaurant/:id`，nginx 已有 SPA 回退，深链接直接可达。

**Tech Stack:** React 19 + TypeScript + Tailwind（既有栈，无新依赖）。

## Global Constraints

- 仅 `shop.reviewStatus === 'approved'` 时渲染分享按钮（spec：未过审店铺对顾客不可见）。
- 链接构造必须带 basename：`new URL(`${import.meta.env.BASE_URL}restaurant/${shop.id}`, window.location.origin).toString()`。
- 复制反馈沿用局部 state + `setTimeout` 模式，不引入 toast 组件。
- 按钮文案：默认「🔗 分享店铺」，成功「已复制 ✓」，失败「复制失败」，约 2 秒后还原。
- 不改后端；spec 明确不为一行拼接逻辑写单测，以实际运行验证为准。

---

### Task 1: MerchantEdit 分享按钮

**Files:**
- Modify: `src/pages/MerchantEdit.tsx`（state 加在 hooks 区约 :19-26；handler 加在 `handleToggleActive` 附近约 :100-108；JSX 改 :155-160 的「查看顾客视角」按钮区域）

**Interfaces:**
- Consumes: `shop: MerchantRestaurantDto`（已有，含 `id`、`reviewStatus`）；`import.meta.env.BASE_URL`。
- Produces: 无（终端 UI 改动，无下游任务）。

- [ ] **Step 1: 加复制状态 state**

在 `MerchantEdit` 组件顶部 hooks 区（`const bannerFileRef = ...` 之后，早退 return 之前）加：

```tsx
const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle');
```

- [ ] **Step 2: 加 handleShare 处理函数**

在 `handleToggleActive` 定义之后（此处已通过早退保证 `shop` 非空）加：

```tsx
const handleShare = async () => {
  const url = new URL(`${import.meta.env.BASE_URL}restaurant/${shop.id}`, window.location.origin).toString();
  let ok = false;
  try {
    await navigator.clipboard.writeText(url);
    ok = true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
  }
  setShareState(ok ? 'copied' : 'failed');
  setTimeout(() => setShareState('idle'), 2000);
};
```

- [ ] **Step 3: 改头部 JSX，加分享按钮**

把现有的：

```tsx
<button
  className="mt-2 text-xs text-orange-500"
  onClick={() => navigate(`/restaurant/${shop.id}`)}
>
  查看顾客视角 ›
</button>
```

替换为：

```tsx
<div className="mt-2 flex items-center gap-4">
  <button className="text-xs text-orange-500" onClick={() => navigate(`/restaurant/${shop.id}`)}>
    查看顾客视角 ›
  </button>
  {shop.reviewStatus === 'approved' && (
    <button className="text-xs text-orange-500" onClick={handleShare}>
      {shareState === 'copied' ? '已复制 ✓' : shareState === 'failed' ? '复制失败' : '🔗 分享店铺'}
    </button>
  )}
</div>
```

- [ ] **Step 4: 类型检查与 lint**

Run: `npm run build`
Expected: `tsc -b` 与 `vite build` 均无错误退出。

Run: `npm run lint`
Expected: 无新增告警/错误。

- [ ] **Step 5: 实际运行验证（/verify）**

启动 `npm run dev`，以商家账号进入某个已过审店铺的 `/merchant/:id` 页面，确认：
1. 头部出现「🔗 分享店铺」按钮；未过审店铺不出现。
2. 点击后按钮变「已复制 ✓」，约 2 秒还原。
3. 剪贴板内容为 `<origin><BASE_URL>restaurant/<id>`，新标签页打开该链接直达顾客视角店铺页（无需登录）。

- [ ] **Step 6: Commit**

```bash
git add src/pages/MerchantEdit.tsx
git commit -m "feat(web): 商家店铺页新增分享按钮，复制顾客视角链接"
```
