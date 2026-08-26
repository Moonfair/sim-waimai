import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import type {
  ChangelogEditorListDto,
  ChangelogEntryDto,
  ChangelogListDto,
  UserDto,
} from '@sim-waimai/shared';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { changelogEditors, changelogEntries, users } from '../db/schema';
import { registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
// Huge vs. any other test's default-bumped versions, so explicit-major tests here never collide.
const baseMajor = Math.floor(Date.now() / 1000);
const admin = { username: `t_chlog_a_${stamp}`, password: 'secret123' };
const editor = { username: `t_chlog_e_${stamp}`, password: 'secret123' };
const plain = { username: `t_chlog_p_${stamp}`, password: 'secret123' };
let adminCookie = '';
let editorCookie = '';
let plainCookie = '';
let savedAdmins: string | undefined;

async function register(cred: { username: string; password: string }) {
  const res = await registerTestUser(app, cred);
  return {
    cookie: (res.headers.get('set-cookie') ?? '').split(';')[0],
    user: (await res.json()) as UserDto,
  };
}

function req(path: string, cookie: string, init?: { method?: string; body?: unknown }) {
  return app.request(path, {
    method: init?.method ?? 'GET',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

beforeAll(async () => {
  savedAdmins = process.env.ADMIN_USERNAMES;
  process.env.ADMIN_USERNAMES = [savedAdmins, admin.username].filter(Boolean).join(',');
  const a = await register(admin);
  adminCookie = a.cookie;
  expect(a.user.isAdmin).toBe(true);
  expect(a.user.canManageChangelog).toBe(true);

  const e = await register(editor);
  editorCookie = e.cookie;
  expect(e.user.canManageChangelog).toBe(false);

  const p = await register(plain);
  plainCookie = p.cookie;
});

afterAll(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = savedAdmins;
  await db.delete(changelogEntries).where(inArray(changelogEntries.createdBy, [admin.username, editor.username]));
  await db.delete(changelogEditors).where(inArray(changelogEditors.username, [editor.username, plain.username]));
  await db.delete(users).where(inArray(users.username, [admin.username, editor.username, plain.username]));
  await pool.end();
});

describe('GET /api/changelog', () => {
  it('is public and lists newest version first', async () => {
    const c1 = await req('/api/admin/changelog', adminCookie, {
      method: 'POST',
      body: { content: `v1_${stamp}`, versionMajor: baseMajor },
    });
    const e1 = (await c1.json()) as ChangelogEntryDto;
    expect(e1.versionMajor).toBe(baseMajor);
    expect(e1.versionMinor).toBe(0);
    expect(e1.versionPatch).toBe(0);

    const c2 = await req('/api/admin/changelog', adminCookie, { method: 'POST', body: { content: `v2_${stamp}` } });
    const e2 = (await c2.json()) as ChangelogEntryDto;
    expect(e2.versionMajor).toBe(baseMajor);
    expect(e2.versionMinor).toBe(0);
    expect(e2.versionPatch).toBe(1); // fully blank -> patch bump off e1

    const res = await req('/api/changelog', '');
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as ChangelogListDto;
    const idx1 = items.findIndex((it) => it.id === e1.id);
    const idx2 = items.findIndex((it) => it.id === e2.id);
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeLessThan(idx1); // newer version appears first
  });
});

describe('POST /api/admin/changelog', () => {
  it('rejects unauthenticated', async () => {
    const res = await req('/api/admin/changelog', '', { method: 'POST', body: { content: 'x' } });
    expect(res.status).toBe(401);
  });

  it('rejects a plain user', async () => {
    const res = await req('/api/admin/changelog', plainCookie, { method: 'POST', body: { content: 'x' } });
    expect(res.status).toBe(403);
  });

  it('rejects empty content', async () => {
    const res = await req('/api/admin/changelog', adminCookie, { method: 'POST', body: { content: '  ' } });
    expect(res.status).toBe(400);
  });

  it('sets createdBy and defaults title/date/version when left blank', async () => {
    const res = await req('/api/admin/changelog', adminCookie, {
      method: 'POST',
      body: { content: `created_${stamp}` },
    });
    expect(res.status).toBe(200);
    const entry = (await res.json()) as ChangelogEntryDto;
    expect(entry.createdBy).toBe(admin.username);
    expect(entry.title).toBe('更新公告');
    expect(entry.versionMajor).toBeGreaterThan(0);
    expect(entry.createdAt).toBeTruthy();
    expect(entry.updatedAt).toBeNull();
  });

  it('honors a fully explicit major.minor.patch and date', async () => {
    const res = await req('/api/admin/changelog', adminCookie, {
      method: 'POST',
      body: {
        title: `自定义标题_${stamp}`,
        content: `explicit_${stamp}`,
        versionMajor: baseMajor + 1,
        versionMinor: 5,
        versionPatch: 2,
        date: '2020-01-01',
      },
    });
    expect(res.status).toBe(200);
    const entry = (await res.json()) as ChangelogEntryDto;
    expect(entry.title).toBe(`自定义标题_${stamp}`);
    expect(entry.versionMajor).toBe(baseMajor + 1);
    expect(entry.versionMinor).toBe(5);
    expect(entry.versionPatch).toBe(2);
    expect(entry.createdAt.slice(0, 10)).toBe('2020-01-01');
  });

  it('zeroes out omitted lower parts: major alone -> x.0.0', async () => {
    const res = await req('/api/admin/changelog', adminCookie, {
      method: 'POST',
      body: { content: `major_only_${stamp}`, versionMajor: baseMajor + 2 },
    });
    expect(res.status).toBe(200);
    const entry = (await res.json()) as ChangelogEntryDto;
    expect(entry.versionMajor).toBe(baseMajor + 2);
    expect(entry.versionMinor).toBe(0);
    expect(entry.versionPatch).toBe(0);
  });

  it('minor alone keeps the current latest major, zeroes patch', async () => {
    // Latest is now (baseMajor+2, 0, 0) from the previous test.
    const res = await req('/api/admin/changelog', adminCookie, {
      method: 'POST',
      body: { content: `minor_only_${stamp}`, versionMinor: 3 },
    });
    expect(res.status).toBe(200);
    const entry = (await res.json()) as ChangelogEntryDto;
    expect(entry.versionMajor).toBe(baseMajor + 2);
    expect(entry.versionMinor).toBe(3);
    expect(entry.versionPatch).toBe(0);
  });

  it('patch alone keeps the current latest major and minor', async () => {
    // Latest is now (baseMajor+2, 3, 0) from the previous test.
    const res = await req('/api/admin/changelog', adminCookie, {
      method: 'POST',
      body: { content: `patch_only_${stamp}`, versionPatch: 9 },
    });
    expect(res.status).toBe(200);
    const entry = (await res.json()) as ChangelogEntryDto;
    expect(entry.versionMajor).toBe(baseMajor + 2);
    expect(entry.versionMinor).toBe(3);
    expect(entry.versionPatch).toBe(9);
  });

  it('rejects reusing an already-taken version triple', async () => {
    const body = { content: `dup_${stamp}`, versionMajor: baseMajor + 3, versionMinor: 1, versionPatch: 1 };
    const first = await req('/api/admin/changelog', adminCookie, { method: 'POST', body });
    expect(first.status).toBe(200);
    const second = await req('/api/admin/changelog', adminCookie, {
      method: 'POST',
      body: { ...body, content: `dup2_${stamp}` },
    });
    expect(second.status).toBe(409);
  });

  it('rejects a negative version part and a malformed date', async () => {
    const badVersion = await req('/api/admin/changelog', adminCookie, {
      method: 'POST',
      body: { content: `x_${stamp}`, versionMajor: -1 },
    });
    expect(badVersion.status).toBe(400);

    const badDate = await req('/api/admin/changelog', adminCookie, {
      method: 'POST',
      body: { content: `x_${stamp}`, date: 'not-a-date' },
    });
    expect(badDate.status).toBe(400);
  });
});

describe('PATCH /api/admin/changelog/:id — 留空保留原值', () => {
  it('blank title/version/date keep the existing value; explicit ones overwrite it', async () => {
    const created = await req('/api/admin/changelog', adminCookie, {
      method: 'POST',
      body: {
        title: `原标题_${stamp}`,
        content: `patch_base_${stamp}`,
        versionMajor: baseMajor + 4,
        versionMinor: 0,
        versionPatch: 0,
      },
    });
    const entry = (await created.json()) as ChangelogEntryDto;

    const blankPatch = await req(`/api/admin/changelog/${entry.id}`, adminCookie, {
      method: 'PATCH',
      body: { content: `patch_updated_${stamp}` },
    });
    expect(blankPatch.status).toBe(200);
    const afterBlank = (await blankPatch.json()) as ChangelogEntryDto;
    expect(afterBlank.title).toBe(`原标题_${stamp}`);
    expect(afterBlank.versionMajor).toBe(entry.versionMajor);
    expect(afterBlank.versionMinor).toBe(entry.versionMinor);
    expect(afterBlank.versionPatch).toBe(entry.versionPatch);
    expect(afterBlank.createdAt).toBe(entry.createdAt);
    expect(afterBlank.content).toBe(`patch_updated_${stamp}`);

    // Editing a single part (minor) leaves major/patch alone — PATCH never applies the
    // create-time "reset lower parts to 0" convention.
    const explicitPatch = await req(`/api/admin/changelog/${entry.id}`, adminCookie, {
      method: 'PATCH',
      body: { title: `新标题_${stamp}`, content: `patch_updated_${stamp}`, versionMinor: 7, date: '2021-06-15' },
    });
    expect(explicitPatch.status).toBe(200);
    const afterExplicit = (await explicitPatch.json()) as ChangelogEntryDto;
    expect(afterExplicit.title).toBe(`新标题_${stamp}`);
    expect(afterExplicit.versionMajor).toBe(entry.versionMajor);
    expect(afterExplicit.versionMinor).toBe(7);
    expect(afterExplicit.versionPatch).toBe(entry.versionPatch);
    expect(afterExplicit.createdAt.slice(0, 10)).toBe('2021-06-15');
  });
});

describe('更新日志编辑者授权', () => {
  it('a designated editor gains canManageChangelog and can manage entries', async () => {
    const grant = await req('/api/admin/changelog-editors', adminCookie, {
      method: 'POST',
      body: { username: editor.username },
    });
    expect(grant.status).toBe(200);

    const me = await req('/api/auth/me', editorCookie);
    const meDto = (await me.json()) as UserDto;
    expect(meDto.canManageChangelog).toBe(true);
    expect(meDto.isAdmin).toBeFalsy();

    const create = await req('/api/admin/changelog', editorCookie, {
      method: 'POST',
      body: { content: `by_editor_${stamp}` },
    });
    expect(create.status).toBe(200);
    const entry = (await create.json()) as ChangelogEntryDto;
    expect(entry.createdBy).toBe(editor.username);

    const patch = await req(`/api/admin/changelog/${entry.id}`, editorCookie, {
      method: 'PATCH',
      body: { content: `edited_${stamp}` },
    });
    expect(patch.status).toBe(200);
    const updated = (await patch.json()) as ChangelogEntryDto;
    expect(updated.content).toBe(`edited_${stamp}`);
    expect(updated.updatedBy).toBe(editor.username);
    // editing content never bumps the version
    expect(updated.versionMajor).toBe(entry.versionMajor);
    expect(updated.versionMinor).toBe(entry.versionMinor);
    expect(updated.versionPatch).toBe(entry.versionPatch);

    const del = await req(`/api/admin/changelog/${entry.id}`, editorCookie, { method: 'DELETE' });
    expect(del.status).toBe(200);
  });

  it('an editor (not admin) cannot manage the editor roster', async () => {
    const res = await req('/api/admin/changelog-editors', editorCookie);
    expect(res.status).toBe(403);
  });

  it('rejects designating a nonexistent user', async () => {
    const res = await req('/api/admin/changelog-editors', adminCookie, {
      method: 'POST',
      body: { username: `nobody_${stamp}` },
    });
    expect(res.status).toBe(404);
  });

  it('rejects designating the same user twice', async () => {
    const res = await req('/api/admin/changelog-editors', adminCookie, {
      method: 'POST',
      body: { username: editor.username },
    });
    expect(res.status).toBe(409);
  });

  it('lists designated editors for admins', async () => {
    const res = await req('/api/admin/changelog-editors', adminCookie);
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as ChangelogEditorListDto;
    expect(items.some((it) => it.username === editor.username.toLowerCase())).toBe(true);
  });

  it('revoking access drops canManageChangelog and blocks further edits', async () => {
    const revoke = await req(`/api/admin/changelog-editors/${editor.username}`, adminCookie, {
      method: 'DELETE',
    });
    expect(revoke.status).toBe(200);

    const me = await req('/api/auth/me', editorCookie);
    expect(((await me.json()) as UserDto).canManageChangelog).toBe(false);

    const blocked = await req('/api/admin/changelog', editorCookie, {
      method: 'POST',
      body: { content: 'should be blocked' },
    });
    expect(blocked.status).toBe(403);
  });
});
