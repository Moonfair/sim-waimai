# 打烊店铺可见性 + 商品硬删除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打烊店铺在列表/搜索里仍展示(带"已打烊"标签)且详情页可访问但禁止下单;商家菜品管理新增硬删除。

**Architecture:** 后端把 `restaurants.isActive` 通过共享 DTO 透出给顾客端,去掉列表/详情端点里"打烊即隐藏/404"的过滤条件(推荐端点、下单校验保持不变);商家端新增一个真正 `DELETE FROM menu_items` 的路由,与现有"下架"(软删除,`isListed=false`)接口并存。前端据此渲染"已打烊"标签、禁用购买控件、新增删除按钮。

**Tech Stack:** Hono + Drizzle + PostgreSQL(后端,`server/`),React + Vite + TypeScript(前端,`src/`),共享类型 `shared/src/`,后端测试用 vitest(`server/src/test/*.test.ts`,直接跑在开发 Postgres 上)。

## Global Constraints

- 金额、分页、认证等既有约定不受影响,本次改动不涉及。
- 不新增数据库 migration(`isActive`/`isListed` 字段均已存在)。
- 推荐端点(`server/src/routes/recommendations.ts`)、下单校验(`server/src/routes/orders.ts`)、收藏端点(`server/src/routes/favorites.ts`)**保持不变**——推荐池仍只选营业中的店,下单时的服务端兜底校验保留。
- 前端目前只有 `src/lib/*.test.ts` 这类纯函数单测,没有 React 组件测试框架;本计划里的前端任务用 `npx tsc -b`(类型检查)替代自动化测试,不引入新的测试框架。
- 后端测试运行前确保开发数据库已启动:`npm run db:up`。跑单个后端测试文件用 `npm -w server run test -- src/test/<file>.test.ts`(相对 `server/` 目录的路径)。

---

### Task 1: 打烊店铺不再从列表/详情里消失

**Files:**
- Modify: `shared/src/api.ts:38-56`(`RestaurantSummary` 接口)
- Modify: `shared/src/types.ts:44-69`(`Restaurant` 接口)
- Modify: `server/src/lib/mappers.ts:22-41`(`toRestaurantSummary`)
- Modify: `server/src/routes/restaurants.ts:20-36`(`GET /`)、`74-98`(`GET /:id`)
- Test: `server/src/test/restaurants.test.ts`
- Test: `server/src/test/merchant.test.ts:259-272`(更新既有断言)

**Interfaces:**
- Produces: `RestaurantSummary.isActive: boolean`、`Restaurant.isActive: boolean`(顾客端 DTO 新字段,后续任务/前端组件都读这个字段判断"是否打烊")。

- [ ] **Step 1: 更新 `merchant.test.ts` 里过时的断言,让它反映新行为(这是本任务的"失败测试")**

把 `server/src/test/merchant.test.ts:259-272` 的整个 `it(...)` 块替换成:

```ts
  it('closing the shop (isActive=false) keeps it visible but flags it as closed', async () => {
    await req(`/api/merchant/restaurants/${shopId}`, ownerCookie, {
      method: 'PATCH',
      body: { isActive: false },
    });

    const publicList = (await (await app.request('/api/restaurants')).json()) as RestaurantSummary[];
    const listed = publicList.find((r) => r.id === shopId);
    expect(listed).toBeDefined();
    expect(listed!.isActive).toBe(false);

    const detailRes = await app.request(`/api/restaurants/${shopId}`);
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as Restaurant;
    expect(detail.isActive).toBe(false);
    expect(detail.menu.length).toBeGreaterThan(0);

    // merchant still sees it
    const mine = (await (await req('/api/merchant/restaurants', ownerCookie)).json()) as Array<
      RestaurantSummary & { isActive: boolean }
    >;
    expect(mine.find((r) => r.id === shopId)?.isActive).toBe(false);
  });
```

同时在 `server/src/test/restaurants.test.ts` 的 `'returns the 14 seeded restaurants without menus'`(line 52-61)测试里,紧跟 `expect(kfc!.isPlayerMade).toBe(false);` 之后加一行:

```ts
    expect(kfc!.isActive).toBe(true);
```

- [ ] **Step 2: 运行测试,确认按预期失败**

