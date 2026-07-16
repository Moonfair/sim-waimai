# AI 审核机制重构设计：腾讯云内容安全（天御）+ 全量图文覆盖 + 人工兜底

日期：2026-07-16

## 背景与目标

现有 AI 审核（`server/src/lib/moderation.ts`）用 Anthropic Claude 只审**文本**，图片一律转人工；且只覆盖商家侧店铺/菜品，**用户评价（文本+最多9图）完全无审核**，用户名只有格式正则。本次重构：

1. AI 能力换成**腾讯云内容安全（天御）**：TMS 文本审核 + IMS 图片审核。专为中文粗俗/色情/涉政场景设计，与 COS 同厂商，凭证体系一致。
2. 审核范围扩大到**用户提交的所有图片和文本**：
   - 店铺/菜品：文本 + banner/菜品图；
   - 用户评价：content + photos，**先审后发**（提交后 pending 仅本人可见，AI 通过才公开）；
   - 注册用户名：同步文本审核，违规拒绝注册，AI 不可用时 fail-open。
3. **AI 失败回退人工**：调用报错/超时/未配置凭证/Suggestion=Review → 保持 pending 进 admin 人工队列（沿用现有队列，扩展"评价"类型）。

保留现有防护：`WHERE reviewStatus='pending'` 防 AI 慢返回覆盖管理员决定、管理员可推翻 AI。

## 关键设计决策

| 决策 | 结论 |
|---|---|
| Anthropic 实现 | 删除（含 `@anthropic-ai/sdk` 依赖、`ANTHROPIC_API_KEY`/`MODERATION_MODEL` 环境变量），天御为唯一 provider |
| SDK | `tencentcloud-sdk-nodejs-tms` + `tencentcloud-sdk-nodejs-ims`（按产品拆分的官方包） |
| 凭证 | 独立 `TENCENT_MODERATION_SECRET_ID/KEY`，不静默回落 COS 凭证（避免带真实 .env 的机器跑测试触网计费）。provider 内运行期读 process.env |
| 图片送审 | 混合：COS 公网 URL → `FileUrl`；`/api/uploads/local/` → 读本地盘转 base64 `FileContent` |
| Suggestion 映射 | 任一 `Block`→reject；否则任一 `Review`→uncertain（转人工）；全 `Pass`→approve；confidence=决定性那条 Score/100 |
| 用户名 Review 档 | 放行（仅 Block 拒绝）——用户名无 pending/人工队列挂靠点 |
| 评价驳回展示 | 本人可见 + rejectReason；orderId unique 保留，不允许重评 |
| 评分聚合 | 只算 approved：聚合累加从"插入时"移到"审核通过时"；admin 推翻按旧→新状态转移加减 |

## Provider 接口（新文件 `server/src/lib/moderationProvider.ts`）

```ts
export interface ModerationInput { texts: string[]; images: string[] }
export interface ModerationResult {   // 与现有 verdictSchema 同形，DB 字段不变
  verdict: 'approve' | 'reject' | 'uncertain';
  reason: string;
  confidence: number;
}
export type Reviewer = (input: ModerationInput) => Promise<ModerationResult>;
export function getReviewer(): Reviewer | null;           // 未配置凭证 → null（保持 pending 走人工）
export function __setReviewer(fn: Reviewer | null): void; // 测试钩子
export function mergeVerdicts(parts: PartVerdict[]): ModerationResult; // 纯函数
export function moderateTextSync(text: string, timeoutMs?: number): Promise<ModerationResult | null>;
```

`moderation.ts` 保留瘦身：`ModerationTarget` 加 `{ table: 'reviews'; reviewId: string }`；`queueReview(target, input)`、`inflight`/`__awaitReviews()`、WHERE pending 防覆盖全部保留。

## 天御 API 要点

- **TMS**：endpoint `tms.tencentcloudapi.com`，Action `TextModeration`，Version `2020-12-29`；入参 `Content`=base64(文本)（多条 texts 用 `\n` 拼接一次送审）、可选 `BizType`；出参 `Suggestion(Pass|Review|Block)/Label/Keywords/Score(0-100)`。
- **IMS**：endpoint `ims.tencentcloudapi.com`，Action `ImageModeration`，Version `2020-12-29`；入参 `FileUrl` 或 `FileContent`（二选一）、可选 `BizType`；每次只审 1 张，多图 `Promise.all`；出参 `Suggestion/Label/SubLabel/Score/LabelResults`。
- client 惰性单例，reqTimeout 10s；Region 默认 `ap-guangzhou`。

## Schema 变更

reviews 表加与 restaurants 相同的 7 个审核字段：`review_status text DEFAULT 'approved' NOT NULL`（存量评价直接通过，聚合无需回填；新插入显式写 `'pending'`）、`reject_reason`、`reviewed_at`、`reviewed_by`、`ai_verdict`、`ai_reason`、`ai_confidence` + CHECK 约束 + `reviews_review_status_idx` 索引。

## 数据流

1. **商家提交店铺/菜品** → 落库 pending → `queueReview`（texts=名称/分类/描述/标签/规格选项/emoji，images=banner/菜品图）→ 天御 TMS+IMS → approve/reject 落库，uncertain/失败保持 pending 进 admin 队列。
2. **用户提交评价** → 落库 pending（不动评分聚合）→ `queueReview`（texts=[content]，images=photos）→ approve 时事务内更新状态并累加聚合；reject 仅更新状态；本人始终可见自己的评价及状态。
3. **用户注册** → `moderateTextSync(username, 3s)` → Block 拒绝注册；其余（含超时/未配置）放行。
4. **admin 人工队列** → 店铺/菜品/评价三类 pending 项，通过/驳回可推翻 AI；评价裁决用 FOR UPDATE 取旧状态做聚合转移。

## 错误处理

- 天御调用报错/超时：`runReview` 抛错被 catch，内容保持 pending → 人工队列。
- 凭证未配置：`getReviewer()` 返回 null，直接保持 pending → 人工队列。
- FileUrl 拉取失败（桶不可公开读）：IMS 报错 → 同上转人工；`.env.example` 注明审核依赖图片公网可达。
- 注册链路 fail-open：任何审核异常都不阻塞注册。

## 测试策略

沿用 vitest + app.request 跑 dev Postgres；`__setReviewer` 注入假 reviewer；测试 beforeAll 删除 `process.env.TENCENT_MODERATION_SECRET_ID/KEY` 防触网计费；`mergeVerdicts` 纯函数单测覆盖 Block/Review/Pass 组合及 TMS/IMS 返回结构差异。
