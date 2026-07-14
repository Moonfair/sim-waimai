# 审核详情页设计

日期：2026-07-14 · 状态：已确认

## 背景

`/admin/review` 审核队列目前是纯列表卡片：每张卡片只展示 `ModerationItemDto` 里的摘要字段（名称/品类/标签/描述截断/发布者/AI 建议徽标），看不到用户提交的完整内容（横幅图、配送参数、商品规格组等），AI 建议也只有一行摘要,没有"AI 未接入"这种显式状态。管理员要审核，尤其是要驳回时给出靠谱理由，需要看到全貌。

## 决策

点击列表项跳转到一个独立路由的审核详情页,展示该店铺/商品提交的全部字段 + AI 建议(未接入时显式标注"未接入"),并允许直接在详情页完成通过/驳回,不强制退回列表操作。

## 路由与数据

新增两个页面路由(`src/App.tsx`,复用 `RequireAdmin` 包裹):

- `/admin/review/restaurant/:id`
- `/admin/review/item/:restaurantId/:itemId`

新增两个后端只读接口(`server/src/routes/admin.ts`,`requireAdmin`,与现有 `POST .../review` 路由同级):

- `GET /api/admin/restaurants/:id`
- `GET /api/admin/restaurants/:id/items/:itemId`

不复用/不扩展现有 `GET /api/admin/moderation` 列表接口 —— 列表一次最多带 100 行(`LIST_LIMIT`),把横幅图/规格组等完整字段塞进每一行会显著拉大列表响应体;详情页每次只按需拉一条。

复用现有 mapper(`server/src/lib/mappers.ts`)取"提交内容"部分:

- 店铺:`toRestaurant(row, [])`(空菜单数组 —— 店铺详情页不展示菜单,菜品各自独立走审核)
- 商品:`toMenuItem(row)`

在此之上叠加审核 + AI 元信息(与 `ModerationItemDto` 保持字段命名一致,新增 `reviewedAt`):

```ts
// shared/src/api.ts
interface ModerationReviewMeta {
  reviewStatus: ReviewStatus;
  rejectReason?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  ownerUsername?: string | null;
  aiVerdict?: AiVerdict | null;
  aiReason?: string | null;
  aiConfidence?: number | null;
}

interface ModerationRestaurantDetailDto extends ModerationReviewMeta {
  targetType: 'restaurant';
  restaurant: Restaurant; // menu 为空数组
}

interface ModerationItemDetailDto extends ModerationReviewMeta {
  targetType: 'menuItem';
  restaurantId: string;
  restaurantName: string;
  item: MenuItem;
}
```

`ModerationItemDto`(列表用)保持不变,不新增 `reviewedAt`(列表不展示,YAGNI)。

## 详情页内容

**店铺**:emoji、店名、品类、标签、`bgColor` 色块、横幅图(`assetUrl()` 渲染真图,无图时留空不占位)、配送费/起送价/配送时长、菜单分类列表、发布者、审核状态徽标、驳回原因(仅 rejected 时)、审核时间(`reviewedAt`,`toLocaleString('zh-CN')` 格式,无则不显示该行)。

**商品**:emoji、商品名、描述、价格、卡路里、菜单分类、"人气"标记(如有)、商品图(真图)、规格组列表(每组名称 + 单选/多选 + 选项名称与加价,`priceDelta` 用现有金额格式化)、所属店铺名(纯文本展示,不做跳转)、发布者、审核状态、驳回原因、审核时间。

**AI 建议区块**(店铺/商品详情页布局一致,固定展示,不像列表那样"没有就不显示"):

- `aiVerdict` 非空:复用列表已有的 `AI_VERDICT_BADGE` 配色(approve 绿/reject 红/uncertain 琥珀),完整展示 `aiReason` 全文 + `aiConfidence` 转百分比。
- `aiVerdict` 为空:灰色中性徽标"🤖 AI 审核：未接入",不展示 reason/confidence 字段。

**操作区**(页面底部,复用列表卡片已有的驳回原因输入交互):

- 按钮可用性与列表卡片一致:仅在"已经是该状态"时隐藏对应按钮(`reviewStatus==='approved'` 时隐藏"通过"按钮,`==='rejected'` 时隐藏"驳回"按钮),其余状态下按钮始终可点(管理员可在任意状态间改判,复用现有 `POST .../review` 接口,无 `WHERE pending` 限制)。
- 提交成功后 `navigate('/admin/review')` 返回列表,并通过 `location.state` 带回当前审核状态 tab(店铺/商品是从哪个 tab 点进详情的,回去还停在那个 tab,不强制跳回"待审核")。

## 列表页联动改动

`src/pages/AdminReview.tsx`:

- 卡片信息区新增一行"查看详情 ›"文字链接(样式沿用 `MerchantEdit.tsx` 的"查看顾客视角 ›"),点击跳转对应详情路由。
- AI 徽标从"点击展开 `aiReason`"简化为纯展示徽标(移除 `expandedKey` state 及展开逻辑)—— 展开后的完整信息现在由详情页承担,避免同一张卡片上"AI 徽标点击"和"查看详情点击"两个语义重叠的交互。
- 通过/驳回按钮保留在列表卡片上不变。

## 错误处理

- 详情接口 404(店铺/商品不存在,例如被删除或 id 拼错):详情页展示"该内容不存在或已变更" + 返回列表的链接,不崩溃。
- 详情接口 403/401:与现有 `RequireAdmin`/`requireAdmin` 一致,分别重定向登录页或首页。

## 测试(`server/src/test/moderation.test.ts` 新增用例)

1. `GET /api/admin/restaurants/:id` 返回完整店铺字段(含 `bannerImage`/`deliveryFee` 等列表接口不返回的字段)+ 审核/AI 元信息;非管理员 401/403;未知 id 404。
2. `GET /api/admin/restaurants/:id/items/:itemId` 同上,含 `optionGroups` 完整还原;未知 itemId 404。
3. 注入 AI reviewer 审核后,详情接口的 `aiVerdict/aiReason/aiConfidence` 与列表接口返回值一致;未跑 AI(无 key)的项 `aiVerdict` 为 `null`。