Run: `npm -w server run test -- src/test/merchant.test.ts`
Expected: FAIL —— `listed!.isActive` 是 `undefined`(字段还没透出),且 `publicList.find(...)` 目前会因为列表过滤而找不到这家店,`detailRes.status` 目前是 404。

Run: `npm -w server run test -- src/test/restaurants.test.ts`
Expected: FAIL —— `kfc!.isActive` 是 `undefined`。

- [ ] **Step 3: 共享类型加字段**

在 `shared/src/api.ts` 的 `RestaurantSummary` 接口(line 51-52 之间)加:

```ts
  /** 玩家自制商家(ownerId 非空);系统种子商家为 false。 */
  isPlayerMade: boolean;
  /** 店铺是否营业中;false = 已打烊(仍可查看详情,但不可下单)。 */
  isActive: boolean;
  bannerImage?: string;
```

在 `shared/src/types.ts` 的 `Restaurant` 接口里,`tags: string[];`(line 57)后面加:

```ts
  tags: string[];
  isActive: boolean;
```

- [ ] **Step 4: mapper 透出字段**

修改 `server/src/lib/mappers.ts` 的 `toRestaurantSummary`(line 22-41),在返回对象里加 `isActive`:

```ts
export function toRestaurantSummary(row: RestaurantRow, isFavorite?: boolean): RestaurantSummary {
  const summary: RestaurantSummary = {
    id: row.id,
    name: row.name,
    category: row.category as Category,
    rating: row.rating,
    ratingCount: row.ratingCount,
    monthlyOrders: row.monthlyOrders,
    deliveryFee: fenToYuan(row.deliveryFeeFen),
    deliveryTime: row.deliveryTime,
    minOrder: fenToYuan(row.minOrderFen),
    emoji: row.emoji,
    bgColor: row.bgColor,
    tags: row.tags,
    isPlayerMade: row.ownerId !== null,
    isActive: row.isActive,
  };
  if (row.bannerImage) summary.bannerImage = row.bannerImage;
  if (isFavorite !== undefined) summary.isFavorite = isFavorite;
  return summary;
}
```

(`toRestaurant` 已经用 `...toRestaurantSummary(row)` 展开,`isActive` 会自动带到 `Restaurant` 上,不用改。)

- [ ] **Step 5: 去掉列表/详情端点里的 isActive 过滤**

修改 `server/src/routes/restaurants.ts` 的 `GET /`(line 22):

```ts
    const filters = [eq(restaurants.reviewStatus, 'approved')];
```

修改 `GET /:id`(line 81)的 404 条件,去掉 `!row.isActive`:

```ts
    if (!row || (row.reviewStatus !== 'approved' && !isOwner)) {
      return c.json({ error: '餐厅不存在' }, 404);
    }
```

- [ ] **Step 6: 运行测试,确认通过**

Run: `npm -w server run test -- src/test/restaurants.test.ts src/test/merchant.test.ts`
Expected: PASS(全部测试,包括其他既有断言不受影响)。

- [ ] **Step 7: Commit**

```bash
git add shared/src/api.ts shared/src/types.ts server/src/lib/mappers.ts server/src/routes/restaurants.ts server/src/test/restaurants.test.ts server/src/test/merchant.test.ts
git commit -m "feat(server): 打烊店铺不再从公开列表/详情里消失，透出 isActive"
```

---

### Task 2: 搜索结果同样不再过滤打烊店铺

**Files:**
- Modify: `server/src/routes/search.ts:27-56`
- Test: `server/src/test/search.test.ts`

**Interfaces:**
- Consumes: `RestaurantSummary.isActive`(Task 1 已添加)。

- [ ] **Step 1: 写失败测试**

在 `server/src/test/search.test.ts` 的 `describe('GET /api/search', ...)` 块里,`it('matches approved shops/items ...')` 测试后面新增一个测试:

