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
const DEFAULT_TITLE = '更新公告';

/** Blank strings from a form (title/version/date left empty) mean "use the default", not "invalid". */
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const entryInputSchema = z.object({
  title: z.preprocess(emptyToUndefined, z.string().trim().max(100, '标题太长啦，最多100字').optional()),
  content: z.string().trim().min(1, '内容不能为空').max(4000, '内容太长啦，最多4000字'),
  version: z.preprocess(emptyToUndefined, z.coerce.number().int().positive('版本号必须是正整数').optional()),
  date: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .refine((s) => !Number.isNaN(Date.parse(s)), '日期格式不对')
      .optional(),
  ),
});
type EntryInput = z.infer<typeof entryInputSchema>;

const editorUsernameSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名'),
});

type EntryRow = typeof changelogEntries.$inferSelect;

function toEntryDto(row: EntryRow): ChangelogEntryDto {
  return {
    id: row.id,
    title: row.title,
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

/** drizzle-orm wraps pg errors in a DrizzleQueryError with the original error on `.cause`,
 *  so the pg error code isn't at the top level. */
function isUniqueViolation(err: unknown): boolean {
  const code =
    (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
  return code === '23505';
}

async function nextAutoVersion(): Promise<number> {
  const [{ nextVersion }] = await db
    .select({ nextVersion: sql<number>`coalesce(max(${changelogEntries.version}), 0)::int + 1` })
    .from(changelogEntries);
  return nextVersion;
}

/** Blank version -> max(version)+1 (retried on a rare concurrent-insert race); explicit version ->
 *  used as-is, conflict reported rather than silently reassigned. Blank date -> now(). */
async function insertEntry(input: EntryInput, createdBy: string): Promise<EntryRow | 'conflict'> {
  const title = input.title ?? DEFAULT_TITLE;
  const createdAt = input.date ? new Date(input.date) : new Date();

  if (input.version !== undefined) {
    try {
      const [row] = await db
        .insert(changelogEntries)
        .values({ version: input.version, title, content: input.content, createdAt, createdBy })
        .returning();
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) return 'conflict';
      throw err;
    }
  }

  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
    const version = await nextAutoVersion();
    try {
      const [row] = await db
        .insert(changelogEntries)
        .values({ version, title, content: input.content, createdAt, createdBy })
        .returning();
      return row!;
    } catch (err) {
      const isLastAttempt = attempt === MAX_INSERT_ATTEMPTS - 1;
      if (isUniqueViolation(err) && !isLastAttempt) continue;
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
  .post('/changelog', requireChangelogEditor, validateJson(entryInputSchema), async (c) => {
    const input = c.req.valid('json');
    const result = await insertEntry(input, c.get('user').username);
    if (result === 'conflict') return c.json({ error: '该版本号已被使用' }, 409);
    return c.json(toEntryDto(result));
  })
  .patch('/changelog/:id', requireChangelogEditor, validateJson(entryInputSchema), async (c) => {
    const input = c.req.valid('json');
    // Blank title/version/date on an edit means "keep the existing value", unlike on create
    // where blank means "use the default" — there's no sensible default to fall back to here.
    const set: Partial<typeof changelogEntries.$inferInsert> = {
      content: input.content,
      updatedAt: new Date(),
      updatedBy: c.get('user').username,
    };
    if (input.title !== undefined) set.title = input.title;
    if (input.version !== undefined) set.version = input.version;
    if (input.date !== undefined) set.createdAt = new Date(input.date);

    try {
      const [row] = await db
        .update(changelogEntries)
        .set(set)
        .where(eq(changelogEntries.id, c.req.param('id')))
        .returning();
      if (!row) return c.json({ error: '公告不存在' }, 404);
      return c.json(toEntryDto(row));
    } catch (err) {
      if (isUniqueViolation(err)) return c.json({ error: '该版本号已被使用' }, 409);
      throw err;
    }
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
