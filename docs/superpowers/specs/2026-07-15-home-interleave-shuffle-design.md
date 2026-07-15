# 首页商家穿插随机排列 — 设计

日期:2026-07-15

## 目标

首页"附近餐厅"列表将玩家自制商家与系统(种子)商家穿插排列,每次打开 App(页面 JS 加载)随机打散一次;同一会话内(包括返回首页、切换分类)顺序保持稳定。

## 现状

- `/api/restaurants` 按 `sortOrder asc, createdAt asc` 返回,种子商家排前、玩家商家沉底。
- `RestaurantSummary` 不含区分玩家店/系统店的字段;数据库靠 `restaurants.ownerId` 是否为空区分。
- `Home.tsx` 每次挂载请求一次列表,分类筛选在前端完成。

## 方案(已选:前端打散)

### 后端

- `shared/src/api.ts`:`RestaurantSummary` 增加 `isPlayerMade: boolean`。
- `server/src/lib/mappers.ts`:`toRestaurantSummary` 输出 `isPlayerMade: row.ownerId !== null`。
- 接口排序逻辑不变。

### 前端

新建 `src/lib/homeShuffle.ts`,导出纯函数:

- `seededShuffle<T>(arr: T[], seed: number): T[]` — mulberry32 PRNG + Fisher–Yates,不修改入参;同种子同输入必得同输出。
- `interleaveRestaurants(list: RestaurantSummary[], seed: number): RestaurantSummary[]` — 按 `isPlayerMade` 分两组,各自 `seededShuffle`,再按数量比例(Bresenham 式均匀分配)交错合并,使少数组均匀散布于列表中,不扎堆、不沉底。

种子为**内存中的 module 级常量**:`homeShuffle.ts` 模块加载时生成一次随机整数。每次打开/刷新页面 JS 重新加载即换新种子;SPA 内导航(返回首页导致 Home 重新挂载并重新请求)种子不变,数据未变时顺序不变。不使用 sessionStorage。

`Home.tsx`:

```ts
const shuffled = useMemo(
  () => (restaurants ? interleaveRestaurants(restaurants, HOME_SHUFFLE_SEED) : []),
  [restaurants]
);
```

分类筛选(`filtered`)改为作用在 `shuffled` 上,其余不动。

### 影响范围

仅首页"附近餐厅"网格。"为你推荐"横滑栏、收藏页、商家端列表均不受影响。`toRestaurant`(详情)继承 summary 字段,`isPlayerMade` 会一并出现在详情响应中,无副作用。

## 测试

- `homeShuffle` 单测:
  - 同种子同输入 → 输出完全一致;不同种子 → 大概率不同顺序。
  - 输出为输入的重排(长度、元素集合一致),不修改入参。
  - 均匀性:构造 m 系统店 + n 玩家店,验证任意两个相邻的少数组元素之间的间隔差不超过 1(Bresenham 均匀性)。
  - 边界:空列表、全系统店、全玩家店。
- 后端 mapper 测试:有 `ownerId` 的行 `isPlayerMade === true`,种子行为 `false`。

## 错误处理

无新增错误路径:接口失败仍走 Home 现有 error 分支;`isPlayerMade` 为必填布尔,旧前端缓存不受影响(纯新增字段)。
