# 审批列表批量审批 设计文档

日期：2026-07-17
状态：已确认

## 背景与目标

审核管理页（`src/pages/AdminReview.tsx`）目前只支持逐条通过/驳回。列表混合三种审核对象（店铺 / 菜品 / 用户评价），分别调用 `server/src/routes/admin.ts` 中三个单条审批接口。目标：在「待审核」Tab 下支持勾选多条后批量通过或批量驳回。

## 需求决策（已与用户确认）

- 批量操作支持 **通过 + 驳回**；批量驳回填写一条统一的驳回原因，应用到所有勾选项。
- 勾选与批量操作 **仅在「待审核」Tab** 启用；已通过/已驳回 Tab 保持现有单条改判。
- 后端 **新增批量接口**，不采用前端循环调用单条接口。

## 后端设计

### 新接口

`POST /admin/moderation/review`，`requireAdmin`。

请求体（zod 校验）：

```ts
{
  targets: Array<
    | { targetType: 'restaurant'; restaurantId: string }
    | { targetType: 'menuItem'; restaurantId: string; itemId: string }
    | { targetType: 'review'; reviewId: string }
  >;                              // 1 ~ 50 条；reviewId 校验 UUID 格式
  decision: 'approved' | 'rejected';
  reason?: string;                // 最长 200；decision 为 rejected 时必填（trim 后非空）
}
```

校验失败（targets 为空/超限、rejected 缺 reason 等）返回 400。

### 处理语义

- **逐条独立处理，非整体原子**：一条失败（如目标已被删除）不回滚其他条，符合审核队列清空场景。
- 每条的更新逻辑与现有单条接口完全一致：
  - 店铺 / 菜品：直接 update（`reviewStatus`、`rejectReason`、`reviewedAt`、`reviewedBy=admin.username`），不加 WHERE pending，管理员可覆盖任何状态。
  - 用户评价：**必须保留现有事务 + `FOR UPDATE` 行锁 + 按旧→新状态转移调用 `applyRatingDelta` 的聚合逻辑**，含「被商家隐藏（hiddenAt 非空）的评价不计入聚合」规则。
- 实现方式：把 admin.ts 现有三个单条 handler 的核心更新逻辑分别抽成函数（如 `reviewRestaurant` / `reviewMenuItem` / `reviewUserReview`），单条接口与批量接口共同调用，不复制代码。

### 响应

```ts
{
  succeeded: number;
  failed: Array<{ target: ModerationTargetDto; error: string }>;
}
```

目标不存在时该条记入 failed（error 如「店铺不存在」），其余照常处理。

## shared 类型

`shared/src/api.ts` 新增：

- `ModerationTargetDto`：上述 targets 元素的联合类型。
- `BatchReviewRequestDto`：请求体类型。
- `BatchReviewResultDto`：响应类型。

## 前端设计（AdminReview.tsx）

- 仅 `status === 'pending'` 时：
  - 每张卡片左侧渲染 checkbox（以现有 `itemKey(item)` 作为选中集合的 key，`Set<string>` 存储）。
  - 列表顶部一行「全选」checkbox + 「已选 N 条」文案。
- 选中数 > 0 时，页面底部出现固定操作栏：「批量驳回」（红边描边按钮）+「批量通过」（绿色实心按钮），样式与现有单条按钮一致。
- 批量驳回：点击后在操作栏内展开统一驳回原因输入框（复用现有单条驳回的输入样式与「取消/确认驳回」交互），原因 trim 后非空才可提交。
- 提交：将选中项映射为 `ModerationTargetDto[]` 调用批量接口；期间按钮禁用并显示「提交中…」。
- 完成后 flash 汇总：全部成功显示「已通过 N 条 ✓」/「已驳回 N 条 ✓」；有失败显示「成功 X 条，失败 Y 条」。随后清空勾选并 `reload()`。
- 切换 Tab 时清空勾选状态与展开的驳回输入。单条操作按钮及其交互保持不变。

## 错误处理

- 整个请求失败（网络/401 等）：沿用现有 `flash(err.message)` 提示，不清空勾选，便于重试。
- 部分失败：flash 汇总后仍 `reload()`（失败条目通常是已被他人处理/删除，刷新即消失或更新状态）。

## 测试

- **server**（vitest，仿照 `server/src/test/moderation.test.ts`）：
  1. 混合三种类型批量通过，全部生效，`succeeded` 正确。
  2. 批量驳回写入统一 reason，各目标 `rejectReason` 一致。
  3. `decision: 'rejected'` 缺 reason 返回 400。
  4. targets 为空或超过 50 条返回 400。
  5. 部分目标不存在：返回 failed 明细，其余成功。
  6. 批量通过含用户评价时，店铺评分聚合正确增加（含 hiddenAt 评价不计入）。
  7. 非管理员调用返回 403。
- **web**：项目无页面组件测试先例，前端以 `tsc` 类型检查、构建通过及实际操作验证为准。

## 不做的事（YAGNI）

- 不做已通过/已驳回 Tab 的批量改判。
- 不做逐条独立驳回原因的批量驳回。
- 不做后端整体事务原子性（全成全败）。
- 不做列表分页/游标（维持现状）。
