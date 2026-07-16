import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { menuItems, restaurants } from '../db/schema';
import { getReviewer, type ModerationInput } from './moderationProvider';

/**
 * AI 内容审核落库层：路由把新建/修改的内容先落库为 pending 并立即响应，
 * 再通过 queueReview() 在后台调用天御审核（见 moderationProvider.ts）。
 * AI 明确通过/驳回则落库；uncertain、未配置凭证或调用失败时保持 pending，等待人工审核。
 */

export type ModerationTarget =
  | { table: 'restaurants'; restaurantId: string }
  | { table: 'menuItems'; restaurantId: string; itemId: string };

const inflight = new Set<Promise<void>>();

/** 测试钩子：等待所有在途审核落库完成。 */
export function __awaitReviews(): Promise<void> {
  return Promise.allSettled([...inflight]).then(() => {});
}

/** fire-and-forget：路由响应后调用，不阻塞请求。 */
export function queueReview(target: ModerationTarget, input: ModerationInput): void {
  const p = runReview(target, input).catch((err) => {
    console.error('[moderation] review failed, item stays pending:', err);
  });
  inflight.add(p);
  void p.finally(() => inflight.delete(p));
}

async function runReview(target: ModerationTarget, input: ModerationInput): Promise<void> {
  const reviewer = getReviewer();
  if (!reviewer) return; // 未配置凭证：保持 pending 走人工队列
  const result = await reviewer(input);

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
