# 商店详情页菜单连续滚动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 商店详情页（`src/pages/Restaurant.tsx`）右侧菜单从"点击才切换分类"改为"所有分类连续排列可滚动"，滚动时左侧分类自动同步高亮，点击左侧分类平滑滚动到对应位置。

**Architecture:** 单文件改动。右侧渲染从"过滤出当前分类"改为"按 `menuCategories` 顺序分组渲染所有非空分类"；用原生 `IntersectionObserver` 监听各分类 `<section>` 判断当前应高亮的分类；左侧分类栏加 `sticky` 使其在菜单区域内保持可见；点击分类用 `scrollIntoView` 平滑滚动，并短暂抑制 observer 更新避免滚动过程中高亮跳动。

**Tech Stack:** React 19 + TypeScript，Vite，Tailwind CSS，浏览器原生 `IntersectionObserver`（不引入新依赖）。

## Global Constraints

- 本项目前端没有组件级自动化测试基础设施（无 `@testing-library/react`/jsdom 配置，`vitest` 仅用于 server 侧）。因此每个任务的验证方式是：`tsc -b`（类型检查）+ `oxlint`（lint）+ 手动在浏览器里用 `npm run dev` 跑起来验证交互，而不是编写自动化单元测试。这是遵循现有项目模式，不是本计划的例外。
- 不改动后端、数据库、共享类型（`shared/src/*`）。
- 不引入新的 npm 依赖。
- 空分类（该分类下无商品）在右侧跳过不渲染，左侧分类栏仍正常显示且可点击。
- 店铺打烊态（`restaurant.isActive === false`）的现有横幅提示和 `purchasable` 传参逻辑不变。

---

## 文件结构

只修改一个文件：

- Modify: `src/pages/Restaurant.tsx` — 菜单渲染分组、滚动联动状态与 effect、左侧分类栏样式。

不新建文件（改动集中在单个组件内，拆多个文件对这种规模的改动没有必要）。

---

### Task 1: 菜单按分类分组连续渲染（去掉单分类过滤）

**Files:**
- Modify: `src/pages/Restaurant.tsx:96`（`filteredMenu` 定义处）
- Modify: `src/pages/Restaurant.tsx:186-201`（右侧菜单渲染 JSX）

**Interfaces:**
- Consumes: 无新依赖，沿用现有 `restaurant.menuCategories: string[]`、`restaurant.menu: MenuItem[]`（每项含 `menuCategory: string`）。
- Produces: 新的本地变量 `menuByCategory: { cat: string; items: MenuItem[] }[]`（只含非空分类，顺序与 `restaurant.menuCategories` 一致），供 Task 2 的 IntersectionObserver 复用同样的分组逻辑（Task 2 会在 effect 内部重新按同样规则计算一份分类名列表，不直接依赖这个变量，避免 effect 依赖数组随每次渲染重建）。

- [ ] **Step 1: 替换 `filteredMenu` 为按分类分组**

把第 96 行：

```tsx
const filteredMenu = restaurant.menu.filter(item => item.menuCategory === activeMenuCat);
```

替换为：

```tsx
const menuByCategory = restaurant.menuCategories
  .map(cat => ({ cat, items: restaurant.menu.filter(item => item.menuCategory === cat) }))
  .filter(group => group.items.length > 0);
```

- [ ] **Step 2: 右侧渲染改为遍历 `menuByCategory`**

把第 186-201 行的整个「Right menu items」块：

```tsx
        {/* Right menu items */}
        <div className="flex-1 px-3 pb-8">
          <h3 className="text-gray-500 dark:text-gray-400 text-xs font-medium pt-3 pb-1">{activeMenuCat}</h3>
          {filteredMenu.length === 0 ? (
            <p className="text-gray-300 dark:text-gray-600 text-sm text-center py-8">暂无菜品</p>
          ) : (
            filteredMenu.map(item => (
              <MenuItemComponent
                key={item.id}
                item={item}
                restaurant={restaurant}
                purchasable={restaurant.isActive}
              />
            ))
          )}
        </div>
```

替换为：

