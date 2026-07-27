import { eq } from 'drizzle-orm';
import type { AiVerdict, ReviewStatus } from '@sim-waimai/shared';
import { db } from '../db/client';
import { users } from '../db/schema';

export const BANNED_REJECT_REASON = '账号已被封禁，提交内容自动驳回';

export async function isUserBanned(userId: string): Promise<boolean> {
  const [row] = await db.select({ isBanned: users.isBanned }).from(users).where(eq(users.id, userId));
  return row?.isBanned ?? false;
}

interface InitialReviewFields {
  reviewStatus: ReviewStatus;
  rejectReason: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  aiVerdict: AiVerdict | null;
  aiReason: string | null;
  aiConfidence: number | null;
}

/**
 * 新建/编辑店铺、菜品、评价时落库的初始审核字段。
 * JWT 只验签不查库，封禁可能发生在用户当前会话期间，因此每次都要查一次库才能拿到最新封禁状态。
 * 被封禁用户直接落 rejected，跳过 AI/人工审核队列（调用方应据此跳过 queueReview）。
 */
export async function initialReviewFields(userId: string): Promise<InitialReviewFields> {
  if (await isUserBanned(userId)) {
    return {
      reviewStatus: 'rejected',
      rejectReason: BANNED_REJECT_REASON,
      reviewedAt: new Date(),
      reviewedBy: 'system',
      aiVerdict: null,
      aiReason: null,
      aiConfidence: null,
    };
  }
  return {
    reviewStatus: 'pending',
    rejectReason: null,
    reviewedAt: null,
    reviewedBy: null,
    aiVerdict: null,
    aiReason: null,
    aiConfidence: null,
  };
}
