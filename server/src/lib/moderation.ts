import Anthropic from '@anthropic-ai/sdk';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { menuItems, restaurants } from '../db/schema';
import { env } from '../env';

/**
 * AI 内容审核：商家路由把新建/修改的店铺、商品先落库为 pending 并立即响应，
 * 再通过 queueReview() 在后台调用 Anthropic API 审核。AI 明确通过/驳回则落库；
 * uncertain、未配置 ANTHROPIC_API_KEY 或调用失败时保持 pending，等待人工审核。
 */

/** 送审的文字内容（AI 无法查看图片，图片变更只作为信号传入）。 */
export interface ModerationContent {
  targetType: 'restaurant' | 'menuItem';
  name: string;
  /** 餐厅品类或商品的菜单分类。 */
  category: string;
  description?: string;
  tags?: string[];
  /** 商品规格组/选项名称（用户自填文本）。 */
  optionText?: string[];
  emoji: string;
  /** 本次提交是否包含新图片：是则提示模型倾向 uncertain 走人工。 */
  imageChanged?: boolean;
}

export type ModerationTarget =
  | { table: 'restaurants'; restaurantId: string }
  | { table: 'menuItems'; restaurantId: string; itemId: string };

const verdictSchema = z.object({
  verdict: z.enum(['approve', 'reject', 'uncertain']),
  reason: z.string(),
  confidence: z.number(),
});

export type AiReviewResult = z.infer<typeof verdictSchema>;
type AiReviewer = (content: ModerationContent) => Promise<AiReviewResult>;

const SYSTEM_PROMPT = `你是一个外卖平台的内容审核员，负责审核用户自助发布的店铺和菜品信息。

规则：
- 正常的餐饮内容（店名、菜名、口味描述、常见营销用语等）一律通过（approve）。
- 明显违规内容驳回（reject）：违禁品/毒品、色情低俗、暴力血腥、赌博诈骗、辱骂歧视、政治敏感、明显与餐饮无关的违法内容、恶意乱码或刷屏文本。
- 无法判断时返回 uncertain，交由人工复审。
- 如果提交说明包含新图片：你无法查看图片内容，除非文字本身已可判定违规（reject），否则返回 uncertain。
- reason 用一句简短中文说明理由，驳回理由会展示给商家。confidence 为 0~1 的判断置信度。`;

const outputSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'reject', 'uncertain'] },
    reason: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['verdict', 'reason', 'confidence'],
  additionalProperties: false,
} as const;

function renderContent(content: ModerationContent): string {
  const lines = [
    `内容类型：${content.targetType === 'restaurant' ? '店铺' : '菜品'}`,
    `名称：${content.name}`,
    `分类：${content.category}`,
    `emoji：${content.emoji}`,
  ];
  if (content.description) lines.push(`描述：${content.description}`);
  if (content.tags?.length) lines.push(`标签：${content.tags.join('、')}`);
  if (content.optionText?.length) lines.push(`规格选项：${content.optionText.join('、')}`);
  lines.push(`本次提交包含新图片：${content.imageChanged ? '是' : '否'}`);
  return lines.join('\n');
}

/** 每次调用时读 process.env（而非 env.ts 的冻结快照），测试可在运行期开关。 */
function apiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || undefined;
}

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  // 10s 超时 + 1 次重试，让后台审核任务有界；失败即保持 pending 走人工。
  anthropicClient ??= new Anthropic({
    apiKey: apiKey(),
    timeout: 10_000,
    maxRetries: 1,
  });
  return anthropicClient;
}

const anthropicReviewer: AiReviewer = async (content) => {
  const response = await getClient().messages.create({
    model: env.MODERATION_MODEL,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: outputSchema } },
    messages: [{ role: 'user', content: renderContent(content) }],
  });
  const text = response.content.find((b) => b.type === 'text')?.text ?? '';
  return verdictSchema.parse(JSON.parse(text));
};

/** 测试钩子：注入假 reviewer（非 null 时绕过 API key 检查）。 */
let injectedReviewer: AiReviewer | null = null;

export function __setAiReviewer(fn: AiReviewer | null): void {
  injectedReviewer = fn;
}

const inflight = new Set<Promise<void>>();

/** 测试钩子：等待所有在途审核落库完成。 */
export function __awaitReviews(): Promise<void> {
  return Promise.allSettled([...inflight]).then(() => {});
}

/** fire-and-forget：路由响应后调用，不阻塞请求。 */
export function queueReview(target: ModerationTarget, content: ModerationContent): void {
  const p = runReview(target, content).catch((err) => {
    console.error('[moderation] review failed, item stays pending:', err);
  });
  inflight.add(p);
  void p.finally(() => inflight.delete(p));
}

async function runReview(target: ModerationTarget, content: ModerationContent): Promise<void> {
  if (!injectedReviewer && !apiKey()) return; // 无 key：保持 pending 走人工队列
  const result = await (injectedReviewer ?? anthropicReviewer)(content);

  // AI 的判断始终落库（供审核页展示"AI 建议"），uncertain 时额外保持 pending 走人工队列。
  const patch: Partial<typeof restaurants.$inferInsert> = {
    aiVerdict: result.verdict,
    aiReason: result.reason,
    aiConfidence: result.confidence,
  };
  if (result.verdict !== 'uncertain') {
    patch.reviewStatus = result.verdict === 'approve' ? 'approved' : 'rejected';
    patch.rejectReason = result.verdict === 'reject' ? result.reason : null;
    patch.reviewedAt = new Date();
    patch.reviewedBy = 'ai';
  }
  // WHERE review_status='pending'：AI 慢返回时不覆盖管理员已作出的决定（uncertain 分支同样受益）。
  // 注意：同一目标被再次编辑会重新置 pending 并重新入队，旧的在途结果理论上可能
  // 落在新内容上——演示场景可接受。
  if (target.table === 'restaurants') {
    await db
      .update(restaurants)
      .set(patch)
      .where(and(eq(restaurants.id, target.restaurantId), eq(restaurants.reviewStatus, 'pending')));
  } else {
    await db
      .update(menuItems)
      .set(patch)
      .where(
        and(
          eq(menuItems.restaurantId, target.restaurantId),
          eq(menuItems.id, target.itemId),
          eq(menuItems.reviewStatus, 'pending'),
        ),
      );
  }
}