```tsx
        {/* Right menu items */}
        <div className="flex-1 px-3 pb-8">
          {menuByCategory.length === 0 ? (
            <p className="text-gray-300 dark:text-gray-600 text-sm text-center py-8">暂无菜品</p>
          ) : (
            menuByCategory.map(({ cat, items }) => (
              <section key={cat} id={`menu-cat-${cat}`} data-category={cat}>
                <h3 className="text-gray-500 dark:text-gray-400 text-xs font-medium pt-3 pb-1">{cat}</h3>
                {items.map(item => (
                  <MenuItemComponent
                    key={item.id}
                    item={item}
                    restaurant={restaurant}
                    purchasable={restaurant.isActive}
                  />
                ))}
              </section>
            ))
          )}
        </div>
```

（`ref` 挂载留到 Task 2 一起加，避免这一步引入还用不到的 ref 逻辑。）

- [ ] **Step 3: 类型检查 + lint**

Run: `cd /Users/moonfair/Projects/sim-waimai && npx tsc -b && npx oxlint src/pages/Restaurant.tsx`
Expected: 都无报错。

- [ ] **Step 4: 手动验证**

Run: `npm run dev:client`（或 `npm run dev` 起前后端），浏览器打开任意商店详情页。
Expected:
- 页面一次性展示该店铺所有分类的商品，按分类分组、顺序与左侧分类栏一致。
- 没有商品的分类（如果测试数据里有）在右侧看不到对应区块，但左侧分类栏里仍然存在。
- 左侧点击分类目前仍是旧逻辑（只更新高亮，不会自动滚动/也不会再过滤右侧内容，因为右侧现在展示全部），这是预期的过渡态，Task 2 会补上滚动联动。

- [ ] **Step 5: Commit**

```bash
git add src/pages/Restaurant.tsx
git commit -m "feat(web): 商店详情页菜单按分类连续渲染"
```

---

### Task 2: 滚动联动高亮 + 点击平滑滚动 + 左侧分类栏吸顶

**Files:**
- Modify: `src/pages/Restaurant.tsx:1`（imports，新增 `useRef`）
- Modify: `src/pages/Restaurant.tsx:17-32`（组件顶部状态/effect 区域，新增 refs + IntersectionObserver effect + 清理 effect + 点击处理函数）
- Modify: `src/pages/Restaurant.tsx`（Task 1 产出的 `<section>` 加 `ref`；左侧分类栏容器加 sticky 样式；分类按钮 `onClick` 换成新的点击处理函数）

**Interfaces:**
- Consumes: Task 1 产出的 `menuByCategory`（渲染用）以及 `<section id={`menu-cat-${cat}`} data-category={cat}>` 结构（Task 2 给每个 section 加 `ref` 挂载点）。
- Produces: `handleCategoryClick(cat: string): void`（左侧分类按钮点击用）；无对外导出，仅组件内部使用。

- [ ] **Step 1: 新增 `useRef` import**

把第 1 行：

```tsx
import { useEffect, useState } from 'react';
```

改为：

```tsx
import { useEffect, useRef, useState } from 'react';
```

- [ ] **Step 2: 新增 refs 和滚动联动 effect**

在现有的两个 `useEffect`（第 28-36 行，`activeMenuCat` 初始化 + `isFav` 初始化）之后，`toggleFavorite` 函数（第 38 行）之前，插入：

```tsx
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const suppressObserver = useRef(false);
  const observerTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!restaurant) return;
    const categories = restaurant.menuCategories.filter(cat =>
      restaurant.menu.some(item => item.menuCategory === cat)
    );
    if (categories.length === 0) return;

    const observer = new IntersectionObserver(
      entries => {
        if (suppressObserver.current) return;
        const visible = entries.filter(entry => entry.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b
        );
        const cat = topMost.target.getAttribute('data-category');
        if (cat) setActiveMenuCat(cat);
      },
      { rootMargin: '-64px 0px -70% 0px', threshold: 0 }
    );

    categories.forEach(cat => {
      const el = sectionRefs.current[cat];
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [restaurant]);

  useEffect(() => {
    return () => {
      if (observerTimeoutRef.current) window.clearTimeout(observerTimeoutRef.current);
    };
  }, []);

  const handleCategoryClick = (cat: string) => {
    setActiveMenuCat(cat);
    suppressObserver.current = true;
    if (observerTimeoutRef.current) window.clearTimeout(observerTimeoutRef.current);
    sectionRefs.current[cat]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    observerTimeoutRef.current = window.setTimeout(() => {
      suppressObserver.current = false;
    }, 600);
  };
```

