import { desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type {
  ChangelogEditorDto,
  ChangelogEditorListDto,
  ChangelogEntryDto,
  ChangelogListDto,
} from '@sim-waimai/shared';
import { db } from '../db/client';
import { changelogEditors, changelogEntries, users } from '../db/schema';
import { validateJson } from '../lib/validate';
import { requireAdmin, requireChangelogEditor } from '../middleware/auth';

/** Plenty for a changelog's lifetime; the client pages through this fetched batch client-side. */
const LIST_LIMIT = 200;
const MAX_INSERT_ATTEMPTS = 3;

const contentSchema = z.object({
  content: z.string().trim().min(1, '内容不能为空').max(4000, '内容太长啦，最多4000字'),
});

const editorUsernameSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名'),
});

type EntryRow = typeof changelogEntries.$inferSelect;

function toEntryDto(row: EntryRow): ChangelogEntryDto {
  return {
    id: row.id,
    version: row.version,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    updatedBy: row.updatedBy,
  };
}

function toEditorDto(row: typeof changelogEditors.$inferSelect): ChangelogEditorDto {
  return { username: row.username, addedBy: row.addedBy, addedAt: row.addedAt.toISOString() };
}

/** version = max(version)+1; retries on a rare concurrent-insert race (unique_violation). */
async function insertEntry(content: string, createdBy: string): Promise<EntryRow> {
  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
    const [{ nextVersion }] = await db
      .select({ nextVersion: sql<number>`coalesce(max(${changelogEntries.version}), 0)::int + 1` })
      .from(changelogEntries);
    try {
      const [row] = await db
        .insert(changelogEntries)
        .values({ version: nextVersion, content, createdBy })
        .returning();
      return row!;
    } catch (err) {
      const isLastAttempt = attempt === MAX_INSERT_ATTEMPTS - 1;
      if ((err as { code?: string }).code === '23505' && !isLastAttempt) continue;
      throw err;
    }
  }
  throw new Error('unreachable');
}

/** GET /changelog — public list, newest version first. */
export const changelogRoutes = new Hono().get('/', async (c) => {
  const rows = await db
    .select()
    .from(changelogEntries)
    .orderBy(desc(changelogEntries.version))
    .limit(LIST_LIMIT);
  const result: ChangelogListDto = { items: rows.map(toEntryDto) };
  return c.json(result);
});

/** Mounted at /admin: entry CRUD open to admins + designated editors, editor roster admin-only. */
export const adminChangelogRoutes = new Hono()
  .post('/changelog', requireChangelogEditor, validateJson(contentSchema), async (c) => {
    const { content } = c.req.valid('json');
    const row = await insertEntry(content, c.get('user').username);
    return c.json(toEntryDto(row));
  })
  .patch('/changelog/:id', requireChangelogEditor, validateJson(contentSchema), async (c) => {
    const { content } = c.req.valid('json');
    const [row] = await db
      .update(changelogEntries)
      .set({ content, updatedAt: new Date(), updatedBy: c.get('user').username })
      .where(eq(changelogEntries.id, c.req.param('id')))
      .returning();
    if (!row) return c.json({ error: '公告不存在' }, 404);
    return c.json(toEntryDto(row));
  })
  .delete('/changelog/:id', requireChangelogEditor, async (c) => {
    const [row] = await db
      .delete(changelogEntries)
      .where(eq(changelogEntries.id, c.req.param('id')))
      .returning({ id: changelogEntries.id });
    if (!row) return c.json({ error: '公告不存在' }, 404);
    return c.json({ ok: true });
  })
  .get('/changelog-editors', requireAdmin, async (c) => {
    const rows = await db.select().from(changelogEditors).orderBy(desc(changelogEditors.addedAt));
    const result: ChangelogEditorListDto = { items: rows.map(toEditorDto) };
    return c.json(result);
  })
  .post('/changelog-editors', requireAdmin, validateJson(editorUsernameSchema), async (c) => {
    const { username } = c.req.valid('json');
    const [target] = await db
      .select({ username: users.username })
      .from(users)
      .where(sql`lower(${users.username}) = lower(${username})`);
    if (!target) return c.json({ error: '用户不存在' }, 404);

    const lower = target.username.toLowerCase();
    const [existing] = await db.select().from(changelogEditors).where(eq(changelogEditors.username, lower));
    if (existing) return c.json({ error: '该用户已经是更新日志编辑者' }, 409);

    const [row] = await db
      .insert(changelogEditors)
      .values({ username: lower, addedBy: c.get('user').username })
      .returning();
    return c.json(toEditorDto(row!));
  })
  .delete('/changelog-editors/:username', requireAdmin, async (c) => {
    const [row] = await db
      .delete(changelogEditors)
      .where(eq(changelogEditors.username, c.req.param('username').toLowerCase()))
      .returning({ username: changelogEditors.username });
    if (!row) return c.json({ error: '该用户不是更新日志编辑者' }, 404);
    return c.json({ ok: true });
  });
