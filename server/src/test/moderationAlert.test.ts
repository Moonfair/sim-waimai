import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, count, eq, like, or } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { menuItems, moderationAlertState, restaurants, reviews } from '../db/schema';
import { env } from '../env';

vi.mock('../lib/mailer', () => ({ sendMail: vi.fn() }));

import { sendMail } from '../lib/mailer';
import { checkModerationBacklog } from '../lib/moderationAlert';

const stamp = Date.now().toString(36);
const idPrefix = `t-alert-${stamp}-`;
let seq = 0;

const BASE_SHOP = {
  name: '积压测试店',
  category: '测试',
  deliveryFeeFen: 300,
  minOrderFen: 1500,
  deliveryTime: 30,
  emoji: '🍜',
  bgColor: '#336699',
};

function backlogCondition(statusCol: AnyColumn, reviewedByCol: AnyColumn) {
  return or(eq(statusCol, 'pending'), and(eq(statusCol, 'approved'), eq(reviewedByCol, 'ai')));
}

/** 生产逻辑统计的是全表积压，本机 dev DB 里可能已经有历史遗留的 pending/AI 已通过数据；
 *  测试不假设 DB 是干净的，改为读出当前真实基线，阈值相对基线设置。 */
async function currentBacklogCount(): Promise<number> {
  const [[r], [m], [v]] = await Promise.all([
    db.select({ c: count() }).from(restaurants).where(backlogCondition(restaurants.reviewStatus, restaurants.reviewedBy)),
    db.select({ c: count() }).from(menuItems).where(backlogCondition(menuItems.reviewStatus, menuItems.reviewedBy)),
    db.select({ c: count() }).from(reviews).where(backlogCondition(reviews.reviewStatus, reviews.reviewedBy)),
  ]);
  return (r?.c ?? 0) + (m?.c ?? 0) + (v?.c ?? 0);
}

async function insertRestaurant(overrides: Partial<typeof restaurants.$inferInsert> = {}): Promise<string> {
  const id = `${idPrefix}${seq++}`;
  await db.insert(restaurants).values({ id, ...BASE_SHOP, ...overrides });
  return id;
}

async function cleanupOwnRows() {
  await db.delete(restaurants).where(like(restaurants.id, `${idPrefix}%`));
}

async function resetAlertState() {
  await db.delete(moderationAlertState);
}

let saved: {
  email?: string;
  countThreshold: number;
  ageMinutes: number;
  cooldownMinutes: number;
};

beforeAll(() => {
  saved = {
    email: env.MODERATION_ALERT_EMAIL,
    countThreshold: env.MODERATION_ALERT_COUNT_THRESHOLD,
    ageMinutes: env.MODERATION_ALERT_AGE_MINUTES,
    cooldownMinutes: env.MODERATION_ALERT_COOLDOWN_MINUTES,
  };
  env.MODERATION_ALERT_EMAIL = 'admin@test.com';
  env.MODERATION_ALERT_COOLDOWN_MINUTES = 120;
});

afterAll(async () => {
  env.MODERATION_ALERT_EMAIL = saved.email;
  env.MODERATION_ALERT_COUNT_THRESHOLD = saved.countThreshold;
  env.MODERATION_ALERT_AGE_MINUTES = saved.ageMinutes;
  env.MODERATION_ALERT_COOLDOWN_MINUTES = saved.cooldownMinutes;
  await cleanupOwnRows();
  await resetAlertState();
  await pool.end();
});

afterEach(async () => {
  vi.clearAllMocks();
  await cleanupOwnRows();
  await resetAlertState();
});

describe('checkModerationBacklog', () => {
  it('数量、等待时长都没超阈值时不发送', async () => {
    const baseline = await currentBacklogCount();
    env.MODERATION_ALERT_COUNT_THRESHOLD = baseline + 100;
    env.MODERATION_ALERT_AGE_MINUTES = 10_000_000; // 屏蔽 dev DB 里可能存在的历史遗留数据触发时长条件
    for (let i = 0; i < 3; i++) await insertRestaurant({ reviewStatus: 'pending' });

    await checkModerationBacklog();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('待处理总数（跨三张表）超过阈值时发送告警', async () => {
    const baseline = await currentBacklogCount();
    env.MODERATION_ALERT_COUNT_THRESHOLD = baseline; // 再加 1 条就严格大于基线
    env.MODERATION_ALERT_AGE_MINUTES = 10_000_000;
    await insertRestaurant({ reviewStatus: 'pending' });

    await checkModerationBacklog();
    expect(sendMail).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(sendMail).mock.calls[0]![0];
    expect(arg.to).toBe('admin@test.com');
    expect(arg.subject).toContain(String(baseline + 1));
  });

  it('AI 已通过、等待人工复审的条目也计入积压总数', async () => {
    const baseline = await currentBacklogCount();
    env.MODERATION_ALERT_COUNT_THRESHOLD = baseline;
    env.MODERATION_ALERT_AGE_MINUTES = 10_000_000;
    await insertRestaurant({ reviewStatus: 'approved', reviewedBy: 'ai', reviewedAt: new Date() });

    await checkModerationBacklog();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('最早一项等待时长超过阈值时发送告警，即使总数没超', async () => {
    env.MODERATION_ALERT_COUNT_THRESHOLD = 1_000_000; // 屏蔽数量条件
    env.MODERATION_ALERT_AGE_MINUTES = 100;
    const overOneHundredMinutesAgo = new Date(Date.now() - 3 * 60 * 60_000);
    await insertRestaurant({ reviewStatus: 'pending', createdAt: overOneHundredMinutesAgo });

    await checkModerationBacklog();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('冷却期内持续超阈值不重复发送', async () => {
    const baseline = await currentBacklogCount();
    env.MODERATION_ALERT_COUNT_THRESHOLD = baseline;
    env.MODERATION_ALERT_AGE_MINUTES = 10_000_000;
    await insertRestaurant({ reviewStatus: 'pending' });

    await checkModerationBacklog();
    expect(sendMail).toHaveBeenCalledTimes(1);

    await insertRestaurant({ reviewStatus: 'pending' }); // 仍然超阈值
    await checkModerationBacklog();
    expect(sendMail).toHaveBeenCalledTimes(1); // 冷却期内不重复
  });

  it('条件恢复正常后再次触发会立即再发，不等冷却期', async () => {
    const baseline = await currentBacklogCount();
    env.MODERATION_ALERT_COUNT_THRESHOLD = baseline;
    env.MODERATION_ALERT_AGE_MINUTES = 10_000_000;
    const id = await insertRestaurant({ reviewStatus: 'pending' });

    await checkModerationBacklog();
    expect(sendMail).toHaveBeenCalledTimes(1);

    await db.delete(restaurants).where(eq(restaurants.id, id)); // 回落到基线，恢复正常
    await checkModerationBacklog();
    expect(sendMail).toHaveBeenCalledTimes(1); // 恢复正常这一次不发信

    await insertRestaurant({ reviewStatus: 'pending' }); // 再次触发
    await checkModerationBacklog();
    expect(sendMail).toHaveBeenCalledTimes(2); // 立即再发，不受冷却期限制
  });
});
