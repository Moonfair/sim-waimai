import { sql } from 'drizzle-orm';
import { db, pool } from './client';
import { users } from './schema';

/** One-off, idempotent: reads ADMIN_USERNAMES and grants each matched user the
 *  'superadmin' role in the DB. Safe to re-run — already-superadmin users are a no-op.
 *  Run once right after the schema migration that adds users.role lands, then
 *  ADMIN_USERNAMES is no longer read by the running application. Exported (rather than only
 *  invoked at the bottom of this file) so tests can call the core logic directly without
 *  triggering the CLI's pool.end(). */
export async function migrateAdminRolesFromEnv(): Promise<{ granted: string[]; notFound: string[] }> {
  const raw = process.env.ADMIN_USERNAMES ?? '';
  const usernames = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const granted: string[] = [];
  const notFound: string[] = [];
  for (const username of usernames) {
    const result = await db
      .update(users)
      .set({ role: 'superadmin' })
      .where(sql`lower(${users.username}) = ${username}`)
      .returning({ username: users.username });
    if (result.length > 0) {
      granted.push(result[0].username);
    } else {
      notFound.push(username);
    }
  }
  return { granted, notFound };
}

/** Only runs when this file is executed directly (`npm -w server run admin:migrate-roles`),
 *  not when imported — e.g. by a test — so importing it never triggers the CLI side effects. */
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateAdminRolesFromEnv()
    .then(({ granted, notFound }) => {
      if (granted.length === 0 && notFound.length === 0) {
        console.log('ADMIN_USERNAMES is empty — nothing to migrate.');
        return;
      }
      console.log(`Granted superadmin to ${granted.length} user(s): ${granted.join(', ') || '(none)'}`);
      if (notFound.length > 0) console.log(`Not found (skipped): ${notFound.join(', ')}`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