- [ ] **Step 3: 左侧分类按钮改用 `handleCategoryClick`**

在左侧分类栏（原第 170-184 行附近）里，把：

```tsx
              onClick={() => setActiveMenuCat(cat)}
```

改为：

```tsx
              onClick={() => handleCategoryClick(cat)}
```

- [ ] **Step 4: 左侧分类栏容器加 sticky**

把左侧分类栏外层 div（原第 170 行）：

```tsx
        <div className="w-20 flex-shrink-0 bg-gray-50 dark:bg-gray-900 border-r border-gray-100 dark:border-gray-700">
```

改为：

```tsx
        <div className="w-20 flex-shrink-0 self-start sticky top-0 max-h-screen overflow-y-auto bg-gray-50 dark:bg-gray-900 border-r border-gray-100 dark:border-gray-700">
```

- [ ] **Step 5: 给 Task 1 产出的 `<section>` 挂 ref**

把 Task 1 中的：

```tsx
              <section key={cat} id={`menu-cat-${cat}`} data-category={cat}>
```

改为：

```tsx
              <section
                key={cat}
                id={`menu-cat-${cat}`}
                data-category={cat}
                ref={el => { sectionRefs.current[cat] = el; }}
              >
```

- [ ] **Step 6: 类型检查 + lint**

Run: `cd /Users/moonfair/Projects/sim-waimai && npx tsc -b && npx oxlint src/pages/Restaurant.tsx`
Expected: 都无报错。

- [ ] **Step 7: 手动验证**

Run: `npm run dev:client`（或 `npm run dev`），浏览器打开一个菜品分类数量较多（至少 3-4 个分类，能撑满一屏以上）的商店详情页。

验证点：
- 向下滑动页面时，滑过某分类的商品区域后，左侧对应分类按钮自动变成高亮态，且高亮随滚动位置连续更新（不是跳着变化）。
- 左侧分类栏在滚动经过菜单区域时始终吸顶可见；滚动到评价区（`ReviewList`）之后，分类栏跟着一起滚出视口（不再悬浮在评价内容上方）。
- 点击左侧任意分类按钮：页面平滑滚动到该分类的商品区块顶部，且该分类立即高亮；滚动动画过程中高亮不应该在中间分类上闪烁。
- 打烊店铺（`isActive === false`）的横幅和商品禁用态显示正常，未受本次改动影响。
- 在浏览器开发者工具切换到较窄的移动端视口宽度（模拟真实使用场景）下重复以上验证，交互无异常。

- [ ] **Step 8: Commit**

```bash
git add src/pages/Restaurant.tsx
git commit -m "feat(web): 商店详情页菜单滚动联动高亮与吸顶分类栏"
```

---

## Self-Review 记录

- **Spec 覆盖检查**：设计文档四个部分（渲染结构、滚动联动、左侧分类栏吸顶、边界情况）分别对应 Task 1 Step 1-2（渲染结构）、Task 2 Step 2-3（滚动联动 + 点击跳转防抖）、Task 2 Step 4（吸顶）；边界情况（空分类跳过、打烊态不受影响、首次加载默认高亮沿用现状）均在 Task 1/2 的实现和手动验证步骤里覆盖，无遗漏。
- **占位符检查**：全文无 TBD/TODO，所有步骤含完整可执行代码。
- **类型一致性检查**：`menuByCategory`（Task 1 产出）在 Task 2 中通过 `data-category` 属性和 `sectionRefs`（`Record<string, HTMLElement | null>`）衔接，命名和类型在两个任务间一致；`handleCategoryClick(cat: string): void` 签名与调用处一致。