```ts
  it('includes a closed (isActive=false) shop and its items, flagged as inactive', async () => {
    const shopName = `搜索测试打烊店_${stamp}`;
    const itemName = `搜索测试打烊菜_${stamp}`;
    const { shop, item, userId: ownerId } = await createShopWithItem(
      `t_search_closed_${stamp}`,
      shopName,
      itemName,
    );

    await db
      .update(restaurants)
      .set({ reviewStatus: 'approved', isActive: false })
      .where(eq(restaurants.id, shop.id));
    await db
      .update(menuItems)
      .set({ reviewStatus: 'approved' })
      .where(and(eq(menuItems.restaurantId, shop.id), eq(menuItems.id, item.id)));

    try {
      const shopHit = await getJson<SearchResultDto>(`/api/search?q=${encodeURIComponent(shopName)}`);
      expect(shopHit.body.restaurants.map((r) => r.id)).toEqual([shop.id]);
      expect(shopHit.body.restaurants[0]!.isActive).toBe(false);

      const itemHit = await getJson<SearchResultDto>(`/api/search?q=${encodeURIComponent(itemName)}`);
      expect(itemHit.body.items.map((i) => i.id)).toEqual([item.id]);
    } finally {
      await db.delete(restaurants).where(eq(restaurants.id, shop.id));
      await db.delete(users).where(eq(users.id, ownerId));
    }
  });
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npm -w server run test -- src/test/search.test.ts`
Expected: FAIL —— 两个断言都会得到空数组,因为 `search.ts` 当前对 `restaurants.isActive` 做了过滤。

- [ ] **Step 3: 去掉两处 isActive 过滤**

修改 `server/src/routes/search.ts`,店铺名搜索(line 30-36):

```ts
  const shopRows = await db
    .select()
    .from(restaurants)
    .where(and(ilike(restaurants.name, `%${q}%`), eq(restaurants.reviewStatus, 'approved')))
    .orderBy(asc(restaurants.sortOrder), asc(restaurants.createdAt))
    .limit(RESULT_LIMIT);
```

菜品搜索(line 47-55):

```ts
    .where(
      and(
        ilike(menuItems.name, `%${q}%`),
        eq(menuItems.isListed, true),
        eq(menuItems.reviewStatus, 'approved'),
        eq(restaurants.reviewStatus, 'approved'),
      ),
    )
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npm -w server run test -- src/test/search.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/search.ts server/src/test/search.test.ts
git commit -m "feat(server): 搜索结果同样不再过滤打烊店铺"
```

---

### Task 3: 商品管理新增硬删除接口

**Files:**
- Modify: `server/src/routes/merchant.ts:446-456`(在现有下架路由后追加新路由)
- Test: `server/src/test/merchant.test.ts`

**Interfaces:**
- Produces: `DELETE /api/merchant/restaurants/:id/items/:itemId/permanent` → `200 { ok: true }` 成功;`403 { error: '无权管理该店铺' }` 非店主;`404 { error: '菜品不存在' }` 菜品不存在(含已被删除)。

- [ ] **Step 1: 写失败测试**

在 `server/src/test/merchant.test.ts` 的 `describe('menu item management', ...)` 里,`'delist hides the item publicly ...'`(line 232-257)测试后面、`'closing the shop ...'`测试前面,插入:

```ts
  it('permanently deletes an item regardless of its listed state', async () => {
    const created = await req(`/api/merchant/restaurants/${shopId}/items`, ownerCookie, {
      method: 'POST',
      body: { name: '待删除测试菜', price: 9, emoji: '🍚', menuCategory: '招牌' },
    });
    const toDelete = (await created.json()) as MerchantMenuItemDto;

    expect(
      (
        await req(`/api/merchant/restaurants/${shopId}/items/${toDelete.id}/permanent`, randoCookie, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(403);

    const res = await req(
      `/api/merchant/restaurants/${shopId}/items/${toDelete.id}/permanent`,
      ownerCookie,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(200);

    const merchantView = (await (
      await req(`/api/merchant/restaurants/${shopId}`, ownerCookie)
    ).json()) as MerchantRestaurantDto;
    expect(merchantView.menu.some((m) => m.id === toDelete.id)).toBe(false);

    const notFound = await req(
      `/api/merchant/restaurants/${shopId}/items/${toDelete.id}/permanent`,
      ownerCookie,
      { method: 'DELETE' },
    );
    expect(notFound.status).toBe(404);
  });
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npm -w server run test -- src/test/merchant.test.ts`
Expected: FAIL —— 路由不存在,Hono 对未匹配路径返回 404,第一个 403 断言会失败(实际拿到 404)。

- [ ] **Step 3: 加新路由**

在 `server/src/routes/merchant.ts` 的现有下架路由(line 446-455)后面追加(注意链式调用要把原来结尾的 `;` 移到新路由后面):

