# 首页店铺卡片"销量/评论数"放大展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首页店铺卡片(`RestaurantCard.tsx`)展示的月售、评论数在真实值基础上按 20 倍放大 + 每天按店铺/指标独立抖动 ±12%,纯前端展示层改动,不碰数据库和后端接口。

**Architecture:** 新增一个纯函数工具模块 `src/lib/displayStats.ts`,提供确定性的"放大后展示值"计算(复用本仓库 `src/lib/homeShuffle.ts` 里已有的 `mulberry32` 数字种子 PRNG 写法,新增一个字符串→数字种子的 hash 函数),`RestaurantCard.tsx` 调用它渲染,替换原来直接展示 `monthlyOrders` 的逻辑,并新增评论数展示。

**Tech Stack:** React + TypeScript,Vitest(单测),Tailwind(样式,沿用现有 class)。

## Global Constraints

- 只改前端展示层,不改数据库、不改任何后端接口/字段,不改 `shared/src/api.ts` 的 `RestaurantSummary` 类型。
- 只改 `src/components/RestaurantCard.tsx` 这一个展示点;`ReviewList`、`MerchantReviews`、`RestaurantPosterTemplate` 等其它使用 `ratingCount`/`monthlyOrders` 的地方保持展示真实数据,不做任何改动。
- 公式:`displayValue = round(实际值 × 20 × jitter)`,`jitter = 1 + (seededRandom - 0.5) × 0.24`(即 ±12%)。
- 种子:按 `店铺id + 指标类型(sales/reviews) + 当天日期(YYYY-MM-DD 本地时区)` 派生,同一店铺同一天内展示值稳定,销量与评论数互相独立(不同 metric 字符串派生不同种子)。
- 真实值为 0 时展示值也是 0,不做下限兜底。

---

## 文件结构

- **新建** `src/lib/displayStats.ts`:导出 `getDisplayStats()`(核心放大+抖动计算)和 `formatCount()`(">1万显示为 X.X万" 格式化,供月售和评论数共用)。
- **新建** `src/lib/displayStats.test.ts`:上述两个函数的单测。
- **修改** `src/components/RestaurantCard.tsx`:调用 `getDisplayStats()`/`formatCount()` 替换现有的月售内联格式化逻辑,并在星级评分后追加评论数展示。

---

### Task 1: `displayStats.ts` 放大/抖动计算 + 格式化工具

**Files:**
- Create: `src/lib/displayStats.ts`
- Test: `src/lib/displayStats.test.ts`

**Interfaces:**
- Produces:
  - `getDisplayStats(restaurantId: string, monthlyOrders: number, ratingCount: number): { displaySales: number; displayReviews: number }`
  - `formatCount(n: number): string`

- [ ] **Step 1: 写失败的测试**

