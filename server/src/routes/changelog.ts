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
import { logAdminAction } from '../lib/auditLog';
import { validateJson } from '../lib/validate';
import { requireAdmin, requireChangelogEditor } from '../middleware/auth';

/** Plenty for a changelog's lifetime; the client pages through this fetched batch client-side. */
const LIST_LIMIT = 200;
const MAX_INSERT_ATTEMPTS = 3;
const DEFAULT_TITLE = '更新公告';

/** Blank strings from a form (title/version/date left empty) mean "use the default", not "invalid". */
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

/** 大版本(重大更新)/中版本(主要特性更新)/小版本(修复优化) 三段式版本号，每段独立可选。 */
const versionPartSchema = z.preprocess(
  emptyToUndefined,
  z.coerce.number().int().min(0, '版本号不能为负数').optional(),
);

const entryInputSchema = z.object({
  title: z.preprocess(emptyToUndefined, z.string().trim().max(100, '标题太长啦，最多100字').optional()),
  content: z.string().trim().min(1, '内容不能为空').max(4000, '内容太长啦，最多4000字'),
  versionMajor: versionPartSchema,
  versionMinor: versionPartSchema,
  versionPatch: versionPartSchema,
  date: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .refine((s) => !Number.isNaN(Date.parse(s)), '日期格式不对')
      .optional(),
  ),
});
type EntryInput = z.infer<typeof entryInputSchema>;
type VersionParts = { versionMajor: number; versionMinor: number; versionPatch: number };

const editorUsernameSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名'),
});

type EntryRow = typeof changelogEntries.$inferSelect;

