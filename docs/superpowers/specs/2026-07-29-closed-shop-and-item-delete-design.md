# 打烊店铺可见性 + 商品硬删除 设计

## 背景

两个独立的体验优化,合并在一份 spec 里,后续拆成两个实施任务:

1. 店铺打烊(`restaurants.isActive = false`)后,顾客端目前会完全看不到这家店(列表被过滤、详情页 404)。希望改为:列表仍展示(带"已打烊"标签),详情页可访问,但屏蔽下单。
2. 商家端「菜品管理」目前只有「编辑」「下架」两个操作,「下架」实际是软删除(`isListed=false`,菜品行永久留在列表里)。希望新增「删除」,做真正的硬删除。

## 范围确认(已与用户对齐)

- 打烊店铺:首页网格、分类列表、搜索结果**都要**继续展示(带"已打烊"标签);首页「推荐」区块**不**包含打烊店(推荐仍只从营业中的店里选)。
- 已有收藏/历史订单等入口本来就不受影响(favorites.ts 从未按 isActive 过滤)。
- 删除菜品:彻底硬删除(不可恢复),前端需二次确认;不限制菜品当前是上架还是下架状态,都允许删除。

## 一、打烊店铺仍可访问,但不可下单

### 数据契约变化

- `shared/src/api.ts` `RestaurantSummary` 新增必填字段 `isActive: boolean`。
- `shared/src/types.ts` `Restaurant` 新增必填字段 `isActive: boolean`。
- `server/src/lib/mappers.ts` `toRestaurantSummary()` 补上 `isActive: row.isActive`(目前完全没有透出这个字段给顾客端)。

### 后端行为变化

- `server/src/routes/restaurants.ts`
  - `GET /restaurants`(列表):过滤条件里去掉 `eq(restaurants.isActive, true)`,只保留 `eq(restaurants.reviewStatus, 'approved')`。
  - `GET /restaurants/:id`(详情):404 条件从 `!row || !row.isActive || (row.reviewStatus !== 'approved' && !isOwner)` 改为 `!row || (row.reviewStatus !== 'approved' && !isOwner)`——打烊不再是 404 的理由,未过审仍然是。
- `server/src/routes/search.ts`:店铺名搜索(`shopRows` 查询)和菜品搜索(`itemRows` 查询,内连 `restaurants`)都去掉 `eq(restaurants.isActive, true)` 条件,保留 `reviewStatus='approved'`(以及菜品自身的 `isListed`/`reviewStatus` 条件不变)。
- **不改**的地方(维持现状,均已核对符合本次范围):
  - `server/src/routes/recommendations.ts`:继续要求 `isActive=true`,打烊店不进推荐池。
  - `server/src/routes/orders.ts`:下单时的服务端校验(`!restaurant.isActive || reviewStatus !== 'approved'` → `400 { error: '餐厅不存在或已休息' }`)保留,作为最终兜底。
  - `server/src/routes/favorites.ts`:本来就不按 `isActive` 过滤,行为不变(以后自动带上 `isActive` 字段是 mappers 改动的副作用,符合预期)。

### 前端行为变化

- `src/components/RestaurantCard.tsx`:`restaurant.isActive === false` 时,卡片视觉上变暗(如降低图片/整体不透明度或去饱和),并叠加一个"已打烊"标签(参考卡片右上角标签的现有样式做法)。点击行为不变,仍跳转详情页。
- `src/pages/Restaurant.tsx`:`restaurant.isActive === false` 时,在菜单区上方展示一条提示横幅(如"该店铺已打烊,暂不可下单"),并把该状态以 `purchasable={restaurant.isActive}` 形式传给每个 `MenuItemComponent`。
- `src/components/MenuItem.tsx`:新增可选 prop `purchasable`(默认 `true`)。为 `false` 时:
  - 「+」按钮、数量步进器(+/−)、「改规格」按钮均渲染为禁用态(视觉置灰 + 不可点击),不触发 `addItem`/`updateQuantity`。
  - 其余展示(图片、价格、描述等)不变。

### 明确不处理的边界情况

- 用户在店铺打烊前已把商品加入购物车、打烊后仍留在购物车里:不做特殊清理或拦截,提交订单时会走 `orders.ts` 现有的服务端校验并把错误信息展示给用户(`Cart.tsx` 已有的 `submitError` 展示路径)。这条路径已经存在,属于现状,不在本次改动范围内。

## 二、商品管理新增「删除」(硬删除)

### 为什么硬删除是安全的

`orders.items` 是 JSONB 快照(`OrderItemSnapshot[]`),`menuItemId` 只是普通字符串字段,**不是**外键——不像 `restaurants.id` 那样被 `orders.restaurantId` 通过 FK 约束住。因此硬删除 `menu_items` 的一行,不会破坏任何历史订单的引用完整性,也不需要额外的级联处理。

### 后端

在 `server/src/routes/merchant.ts` 现有的下架接口(`.delete('/restaurants/:id/items/:itemId', ...)`,line 446-455,语义其实是 `isListed=false` 软下架)之后,新增一个路由:

```
.delete('/restaurants/:id/items/:itemId/permanent', requireAuth, async (c) => {
  const owned = await ownedRestaurant(c.get('user'), c.req.param('id'));
  if ('error' in owned) return c.json({ error: owned.error }, owned.status);
  const [row] = await db
    .delete(menuItems)
    .where(and(eq(menuItems.restaurantId, owned.row.id), eq(menuItems.id, c.req.param('itemId'))))
    .returning();
  if (!row) return c.json({ error: '菜品不存在' }, 404);
  return c.json({ ok: true });
})
```

权限校验复用现有的 `ownedRestaurant()` 辅助函数,与其他菜品路由一致。不限制 `isListed` 状态,上架/下架中的菜品都能删除。原有的 `DELETE /restaurants/:id/items/:itemId`(下架)接口保持不变。

### 前端

`src/pages/MerchantEdit.tsx` 菜品管理列表,每行「编辑」「下架/上架」按钮后面新增「删除」按钮。交互沿用本项目已有的行内二次确认模式(参考 `src/pages/MerchantReviews.tsx` 里 `confirmId` 的写法):

- 默认显示「删除」按钮(红色/警示色文字按钮,风格与「下架」一致)。
- 点击后该行变成「取消」/「确认删除」两个按钮。
- 点「确认删除」调用 `DELETE /merchant/restaurants/:id/items/:itemId/permanent`,成功后 `reload()` 刷新列表(该菜品会从列表消失)。
- 点「取消」恢复成默认的「删除」按钮态。

## 影响范围小结

| 层 | 文件 | 改动类型 |
|---|---|---|
| 共享类型 | `shared/src/api.ts`, `shared/src/types.ts` | 新增字段 |
| 后端 | `server/src/lib/mappers.ts` | 补字段透出 |
| 后端 | `server/src/routes/restaurants.ts` | 去掉两处 isActive 过滤/404 |
| 后端 | `server/src/routes/search.ts` | 去掉两处 isActive 过滤 |
| 后端 | `server/src/routes/merchant.ts` | 新增硬删除路由 |
| 前端 | `src/components/RestaurantCard.tsx` | 新增打烊标签态 |
| 前端 | `src/pages/Restaurant.tsx` | 新增打烊横幅 + 传 prop |
| 前端 | `src/components/MenuItem.tsx` | 新增 `purchasable` 禁用态 |
| 前端 | `src/pages/MerchantEdit.tsx` | 新增删除按钮 + 二次确认 |

不涉及数据库 schema 变更(两个字段 `isActive`/`isListed` 均已存在),不需要新的 migration。
