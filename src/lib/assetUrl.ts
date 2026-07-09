export function assetUrl(path: string): string {
  // Absolute URL (e.g. Tencent COS object) — use as-is.
  if (/^https?:\/\//.test(path)) return path;
  // Dev-fallback upload served by the API (proxied), not under BASE_URL.
  if (path.startsWith('/api/')) return path;
  return `${import.meta.env.BASE_URL}${path}`;
}