```ts
  .delete('/restaurants/:id/items/:itemId', requireAuth, async (c) => {
    const owned = await ownedRestaurant(c.get('user'), c.req.param('id'));
    if ('error' in owned) return c.json({ error: owned.error }, owned.status);
    const [row] = await db
      .update(menuItems)
      .set({ isListed: false })
      .where(and(eq(menuItems.restaurantId, owned.row.id), eq(menuItems.id, c.req.param('itemId'))))
      .returning();
    if (!row) return c.json({ error: '菜品不存在' }, 404);
    return c.json({ ok: true });
  })
  .delete('/restaurants/:id/items/:itemId/permanent', requireAuth, async (c) => {
    const owned = await ownedRestaurant(c.get('user'), c.req.param('id'));
    if ('error' in owned) return c.json({ error: owned.error }, owned.status);
    const [row] = await db
      .delete(menuItems)
      .where(and(eq(menuItems.restaurantId, owned.row.id), eq(menuItems.id, c.req.param('itemId'))))
      .returning();
    if (!row) return c.json({ error: '菜品不存在' }, 404);
    return c.json({ ok: true });
  });
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npm -w server run test -- src/test/merchant.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/merchant.ts server/src/test/merchant.test.ts
git commit -m "feat(server): 商品管理新增永久删除接口"
```

---

### Task 4: 店铺卡片展示"已打烊"标签

**Files:**
- Modify: `src/components/RestaurantCard.tsx`

**Interfaces:**
- Consumes: `RestaurantSummary.isActive`(Task 1)。

- [ ] **Step 1: 加标签 + 变暗态**

修改 `src/components/RestaurantCard.tsx` 全文为:

