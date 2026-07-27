import { and, count, eq, min } from 'drizzle-orm';
import { db } from '../db/client';
import { menuItems, moderationAlertState, restaurants, reviews } from '../db/schema';
import { env } from '../env';
import { sendMail } from './mailer';

/**
 * AI 审核积压检查：待人工处理 = review_status='pending'（从未处理过）
 * + review_status='approved' AND reviewed_by='ai'（AI 已通过、等待人工复审）。
 * 跨 restaurants/menu_items/reviews 三表求和；数量超阈值或最早一项等待超时即告警。
 */

const ALERT_ID = 'moderation_backlog';

interface Bucket {
  count: number;
  oldest: Date | null;
}

interface TableStats {
  label: string;
  pending: Bucket;
  aiApproved: Bucket;
}

async function restaurantStats(): Promise<TableStats> {
  const [pending] = await db
    .select({ c: count(), oldest: min(restaurants.createdAt) })
    .from(restaurants)
    .where(eq(restaurants.reviewStatus, 'pending'));
  const [aiApproved] = await db
    .select({ c: count(), oldest: min(restaurants.reviewedAt) })
    .from(restaurants)
    .where(and(eq(restaurants.reviewStatus, 'approved'), eq(restaurants.reviewedBy, 'ai')));
  return {
    label: '店铺',
    pending: { count: pending?.c ?? 0, oldest: pending?.oldest ?? null },
    aiApproved: { count: aiApproved?.c ?? 0, oldest: aiApproved?.oldest ?? null },
  };
}

async function menuItemStats(): Promise<TableStats> {
  // menu_items 没有 created_at 列，pending 桶只能计数、无法判断等待时长。
  const [pending] = await db.select({ c: count() }).from(menuItems).where(eq(menuItems.reviewStatus, 'pending'));
  const [aiApproved] = await db
    .select({ c: count(), oldest: min(menuItems.reviewedAt) })
    .from(menuItems)
    .where(and(eq(menuItems.reviewStatus, 'approved'), eq(menuItems.reviewedBy, 'ai')));
  return {
    label: '商品',
    pending: { count: pending?.c ?? 0, oldest: null },
    aiApproved: { count: aiApproved?.c ?? 0, oldest: aiApproved?.oldest ?? null },
  };
}

async function reviewStats(): Promise<TableStats> {
  const [pending] = await db
    .select({ c: count(), oldest: min(reviews.createdAt) })
    .from(reviews)
    .where(eq(reviews.reviewStatus, 'pending'));
  const [aiApproved] = await db
    .select({ c: count(), oldest: min(reviews.reviewedAt) })
    .from(reviews)
    .where(and(eq(reviews.reviewStatus, 'approved'), eq(reviews.reviewedBy, 'ai')));
  return {
    label: '评价',
    pending: { count: pending?.c ?? 0, oldest: pending?.oldest ?? null },
    aiApproved: { count: aiApproved?.c ?? 0, oldest: aiApproved?.oldest ?? null },
  };
}

function earliest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function renderEmailHtml(stats: TableStats[], totalCount: number, oldestWaitingSince: Date | null): string {
  const rows = stats
    .map(
      (s) =>
        `<tr><td>${s.label}</td><td>${s.pending.count}</td><td>${s.aiApproved.count}</td></tr>`,
    )
    .join('');
  const ageMinutes = oldestWaitingSince ? Math.floor((Date.now() - oldestWaitingSince.getTime()) / 60_000) : null;
  const link = env.APP_PUBLIC_URL ? `<p><a href="${env.APP_PUBLIC_URL}/admin/review">前往审核页处理 →</a></p>` : '';
  return `
    <h2>AI 审核页有 ${totalCount} 项待人工处理</h2>
    <table border="1" cellpadding="6" cellspacing="0">
      <tr><th>类型</th><th>待审核（pending）</th><th>AI 已通过待复审</th></tr>
      ${rows}
    </table>
    ${ageMinutes !== null ? `<p>最早一项已等待 ${ageMinutes} 分钟。</p>` : ''}
    ${link}
  `;
}

/**
 * 定时任务入口：查询积压、按冷却期决定是否发信、落库去重状态。
 * 是否真的发出邮件由 sendMail()（SMTP_HOST 未配置时 no-op）把关；这里只看有没有配收件人——
 * 这样单测可以在 SMTP_HOST 留空（测试环境强制清空）的情况下照常验证积压统计和去重逻辑。
 */
export async function checkModerationBacklog(): Promise<void> {
  if (!env.MODERATION_ALERT_EMAIL) return;

  const stats = await Promise.all([restaurantStats(), menuItemStats(), reviewStats()]);

  const totalCount = stats.reduce((sum, s) => sum + s.pending.count + s.aiApproved.count, 0);
  const oldestWaitingSince = stats.reduce<Date | null>(
    (oldest, s) => earliest(earliest(oldest, s.pending.oldest), s.aiApproved.oldest),
    null,
  );

  const ageMinutes = oldestWaitingSince ? (Date.now() - oldestWaitingSince.getTime()) / 60_000 : null;
  const isBreaching = totalCount > env.MODERATION_ALERT_COUNT_THRESHOLD || (ageMinutes !== null && ageMinutes > env.MODERATION_ALERT_AGE_MINUTES);

  const [previous] = await db.select().from(moderationAlertState).where(eq(moderationAlertState.id, ALERT_ID));
  const wasBreaching = previous?.isBreaching ?? false;
  const lastSentAt = previous?.lastSentAt ?? null;

  const cooldownElapsed = !lastSentAt || Date.now() - lastSentAt.getTime() >= env.MODERATION_ALERT_COOLDOWN_MINUTES * 60_000;
  const shouldSend = isBreaching && (!wasBreaching || cooldownElapsed);

  if (shouldSend) {
    const to = env.MODERATION_ALERT_EMAIL.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .join(',');
    await sendMail({
      to,
      subject: `【外卖模拟】AI 审核积压提醒（${totalCount} 项待处理）`,
      html: renderEmailHtml(stats, totalCount, oldestWaitingSince),
    });
  }

  await db
    .insert(moderationAlertState)
    .values({ id: ALERT_ID, isBreaching, lastSentAt: shouldSend ? new Date() : lastSentAt, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: moderationAlertState.id,
      set: { isBreaching, lastSentAt: shouldSend ? new Date() : lastSentAt, updatedAt: new Date() },
    });
}
