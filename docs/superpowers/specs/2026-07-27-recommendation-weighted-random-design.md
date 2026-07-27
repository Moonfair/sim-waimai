# 首页推荐加权随机抽取 — 设计

日期:2026-07-27

## 目标

首页"为你推荐"（`GET /api/recommendations`）每次进入都应重新随机排列；管理员为玩家自建店铺设置的推荐优先级（店铺管理页的置顶/较高/普通/较低四档，`recommendPriority` 字段）只放大该店铺被抽中、排前的**概率**，不再是绝对置顶。

## 现状

`server/src/routes/recommendations.ts`：对 `isActive && approved` 的店铺计算 `score = 分类偏好*10 + rating + log10(monthlyOrders+1)`，按 `recommendPriority DESC, score DESC` 严格排序取前 6 家（店铺管理功能引入的排序规则）。这是确定性排序——同一批数据下每次请求结果完全相同，管理员设为"置顶"的店铺必然排第一。

接口本身每次请求都会重新计算（只有底层店铺数据行有 30s TTL 缓存，排序结果不缓存），前端 `Home.tsx` 也是每次挂载重新 `useApi('/recommendations')`，所以"每次进入刷新"这一半已经成立；缺的是把确定性排序换成加权随机抽取。

## 方案

### 核心算法：新增 `server/src/lib/weightedSample.ts`

不放回加权随机抽样（Efraimidis–Spirakis key 法）的纯函数，不依赖 db/Hono，可独立单测：

```ts
export function weightedSample<T>(
  items: T[],
  weight: (item: T) => number,
  k: number,
  rng: () => number = Math.random,
): T[] {
  return items
    .map((item) => ({ item, key: rng() ** (1 / Math.max(weight(item), 1e-6)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, k)
    .map(({ item }) => item);
}
```

`rng` 可注入，默认 `Math.random`；权重钳制最小值 `1e-6`，避免 0 权重导致 `1/weight` 除零或指数运算异常。

### 路由改动：`recommendations.ts`

`score` 计算逻辑不变；将现有 `.sort(...).slice(0, LIMIT)` 替换为：

```ts
const weight = (r: RestaurantRow) =>
  Math.max(qualityScore(r), 0.01) * (1 + r.recommendPriority / 50);
const picked = weightedSample(active, weight, LIMIT);
```

`priorityMultiplier = 1 + recommendPriority/50`：置顶(100)→3x，较高(10)→1.2x，普通(0)→1x，较低(-10)→0.8x（已与用户确认的档位）。候选池为全部上架店铺（不预筛选 Top-N），质量差的店铺因权重低自然很少被抽中。

不涉及前端改动——`Home.tsx` 已经是每次挂载都重新请求。

## 测试

1. **`weightedSample.test.ts`（纯单测，注入假 `rng`）**：给定固定的权重序列和固定的 `rng` 返回值序列，断言精确输出顺序（完全确定性，不依赖真随机）。覆盖：`k > items.length`、权重全相等、含极小/零权重项。
2. **`recommendations.test.ts`（改写现有两个用例）**：
   - "cold start"：连续调用接口 N=100 次，统计某个明显高分店铺与明显低分店铺分别被抽入 top-6 的次数，断言高分店铺次数更多（不再断言单次严格顺序）。
   - "personalized"：同样改为频次统计——带口味历史 cookie 调用 N=100 次，统计目标分类店铺出现在结果中的次数应明显高于不带历史的基线次数。
3. **`recommendationsPriority.test.ts`（重写）**：构造两个评分/月销量完全相同的玩家店铺，一个 `recommendPriority=100`，一个 `=0`，调用接口 N=200 次，断言高优先级店铺被抽入 top-6 的次数**严格多于**基线店铺，但不要求"总是排第一"（用一次额外调用观察结果中至少出现过非置顶店铺排第一的情况，证明不是硬编码置顶）。

N 值选取以真实权重差距下把假阳性概率压到可忽略为准，不追求精确的统计显著性检验。

## 错误处理

无新增错误路径：`weightedSample` 对空数组、`k=0`、单元素等输入直接按数组语义返回空/该元素，无需抛错；接口的鉴权、404、400 行为均不受影响。
