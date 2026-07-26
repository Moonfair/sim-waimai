# 已通过页面拆分 AI 审核通过 / 已人工核验 子页签 — 设计

## 背景

审核管理页（`/admin/review`）目前有三个 Tab：待审核 / 已通过 / 已驳回。已通过 Tab 混合展示 AI 审核通过和管理员人工审核通过的内容，无法区分哪些内容只经过 AI 判断、尚未有人复核过。

用户上传的内容经 AI 审核通过后已经直接展示给终端用户（现状如此），但需要一个专门的队列让管理员对 AI 通过的内容做事后复核（复审通过 / 驳回），并且能清楚看到哪些内容是"AI 判的"、哪些是"人确认过的"。

## 数据模型

**不新增字段、不改 schema、不需要迁移。** 复用 `restaurants` / `menu_items` / `reviews` 三张表已有的 `reviewStatus` + `reviewedBy` 字段：

- **AI 审核通过**桶：`reviewStatus = 'approved' AND reviewedBy = 'ai'`
- **已人工核验**桶：`reviewStatus = 'approved' AND reviewedBy != 'ai'`（含 `reviewedBy IS NULL`，即从未走过审核流程的平台种子数据 —— 这些默认归入"已人工核验"，符合"历史审核记录存入审核通过页即可"的要求，无需数据回填）

"复审通过"和"驳回"不是新动作，直接复用现有的单条/批量审核决策接口：
- 复审通过 = `decision: 'approved'`。`decisionFields()` 已经无条件把 `reviewedBy` 覆盖成管理员用户名 —— 下次拉取列表时该项目自然从 AI 桶移入人工桶，无需额外状态流转。内容本身早已公开展示，此操作不改变可见性。
- 驳回 = `decision: 'rejected'`。`reviewStatus` 变为 `rejected`，公开查询（`restaurants.ts` 等处的 `reviewStatus === 'approved'` 过滤）立即将其排除 —— 这就是"隐藏并走审核失败逻辑"，与待审核 Tab 的驳回是同一套逻辑。

## 后端改动

`GET /admin/moderation` 新增可选查询参数 `reviewer=ai|human`，仅在 `status=approved` 时生效：

```ts
const reviewerSchema = z.enum(['ai', 'human']).optional();
```

对 `restaurants` / `menu_items` / `reviews` 三个查询各自追加过滤条件：

- `reviewer=ai` → `eq(reviewedBy, 'ai')`
- `reviewer=human` → `or(isNull(reviewedBy), ne(reviewedBy, 'ai'))`
- 不传 → 不追加过滤（保持现有行为，用于 pending/rejected Tab）

每个桶各自按 `LIST_LIMIT = 100` 截断（沿用现有实现方式），避免在服务端合并后再按 `reviewedBy` 裁剪导致某一桶因为另一桶占满配额而丢数据。

单条/批量审核决策接口（`POST /admin/moderation/review`、各 `POST .../review`）**不需要改动** —— "复审通过"和"驳回"直接调用它们，`decision: 'approved' | 'rejected'` 语义不变。

## 前端改动

### `AdminReview.tsx`

新增第二层 Tab，仅在 `status === 'approved'` 时显示在第一层 Tab 下方：

```ts
const REVIEWER_TABS: { value: 'ai' | 'human'; label: string }[] = [
  { value: 'ai', label: 'AI审核通过' },
  { value: 'human', label: '已人工核验' },
];
```

- 状态存在 URL query（`?status=approved&reviewer=ai`），默认 `ai`，模式与现有 `status` Tab 一致。
- 列表请求：`` `/admin/moderation?status=${status}${status === 'approved' ? `&reviewer=${reviewer}` : ''}` ``。
- 勾选框 + 批量操作栏：把现有 `status === 'pending'` 的显示条件扩展为 `status === 'pending' || (status === 'approved' && reviewer === 'ai')`，复用现成的 `selectedKeys` / `batchReview()` 机制。批量栏按钮文案在 AI 审核通过场景下显示"批量复审通过" / "批量驳回"（区别于待审核 Tab 的"批量通过" / "批量驳回"，措辞更贴合语义）。
- 单条操作按钮：现有逻辑在 `item.reviewStatus === 'approved'` 时隐藏"通过"按钮。AI审核通过子页签下改为始终展示该按钮并重新标注为"复审通过"（点击仍调用 `review(item, 'approved')`，逻辑不变）。已人工核验子页签维持现状 —— 仅展示"驳回"按钮，不提供批量操作。已驳回 Tab 不受影响。
- 切换任一层 Tab 时清空当前勾选（复用现有 `clearSelection()` 调用点）。

### `AdminReviewDetail.tsx`

同步小改动：当 `reviewStatus === 'approved' && reviewedBy === 'ai'` 时，展示"复审通过"按钮（而不是像现在这样因为已经 approved 而隐藏），保证从列表深链进入详情页时能做同样的操作。按钮点击逻辑不变，仍是 `review('approved')`。

## 测试

- 后端：扩展 `moderationBatch.test.ts`（或新建同类文件）覆盖 `reviewer` 参数 —— 只返回 `reviewedBy='ai'`、human 桶包含 `reviewedBy=null` 的种子数据、以及批量复审通过后重新查询会从 AI 桶消失并出现在人工桶。
- 前端：该页面目前没有既有测试套件；改动后通过本地 dev server 手动走查（造一条 AI 通过的数据 → 在 AI审核通过 子页签勾选复审通过/驳回 → 确认列表联动、公开侧可见性符合预期），不新增测试框架。

## 范围外

- 不改变终端用户可见性逻辑（AI 通过的内容本来就是即时公开的，本次不引入"AI 通过但待人工确认才公开"的中间态）。
- 不引入新的 `reviewStatus` 枚举值。
- 待审核 / 已驳回 两个顶层 Tab 的现有行为不变。
