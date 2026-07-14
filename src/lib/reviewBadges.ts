import type { AiVerdict, ReviewStatus } from '@sim-waimai/shared';

export const STATUS_BADGE: Record<ReviewStatus, { label: string; className: string }> = {
  pending: { label: '待审核', className: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10' },
  approved: { label: '已通过', className: 'text-green-600 bg-green-50 dark:bg-green-500/10' },
  rejected: { label: '已驳回', className: 'text-red-500 bg-red-50 dark:bg-red-500/10' },
};

export const AI_VERDICT_BADGE: Record<AiVerdict, { label: string; className: string }> = {
  approve: { label: 'AI建议：通过', className: 'text-green-600 bg-green-50 dark:bg-green-500/10' },
  reject: { label: 'AI建议：驳回', className: 'text-red-500 bg-red-50 dark:bg-red-500/10' },
  uncertain: { label: 'AI存疑，待人工判断', className: 'text-amber-600 bg-amber-50 dark:bg-amber-500/10' },
};