```tsx
import { useNavigate } from 'react-router-dom';
import type { RestaurantSummary } from '@sim-waimai/shared';
import { assetUrl } from '../lib/assetUrl';

interface Props {
  restaurant: RestaurantSummary;
}

export default function RestaurantCard({ restaurant }: Props) {
  const navigate = useNavigate();
  const closed = !restaurant.isActive;

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-xl overflow-hidden shadow-sm cursor-pointer active:scale-95 transition-transform ${closed ? 'opacity-60' : ''}`}
      onClick={() => navigate(`/restaurant/${restaurant.id}`)}
    >
      <div
        className="h-36 flex items-center justify-center text-6xl relative"
        style={!restaurant.bannerImage ? { background: `linear-gradient(135deg, ${restaurant.bgColor}dd, ${restaurant.bgColor}88)` } : undefined}
      >
        {restaurant.bannerImage ? (
          <img
            src={assetUrl(restaurant.bannerImage)}
            alt={restaurant.name}
            className={`absolute inset-0 w-full h-full object-cover ${closed ? 'grayscale' : ''}`}
          />
        ) : (
          <span className="drop-shadow-lg">{restaurant.emoji}</span>
        )}
        {closed && (
          <span className="absolute top-2 left-3 text-xs px-2 py-0.5 rounded-full bg-gray-900/70 text-white font-medium backdrop-blur-sm">
            已打烊
          </span>
        )}
        <div className="absolute bottom-2 left-3 flex gap-1">
          {restaurant.tags.slice(0, 2).map(tag => (
            <span
              key={tag}
              className="text-xs px-1.5 py-0.5 rounded text-white font-medium"
              style={{ backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="p-3">
        <div className="flex items-start justify-between">
          <h3 className="font-bold text-gray-900 dark:text-gray-100 text-base">{restaurant.name}</h3>
          <span className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{restaurant.deliveryTime}分钟</span>
        </div>

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

        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            配送费 <span className="text-orange-500 font-medium">¥{restaurant.deliveryFee}</span>
          </span>
          <span className="text-xs px-2 py-0.5 bg-orange-50 dark:bg-orange-500/10 text-orange-500 rounded-full border border-orange-100 dark:border-orange-500/20">
            {restaurant.category}
          </span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc -b`
Expected: 无报错(`RestaurantSummary.isActive` 已在 Task 1 加好)。

- [ ] **Step 3: 手动验证**

启动 `npm run dev`,打开首页,在 Postgres 里把某个种子商家(如 `heytea`)的 `is_active` 改成 `false`(可用 `psql` 或临时脚本执行 `UPDATE restaurants SET is_active=false WHERE id='heytea';`),刷新首页确认:该店卡片仍显示、变暗、左上角出现"已打烊"标签,点击仍能进入详情页。验证完把 `is_active` 改回 `true`。

- [ ] **Step 4: Commit**

```bash
git add src/components/RestaurantCard.tsx
git commit -m "feat(web): 店铺卡片展示已打烊标签"
```

---

### Task 5: 详情页打烊提示 + 禁用购买

**Files:**
- Modify: `src/pages/Restaurant.tsx:159-190`
- Modify: `src/components/MenuItem.tsx`

**Interfaces:**
- Consumes: `Restaurant.isActive`(Task 1)。
- Produces: `MenuItem` 新增可选 prop `purchasable?: boolean`(默认 `true`)。

- [ ] **Step 1: `Restaurant.tsx` 加打烊横幅,并把 `purchasable` 传给 `MenuItemComponent`**

在 `src/pages/Restaurant.tsx` 里,`{/* Tags */}` 块(line 153-159)后面、`{/* Menu area */}` 块(line 161)前面插入:

```tsx
      {restaurant.isActive === false && (
        <div className="mx-4 mt-3 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs rounded-2xl px-4 py-3">
          🌙 该店铺已打烊，暂不可下单
        </div>
      )}
```

把 line 187 的

```tsx
              <MenuItemComponent key={item.id} item={item} restaurant={restaurant} />
```

改成:

```tsx
              <MenuItemComponent
                key={item.id}
                item={item}
                restaurant={restaurant}
                purchasable={restaurant.isActive}
              />
```

- [ ] **Step 2: `MenuItem.tsx` 支持 `purchasable` 禁用态**

在 `src/components/MenuItem.tsx` 的 `Props` 接口(line 13-16)加字段:

```tsx
interface Props {
  item: MenuItemType;
  restaurant: Restaurant;
  purchasable?: boolean;
}
```

函数签名(line 18)改成:

```tsx
export default function MenuItem({ item, restaurant, purchasable = true }: Props) {
```

把购买控件那块(line 121-162 的 `<div className="flex items-center justify-end mt-1">...</div>`)最外层加一个 `!purchasable` 分支,放在最前面判断:

```tsx
        <div className="flex items-center justify-end mt-1">
          {!purchasable ? (
            <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-base font-bold leading-none text-gray-400 dark:text-gray-500">
              +
            </div>
          ) : hasOptions ? (
            <div className="relative">
              <button
                className="px-2.5 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-xs font-bold leading-none shadow-sm whitespace-nowrap"
                onClick={() => setSheetOpen(true)}
              >
                改规格
              </button>
              {customizedTotalQty > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center font-bold">
                  {customizedTotalQty}
                </span>
              )}
            </div>
          ) : quantity > 0 ? (
            <div className="flex items-center gap-2">
              <button
                className="w-6 h-6 rounded-full border-2 border-orange-400 text-orange-500 flex items-center justify-center text-base font-bold leading-none"
                onClick={decrement.wrapClick(() => updateQuantity(item.id, quantity - 1))}
                {...decrement.handlers}
              >
                −
              </button>
              <span className="text-sm font-bold text-gray-800 dark:text-gray-100 w-4 text-center">{quantity}</span>
              <button
                className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-base font-bold leading-none shadow-sm"
                onClick={increment.wrapClick(() => addItem(item, restaurant))}
                {...increment.handlers}
              >
                +
              </button>
            </div>
          ) : (
            <button
              className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-base font-bold leading-none shadow-sm"
              onClick={() => addItem(item, restaurant)}
            >
              +
            </button>
          )}
        </div>
```

这样打烊时既不渲染真实的加购按钮,也不会挂载 `useLongPressStep` 的按下/长按事件处理器,不用额外处理"禁用态还能被长按触发"的问题。

同理,把"改规格"弹出的 `MenuItemOptionsSheet`(line 165-174)只在 `purchasable` 为真时可能触发——由于按钮本身已经不渲染,`sheetOpen` 永远不会被设为 `true`,不需要额外改动。

- [ ] **Step 3: 类型检查**

Run: `npx tsc -b`
Expected: 无报错。

- [ ] **Step 4: 手动验证**

`npm run dev`,把某个商家 `is_active` 改成 `false` 后,访问 `/restaurant/<id>` 详情页,确认:顶部菜单区上方出现打烊提示横幅;每个菜品右侧的加购控件(无论有无规格、有无已选数量)都变成灰色圆点、点击无反应;`CartBar` 不出现(因为购物车没有新商品可加)。改回 `true` 后确认恢复正常可加购。

- [ ] **Step 5: Commit**

```bash
git add src/pages/Restaurant.tsx src/components/MenuItem.tsx
git commit -m "feat(web): 详情页展示打烊提示并禁用购买"
```

---

### Task 6: 商品管理新增"删除"按钮

**Files:**
- Modify: `src/pages/MerchantEdit.tsx`

**Interfaces:**
- Consumes: `DELETE /merchant/restaurants/:id/items/:itemId/permanent`(Task 3)。

- [ ] **Step 1: 加状态和 handler**

在 `src/pages/MerchantEdit.tsx` 的 state 声明(line 23,`togglingActive` 后面)加:

```tsx
  const [togglingActive, setTogglingActive] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
```

在 `handleToggleListed`(line 118-125)后面加:

```tsx
  const handleDeleteItem = async (item: MerchantMenuItemDto) => {
    setDeletingId(item.id);
    try {
      await api.del(`/merchant/restaurants/${shop.id}/items/${item.id}/permanent`);
      setDeleteConfirmId(null);
      reload();
    } finally {
      setDeletingId(null);
    }
  };
```

- [ ] **Step 2: 加删除按钮(行内二次确认)**

在菜品行的按钮区(line 305-319,「编辑」「下架/上架」两个按钮)后面加:

```tsx
                  <button
                    className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1"
                    onClick={() => {
                      setEditorItem(item);
                      setEditorOpen(true);
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className={`text-xs px-2 py-1 ${item.isListed ? 'text-red-400' : 'text-green-500'}`}
                    onClick={() => handleToggleListed(item)}
                  >
                    {item.isListed ? '下架' : '上架'}
                  </button>
                  {deleteConfirmId === item.id ? (
                    <>
                      <button
                        className="text-xs text-gray-400 px-2 py-1"
                        onClick={() => setDeleteConfirmId(null)}
                      >
                        取消
                      </button>
                      <button
                        className="text-xs text-red-500 px-2 py-1 disabled:opacity-50"
                        disabled={deletingId === item.id}
                        onClick={() => handleDeleteItem(item)}
                      >
                        {deletingId === item.id ? '删除中…' : '确认删除'}
                      </button>
                    </>
                  ) : (
                    <button
                      className="text-xs text-red-500 px-2 py-1"
                      onClick={() => setDeleteConfirmId(item.id)}
                    >
                      删除
                    </button>
                  )}
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc -b`
Expected: 无报错。

- [ ] **Step 4: 手动验证**

`npm run dev`,进入任一自己拥有的商家的商品管理页:确认每行菜品「编辑」「下架/上架」后面多了一个红色「删除」按钮;点击后原按钮变成「取消」/「确认删除」;点「取消」恢复;点「确认删除」后该菜品从列表消失且刷新页面后不再出现;分别对一个"上架中"和一个"已下架"的菜品各测一次删除,确认两种状态都能删除成功。

- [ ] **Step 5: Commit**

```bash
git add src/pages/MerchantEdit.tsx
git commit -m "feat(web): 商品管理新增删除按钮"
```

---

## Self-Review Notes

- **Spec coverage:** 方案一的列表/搜索/详情放宽(Task 1、2)、卡片标签(Task 4)、详情页横幅与禁购(Task 5)全部覆盖;方案二的硬删除接口(Task 3)与前端删除按钮(Task 6)全部覆盖。推荐池、下单校验、收藏端点按 spec 要求保持不变,未在任何任务里触碰。
- **Placeholder scan:** 每个 Step 都有完整代码块,没有"实现类似逻辑"之类的占位描述。
- **Type consistency:** `RestaurantSummary.isActive` / `Restaurant.isActive`(Task 1)在 Task 4、5 里按同名字段读取;`MenuItem` 新增的 `purchasable` prop 名称在 Task 5 的两处改动(`Restaurant.tsx` 传参、`MenuItem.tsx` 声明)保持一致;新增路由路径 `/restaurants/:id/items/:itemId/permanent`(Task 3)与前端调用路径(Task 6)完全一致。