创建 `src/lib/displayStats.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { formatCount, getDisplayStats } from './displayStats';

describe('getDisplayStats', () => {
  it('同一店铺、同一天多次调用结果完全一致(确定性)', () => {
    const a = getDisplayStats('shop-1', 100, 50);
    const b = getDisplayStats('shop-1', 100, 50);
    expect(a).toEqual(b);
  });

  it('展示值约为真实值的20倍,且落在 ±12% 抖动范围内', () => {
    const { displaySales, displayReviews } = getDisplayStats('shop-2', 100, 50);
    const salesBase = 100 * 20;
    const reviewsBase = 50 * 20;
    expect(displaySales).toBeGreaterThanOrEqual(Math.round(salesBase * 0.88));
    expect(displaySales).toBeLessThanOrEqual(Math.round(salesBase * 1.12));
    expect(displayReviews).toBeGreaterThanOrEqual(Math.round(reviewsBase * 0.88));
    expect(displayReviews).toBeLessThanOrEqual(Math.round(reviewsBase * 1.12));
  });

  it('真实值为 0 时展示值也是 0(不做下限兜底)', () => {
    expect(getDisplayStats('shop-3', 0, 0)).toEqual({ displaySales: 0, displayReviews: 0 });
  });

  it('销量与评论数的抖动互相独立(不同店铺下二者不会永远同步变化)', () => {
    const samples = Array.from({ length: 10 }, (_, i) => getDisplayStats(`shop-${i}`, 100, 100));
    const salesValues = new Set(samples.map((s) => s.displaySales));
    const reviewsValues = new Set(samples.map((s) => s.displayReviews));
    // 真实值相同(100, 100)但种子不同,展示值应该有波动、不是常数
    expect(salesValues.size).toBeGreaterThan(1);
    expect(reviewsValues.size).toBeGreaterThan(1);
    // 同一批店铺里,销量展示值集合和评论数展示值集合不应完全相同(证明二者种子独立)
    expect([...salesValues].sort()).not.toEqual([...reviewsValues].sort());
  });

  it('不同店铺id得到不同的抖动结果', () => {
    const a = getDisplayStats('shop-a', 100, 100);
    const b = getDisplayStats('shop-b', 100, 100);
    expect(a).not.toEqual(b);
  });
});

describe('formatCount', () => {
  it('小于等于1万原样返回数字字符串', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(100)).toBe('100');
    expect(formatCount(10000)).toBe('10000');
  });

  it('大于1万显示为 X.X万', () => {
    expect(formatCount(12345)).toBe('1.2万');
    expect(formatCount(100000)).toBe('10.0万');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/lib/displayStats.test.ts`
Expected: FAIL,报错 `Failed to resolve import "./displayStats"` (文件还不存在)。

- [ ] **Step 3: 实现 `displayStats.ts`**

创建 `src/lib/displayStats.ts`:

```typescript
// 首页店铺卡片展示用的“放大版”销量/评论数——只影响展示,不改变真实数据。
// 复用 homeShuffle.ts 里的 mulberry32 数字种子 PRNG 写法,额外加一个字符串→数字种子的 hash。

function hashStringToSeed(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

const AMPLIFY_FACTOR = 20;
const JITTER_RANGE = 0.24; // ±12%

function jitterFor(restaurantId: string, metric: 'sales' | 'reviews', dateStr: string): number {
  const seed = hashStringToSeed(`${restaurantId}:${metric}:${dateStr}`);
  const rng = mulberry32(seed);
  return 1 + (rng() - 0.5) * JITTER_RANGE;
}

/** 首页卡片展示用的放大后销量/评论数。同一店铺同一天内结果稳定,跨天自然变化。 */
export function getDisplayStats(
  restaurantId: string,
  monthlyOrders: number,
  ratingCount: number,
): { displaySales: number; displayReviews: number } {
  const dateStr = new Date().toISOString().slice(0, 10);
  return {
    displaySales: Math.round(monthlyOrders * AMPLIFY_FACTOR * jitterFor(restaurantId, 'sales', dateStr)),
    displayReviews: Math.round(ratingCount * AMPLIFY_FACTOR * jitterFor(restaurantId, 'reviews', dateStr)),
  };
}

/** 超过1万显示为 "X.X万",否则原样返回数字字符串。 */
export function formatCount(n: number): string {
  return n > 10000 ? `${(n / 10000).toFixed(1)}万` : `${n}`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/lib/displayStats.test.ts`
Expected: PASS,全部用例通过。

- [ ] **Step 5: Commit**

```bash
git add src/lib/displayStats.ts src/lib/displayStats.test.ts
git commit -m "feat(web): 首页卡片销量/评论数放大展示的计算工具"
```

---

### Task 2: `RestaurantCard.tsx` 接入放大展示值

**Files:**
- Modify: `src/components/RestaurantCard.tsx:1-3` (imports), `src/components/RestaurantCard.tsx:55-64` (展示行)

**Interfaces:**
- Consumes: `getDisplayStats(restaurantId: string, monthlyOrders: number, ratingCount: number): { displaySales: number; displayReviews: number }` 与 `formatCount(n: number): string`,来自 Task 1 的 `src/lib/displayStats.ts`。

