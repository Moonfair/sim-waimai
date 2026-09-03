import { sql } from 'drizzle-orm';
import { db, pool } from './client';
import { users } from './schema';

/** Emergency CLI escape hatch for when nobody can reach the「管理员管理」UI (e.g. the last
 *  superadmin is locked out). Usage: npm -w server run admin:grant -- <username> <admin|superadmin>
 *  Pass role 'none' to revoke. */
async function grantAdminRole() {
  const [username, role] = process.argv.slice(2);
  if (!username || !role) {
    console.error('Usage: admin:grant -- <username> <admin|superadmin|none>');
    process.exitCode = 1;
    return;
  }
  if (role !== 'admin' && role !== 'superadmin' && role !== 'none') {
    console.error(`Invalid role "${role}" — must be admin, superadmin, or none.`);
    process.exitCode = 1;
    return;
  }

  const result = await db
    .update(users)
    .set({ role: role === 'none' ? null : role })
    .where(sql`lower(${users.username}) = ${username.toLowerCase()}`)
    .returning({ username: users.username });

  if (result.length === 0) {
    console.error(`No user found with username "${username}".`);
    process.exitCode = 1;
    return;
  }

  console.log(role === 'none' ? `Revoked admin role from ${result[0].username}.` : `Granted ${role} to ${result[0].username}.`);
}

grantAdminRole()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
