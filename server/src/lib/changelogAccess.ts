import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { changelogEditors } from '../db/schema';
import { isAdmin } from './admin';

/** True when username was explicitly designated by an admin (independent of isAdmin).
 *  `changelog_editors.username` is always stored lowercase (see addChangelogEditor). */
export async function isChangelogEditor(username: string): Promise<boolean> {
  const [row] = await db
    .select({ username: changelogEditors.username })
    .from(changelogEditors)
    .where(eq(changelogEditors.username, username.toLowerCase()));
  return !!row;
}

/** Full admins, plus anyone an admin has designated via changelog_editors. */
export async function canManageChangelog(username: string): Promise<boolean> {
  return isAdmin(username) || (await isChangelogEditor(username));
}
