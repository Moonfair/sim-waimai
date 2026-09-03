import { sql } from 'drizzle-orm';
import type { AdminRole } from '@sim-waimai/shared';
import { db } from '../db/client';
import { users } from '../db/schema';

/** Re-derived from the DB on every call (no caching, nothing baked into the JWT) so that
 *  granting or revoking a role takes effect on the user's very next request — matching the
 *  old ADMIN_USERNAMES behavior of never requiring a re-login. Lowercase comparison matches
 *  the case-insensitive username uniqueness. */
export async function getRole(username: string): Promise<AdminRole | null> {
  const [row] = await db
    .select({ role: users.role })
    .from(users)
    .where(sql`lower(${users.username}) = ${username.toLowerCase()}`);
  return row?.role ?? null;
}

export async function isAdmin(username: string): Promise<boolean> {
  return (await getRole(username)) !== null;
}

export async function isSuperAdmin(username: string): Promise<boolean> {
  return (await getRole(username)) === 'superadmin';
}