function toEntryDto(row: EntryRow): ChangelogEntryDto {
  return {
    id: row.id,
    title: row.title,
    versionMajor: row.versionMajor,
    versionMinor: row.versionMinor,
    versionPatch: row.versionPatch,
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

function versionLabel(row: { title: string; versionMajor: number; versionMinor: number; versionPatch: number }): string {
  return `${row.title} v${row.versionMajor}.${row.versionMinor}.${row.versionPatch}`;
}

/** drizzle-orm wraps pg errors in a DrizzleQueryError with the original error on `.cause`,
 *  so the pg error code isn't at the top level. */
function isUniqueViolation(err: unknown): boolean {
  const code =
    (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
  return code === '23505';
}

async function latestVersion(): Promise<VersionParts | null> {
  const [row] = await db
    .select({
      versionMajor: changelogEntries.versionMajor,
      versionMinor: changelogEntries.versionMinor,
      versionPatch: changelogEntries.versionPatch,
    })
    .from(changelogEntries)
    .orderBy(desc(changelogEntries.versionMajor), desc(changelogEntries.versionMinor), desc(changelogEntries.versionPatch))
    .limit(1);
  return row ?? null;
}

/**
 * 语义化版本默认规则：
 * - 显式给了大版本号 -> 中/小版本号缺省的部分清零（例如只填大版本 2 -> 2.0.0）。
 * - 只给了中版本号 -> 沿用当前最新大版本号，小版本号缺省则清零。
 * - 只给了小版本号 -> 沿用当前最新大/中版本号。
 * - 三者都留空 -> 在当前最新版本基础上小版本+1；从未发布过公告则从 1.0.0 开始。
 */
async function resolveVersionParts(
  input: Pick<EntryInput, 'versionMajor' | 'versionMinor' | 'versionPatch'>,
): Promise<VersionParts> {
  if (input.versionMajor !== undefined) {
    return {
      versionMajor: input.versionMajor,
      versionMinor: input.versionMinor ?? 0,
      versionPatch: input.versionPatch ?? 0,
    };
  }
  const latest = await latestVersion();
  if (input.versionMinor !== undefined) {
    return {
      versionMajor: latest?.versionMajor ?? 1,
      versionMinor: input.versionMinor,
      versionPatch: input.versionPatch ?? 0,
    };
  }
  if (input.versionPatch !== undefined) {
    return {
      versionMajor: latest?.versionMajor ?? 1,
      versionMinor: latest?.versionMinor ?? 0,
      versionPatch: input.versionPatch,
    };
  }
  if (!latest) return { versionMajor: 1, versionMinor: 0, versionPatch: 0 };
  return { versionMajor: latest.versionMajor, versionMinor: latest.versionMinor, versionPatch: latest.versionPatch + 1 };
}

/** Blank version parts -> semver-style bump off the latest entry (retried on a rare concurrent-insert
 *  race); any explicit part -> used as-is, conflict reported rather than silently reassigned. Blank date -> now(). */
async function insertEntry(input: EntryInput, createdBy: string): Promise<EntryRow | 'conflict'> {
  const title = input.title ?? DEFAULT_TITLE;
  const createdAt = input.date ? new Date(input.date) : new Date();
  const explicitVersionGiven =
    input.versionMajor !== undefined || input.versionMinor !== undefined || input.versionPatch !== undefined;

  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
    const parts = await resolveVersionParts(input);
    try {
      const [row] = await db
        .insert(changelogEntries)
        .values({ ...parts, title, content: input.content, createdAt, createdBy })
        .returning();
      return row!;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const isLastAttempt = attempt === MAX_INSERT_ATTEMPTS - 1;
      if (explicitVersionGiven || isLastAttempt) return 'conflict';
      // Fully-auto bump: loop again, resolveVersionParts will recompute off the new max.
    }
  }
  throw new Error('unreachable');
}

/** GET /changelog — public list, newest version first. */
export const changelogRoutes = new Hono().get('/', async (c) => {
  const rows = await db
    .select()
    .from(changelogEntries)
    .orderBy(desc(changelogEntries.versionMajor), desc(changelogEntries.versionMinor), desc(changelogEntries.versionPatch))
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
    await logAdminAction({
      actorUsername: c.get('user').username,
      action: 'changelog.create',
      targetType: 'changelogEntry',
      targetId: result.id,
      targetLabel: versionLabel(result),
    });
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
    if (input.versionMajor !== undefined) set.versionMajor = input.versionMajor;
    if (input.versionMinor !== undefined) set.versionMinor = input.versionMinor;
    if (input.versionPatch !== undefined) set.versionPatch = input.versionPatch;
    if (input.date !== undefined) set.createdAt = new Date(input.date);

    try {
      const [row] = await db
        .update(changelogEntries)
        .set(set)
        .where(eq(changelogEntries.id, c.req.param('id')))
        .returning();
      if (!row) return c.json({ error: '公告不存在' }, 404);
      await logAdminAction({
        actorUsername: c.get('user').username,
        action: 'changelog.update',
        targetType: 'changelogEntry',
        targetId: row.id,
        targetLabel: versionLabel(row),
      });
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
      .returning();
    if (!row) return c.json({ error: '公告不存在' }, 404);
    await logAdminAction({
      actorUsername: c.get('user').username,
      action: 'changelog.delete',
      targetType: 'changelogEntry',
      targetId: row.id,
      targetLabel: versionLabel(row),
    });
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
    await logAdminAction({
      actorUsername: c.get('user').username,
      action: 'changelog_editor.grant',
      targetType: 'changelogEditor',
      targetId: row!.username,
      targetLabel: row!.username,
    });
    return c.json(toEditorDto(row!));
  })
  .delete('/changelog-editors/:username', requireAdmin, async (c) => {
    const [row] = await db
      .delete(changelogEditors)
      .where(eq(changelogEditors.username, c.req.param('username').toLowerCase()))
      .returning({ username: changelogEditors.username });
    if (!row) return c.json({ error: '该用户不是更新日志编辑者' }, 404);
    await logAdminAction({
      actorUsername: c.get('user').username,
      action: 'changelog_editor.revoke',
      targetType: 'changelogEditor',
      targetId: row.username,
      targetLabel: row.username,
    });
    return c.json({ ok: true });
  });