- [ ] **Step 1: 修改 import**

在 `src/components/RestaurantCard.tsx` 顶部(第 1-3 行)新增 import:

```typescript
import { useNavigate } from 'react-router-dom';
import type { RestaurantSummary } from '@sim-waimai/shared';
import { assetUrl } from '../lib/assetUrl';
import { formatCount, getDisplayStats } from '../lib/displayStats';
```

- [ ] **Step 2: 在组件内计算展示值**

在 `RestaurantCard.tsx` 的 `const closed = !restaurant.isActive;` 之后新增一行:

```typescript
  const { displaySales, displayReviews } = getDisplayStats(restaurant.id, restaurant.monthlyOrders, restaurant.ratingCount);
```

- [ ] **Step 3: 替换展示行**

把现有的(第 55-64 行):

```tsx
        <div className="flex items-center gap-2 mt-1">
          <div className="flex items-center gap-0.5">
            <span className="text-yellow-400 text-xs">★</span>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{restaurant.rating}</span>
          </div>
          <span className="text-gray-300 dark:text-gray-600 text-xs">|</span>
          <span className="text-xs text-gray-400 dark:text-gray-500">月售{restaurant.monthlyOrders > 10000 ? `${(restaurant.monthlyOrders / 10000).toFixed(1)}万` : restaurant.monthlyOrders}+</span>
          <span className="text-gray-300 dark:text-gray-600 text-xs">|</span>
          <span className="text-xs text-gray-400 dark:text-gray-500">起送¥{restaurant.minOrder}</span>
        </div>
```

替换为:

```tsx
        <div className="flex items-center gap-2 mt-1">
          <div className="flex items-center gap-0.5">
            <span className="text-yellow-400 text-xs">★</span>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{restaurant.rating}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">({formatCount(displayReviews)}+)</span>
          </div>
          <span className="text-gray-300 dark:text-gray-600 text-xs">|</span>
          <span className="text-xs text-gray-400 dark:text-gray-500">月售{formatCount(displaySales)}+</span>
          <span className="text-gray-300 dark:text-gray-600 text-xs">|</span>
          <span className="text-xs text-gray-400 dark:text-gray-500">起送¥{restaurant.minOrder}</span>
        </div>
```

- [ ] **Step 4: 运行全量前端单测,确认没有破坏其它用例**

Run: `npm run test:web`
Expected: PASS(全部现有用例 + Task 1 新增用例都通过)。

- [ ] **Step 5: 类型检查**

Run: `npx tsc -b --noEmit`
Expected: 无新增类型错误(如果本身已有历史报错,确认没有新增和本次改动相关的报错)。

- [ ] **Step 6: 启动本地开发服务器,浏览器实测首页卡片**

Run: `npm run dev:client`(或 `npm run dev` 同时起前后端,取决于是否需要真实接口数据)

打开首页,确认:
- 每张店铺卡片星级评分后面出现 `(数字+)` 形式的评论数,数字明显大于详情页/商家后台展示的真实评论数(约20倍量级)。
- 月售数字同样明显放大(约20倍量级),>1万时正确显示"X.X万+"格式。
- 刷新页面,同一家店的数字不跳变(同一天内稳定)。
- 详情页(点进某个店铺)展示的评分、评论数(`ReviewList` 组件)仍是真实值,没有被放大。

- [ ] **Step 7: Commit**

```bash
git add src/components/RestaurantCard.tsx
git commit -m "feat(web): 首页卡片接入放大后的销量/评论数展示"
```

---

## 影响范围小结

| 层 | 文件 | 改动类型 |
|---|---|---|
| 前端 | `src/lib/displayStats.ts` | 新增文件 |
| 前端 | `src/lib/displayStats.test.ts` | 新增文件 |
| 前端 | `src/components/RestaurantCard.tsx` | 接入放大展示值,新增评论数展示 |

不涉及共享类型、后端、数据库改动。
