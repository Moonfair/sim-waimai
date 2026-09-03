import { desc, isNotNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AdminRoleListDto, AdminRoleUserDto } from '@sim-waimai/shared';
import { db } from '../db/client';
import { users } from '../db/schema';
import { logAdminAction } from '../lib/auditLog';
import { validateJson } from '../lib/validate';
import { requireSuperAdmin } from '../middleware/auth';

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

const grantRoleSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名'),
  role: z.enum(['admin', 'superadmin']),
});

function toAdminRoleUserDto(row: typeof users.$inferSelect): AdminRoleUserDto {
  return {
    id: row.id,
    username: row.username,
    role: row.role!,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Mounted at /admin: managing who else has the admin/superadmin role — reserved for
 *  superadmins (day-to-day operations don't need it; see requireAdmin-gated routes elsewhere). */
export const adminRolesRoutes = new Hono()
  .get('/admins', requireSuperAdmin, async (c) => {
    const page = parsePage(c.req.query('page'));
    const pageSize = parsePageSize(c.req.query('pageSize'));

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(isNotNull(users.role));
    const rows = await db
      .select()
      .from(users)
      .where(isNotNull(users.role))
      .orderBy(desc(users.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const result: AdminRoleListDto = { items: rows.map(toAdminRoleUserDto), total, page, pageSize };
    return c.json(result);
  })
  .post('/admins', requireSuperAdmin, validateJson(grantRoleSchema), async (c) => {
    const actor = c.get('user');
    const { username, role } = c.req.valid('json');
    if (username.toLowerCase() === actor.username.toLowerCase()) {
      return c.json({ error: '不能修改自己的角色' }, 400);
    }

    const [row] = await db
      .update(users)
      .set({ role })
      .where(sql`lower(${users.username}) = lower(${username})`)
      .returning();
    if (!row) return c.json({ error: '用户不存在' }, 404);

    await logAdminAction({
      actorUsername: actor.username,
      action: 'admin_role.grant',
      targetType: 'user',
      targetId: row.id,
      targetLabel: row.username,
      detail: { role },
    });
    return c.json(toAdminRoleUserDto(row));
  })
  .delete('/admins/:username', requireSuperAdmin, async (c) => {
    const actor = c.get('user');
    const username = c.req.param('username');
    if (username.toLowerCase() === actor.username.toLowerCase()) {
      return c.json({ error: '不能修改自己的角色' }, 400);
    }

    const [row] = await db
      .update(users)
      .set({ role: null })
      .where(sql`lower(${users.username}) = lower(${username}) AND ${users.role} IS NOT NULL`)
      .returning();
    if (!row) return c.json({ error: '该用户当前没有管理员角色' }, 404);

    await logAdminAction({
      actorUsername: actor.username,
      action: 'admin_role.revoke',
      targetType: 'user',
      targetId: row.id,
      targetLabel: row.username,
    });
    return c.json({ ok: true });
  });
