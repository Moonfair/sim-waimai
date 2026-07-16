# 商家评价管理（隐藏/恢复）设计

日期：2026-07-16

## 背景与目标

顾客在订单完成后可对店铺打分、写评价、传图（`reviews` 表），评价在店铺页公开展示。
商家侧（MerchantHome / MerchantEdit）目前完全看不到自己店铺的评价，也没有任何处理能力。

目标：商家可以查看自己店铺下的全部评价，并**隐藏**（软删除）不想展示的评价，也可以**恢复**已隐藏的评价。

删除语义确认为**软删除**：

- 隐藏后评价不在店铺页公开展示，店铺评分同步回滚；
- 数据保留，顾客在自己的订单详情里仍能看到自己写过的评价；
- 商家在评价管理页能看到已隐藏的评价（置灰展示），可一键恢复（评分同步加回）。

## 数据层

`reviews` 表新增一列：

```
hidden_at timestamptz  -- 可空，默认 NULL
```

- `NULL` = 正常展示；非 NULL = 已隐藏，同时记录隐藏时间（审计信息）。
- 出一个 drizzle migration。

不选布尔字段（丢时间信息、无成本优势），不选独立关联表（多一次 join，过度设计）。

## 后端

### 新增路由（server/src/routes/merchant.ts）

**`GET /merchant/restaurants/:id/reviews`**

- 复用 `ownedRestaurant` 鉴权（404 店铺不存在 / 403 非店主）。
- 复用现有 keyset 分页模式（`(created_at, id)` 游标，`limit` 1–50 默认 10）。
- 返回该店**全部**评价（含隐藏），join users 取 username。
- DTO：`MerchantReviewDto = ReviewDto & { hidden: boolean }`（shared/src/api.ts）。

**`PATCH /merchant/restaurants/:id/reviews/:reviewId`**，body `{ hidden: boolean }`

- 同样走 `ownedRestaurant` 鉴权；`reviewId` 校验 UUID，评价必须属于该店铺，否则 404。
- 事务内完成两件事：
  1. 更新 `reviews.hidden_at`（隐藏 = `now()`，恢复 = `NULL`）；
  2. 同步店铺聚合：隐藏时 `ratingSum -= rating, ratingCount -= 1`；恢复时反向加回；
     `rating = ratingCount > 0 ? ROUND(ratingSum / ratingCount, 1) : 5`。
- `ratingCount` 减到 0 时评分回到默认 5：玩家店初始 rating 就是 5，自洽；
  种子店 `ownerId` 为 NULL，不会走到这个接口。
- 幂等保护：UPDATE 带 `hidden_at IS NULL`（隐藏时）/ `hidden_at IS NOT NULL`（恢复时）条件，
  命中 0 行则直接返回当前状态，不调整评分——重复点击不会把评分扣两次。

### 现有接口改动

- **`GET /restaurants/:id/reviews`**（公开评价列表）：过滤条件加 `hidden_at IS NULL`。
- **订单详情 / 订单列表**：不变——顾客看自己的评价不受隐藏影响（含「已评价」标记）。
- 评价创建接口不变（`hidden_at` 默认 NULL）。

## 前端

- 新页面 `src/pages/MerchantReviews.tsx`，路由 `/merchant/:id/reviews`（RequireAuth）。
- `MerchantEdit` 页在「菜品管理」区块旁加「评价管理」入口，跳转到新页面。
- 列表样式对齐现有 `ReviewList`（星级、内容、图片九宫格、时间、用户名），
  「加载更多」分页交互一致。
- 每条评价的操作：
  - 正常评价：右侧「隐藏」按钮，点击后二次确认（防误触），成功后原地更新状态；
  - 已隐藏评价：整条置灰 + 「已隐藏」标记 + 「恢复」按钮，点击直接恢复。
- 页头展示店铺当前评分与评价条数，隐藏/恢复后前端同步刷新（以接口返回为准）。

## 测试（server vitest，对齐 reviews.test.ts / merchant.test.ts 现有模式）

- 隐藏后：店铺 `ratingSum/ratingCount/rating` 正确回滚；公开列表不再包含该评价；
  商家列表仍包含且 `hidden: true`；顾客订单详情仍能看到评价。
- 恢复后：聚合加回，公开列表重新出现。
- 幂等：对已隐藏的评价重复隐藏，评分不重复扣减（恢复同理）。
- 鉴权：非店主 PATCH/GET 返回 403；不存在的店铺 404；reviewId 不属于该店 404。
- 边界：唯一一条评价隐藏后 `ratingCount = 0`，rating 回到 5。

## 不做的事（YAGNI）

- 不做商家回复评价、评分统计图表、申诉/举报流程。
- 不做隐藏原因填写、隐藏次数限制、平台管理员审计页。
