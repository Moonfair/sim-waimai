import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AdminAuditAction, AdminAuditLogEntryDto, AdminAuditLogListDto, AdminAuditTargetType } from '@sim-waimai/shared';
import { db } from '../db/client';
import { adminAuditLog } from '../db/schema';
import { requireAdmin } from '../middleware/auth';

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 50;

function parsePage(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function parsePageSize(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  const v = Number.isFinite(n) ? n : PAGE_SIZE_DEFAULT;
  return Math.min(Math.max(v, 1), PAGE_SIZE_MAX);
}

const actionSchema = z
  .custom<AdminAuditAction>((v) => typeof v === 'string')
  .optional();
const targetTypeSchema = z
  .custom<AdminAuditTargetType>((v) => typeof v === 'string')
  .optional();

function toEntryDto(row: typeof adminAuditLog.$inferSelect): AdminAuditLogEntryDto {
  return {
    id: row.id,
    actorUsername: row.actorUsername,
    action: row.action as AdminAuditAction,
    targetType: row.targetType as AdminAuditTargetType | null,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    detail: row.detail,
    batchId: row.batchId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Mounted at /admin: read-only operation history, visible to both admin and superadmin —
 *  a small collaborating team all get to see who did what, not just superadmins. */
export const adminAuditRoutes = new Hono().get('/audit-log', requireAdmin, async (c) => {
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const actor = c.req.query('actor')?.trim() || undefined;
  const actionParsed = actionSchema.safeParse(c.req.query('action'));
  const targetTypeParsed = targetTypeSchema.safeParse(c.req.query('targetType'));
  if (!actionParsed.success || !targetTypeParsed.success) return c.json({ error: '无效的筛选参数' }, 400);
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  if ((dateFrom && Number.isNaN(Date.parse(dateFrom))) || (dateTo && Number.isNaN(Date.parse(dateTo)))) {
    return c.json({ error: '无效的日期范围' }, 400);
  }

  const where = and(
    actor ? sql`lower(${adminAuditLog.actorUsername}) = lower(${actor})` : undefined,
    actionParsed.data ? eq(adminAuditLog.action, actionParsed.data) : undefined,
    targetTypeParsed.data ? eq(adminAuditLog.targetType, targetTypeParsed.data) : undefined,
    dateFrom ? gte(adminAuditLog.createdAt, new Date(dateFrom)) : undefined,
    dateTo ? lte(adminAuditLog.createdAt, new Date(dateTo)) : undefined,
  );

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(adminAuditLog).where(where);
  const rows = await db
    .select()
    .from(adminAuditLog)
    .where(where)
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const result: AdminAuditLogListDto = { items: rows.map(toEntryDto), total, page, pageSize };
  return c.json(result);
});
