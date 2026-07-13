/**
 * Admins are designated via the ADMIN_USERNAMES env var (comma-separated).
 * Read from process.env on every call — not the frozen `env` snapshot — so
 * changes take effect without restart and tests can set it at runtime.
 * Lowercase comparison matches the case-insensitive username uniqueness.
 */
export function isAdmin(username: string): boolean {
  const raw = process.env.ADMIN_USERNAMES ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(username.toLowerCase());
}
