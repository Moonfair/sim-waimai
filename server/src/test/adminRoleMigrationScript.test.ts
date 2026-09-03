import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { users } from '../db/schema';
import { migrateAdminRolesFromEnv } from '../db/migrateAdminRolesFromEnv';
import { registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const alice = { username: `t_mig_a_${stamp}`, password: 'secret123' };
const bob = { username: `t_mig_b_${stamp}`, password: 'secret123' };
let savedAdmins: string | undefined;

beforeAll(async () => {
  await registerTestUser(app, alice);
  await registerTestUser(app, bob);
  savedAdmins = process.env.ADMIN_USERNAMES;
});

afterEach(async () => {
  await db.update(users).set({ role: null }).where(inArray(users.username, [alice.username, bob.username]));
});

afterAll(async () => {
  if (savedAdmins === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = savedAdmins;
  await db.delete(users).where(inArray(users.username, [alice.username, bob.username]));
  await pool.end();
});

describe('migrateAdminRolesFromEnv', () => {
  it('grants superadmin to matched usernames and reports unmatched ones, case-insensitively', async () => {
    process.env.ADMIN_USERNAMES = `${alice.username.toUpperCase()}, does-not-exist-${stamp}`;
    const result = await migrateAdminRolesFromEnv();

    expect(result.granted).toEqual([alice.username]);
    expect(result.notFound).toEqual([`does-not-exist-${stamp}`]);

    const [row] = await db.select().from(users).where(inArray(users.username, [alice.username]));
    expect(row!.role).toBe('superadmin');
  });

  it('is idempotent: re-running an already-migrated username is a no-op, not an error', async () => {
    process.env.ADMIN_USERNAMES = alice.username;
    await migrateAdminRolesFromEnv();
    const second = await migrateAdminRolesFromEnv();

    expect(second.granted).toEqual([alice.username]);
    expect(second.notFound).toEqual([]);
    const [row] = await db.select().from(users).where(inArray(users.username, [alice.username]));
    expect(row!.role).toBe('superadmin');
  });

  it('handles multiple comma-separated usernames', async () => {
    process.env.ADMIN_USERNAMES = `${alice.username},${bob.username}`;
    const result = await migrateAdminRolesFromEnv();
    expect(result.granted.sort()).toEqual([alice.username, bob.username].sort());
    expect(result.notFound).toEqual([]);
  });

  it('returns empty results when ADMIN_USERNAMES is unset or blank', async () => {
    delete process.env.ADMIN_USERNAMES;
    const result = await migrateAdminRolesFromEnv();
    expect(result.granted).toEqual([]);
    expect(result.notFound).toEqual([]);
  });
});
