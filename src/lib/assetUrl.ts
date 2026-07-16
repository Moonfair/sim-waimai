/** Resolves a restaurant image's COS object key (e.g. "restaurants/burgerking/banner.jpg")
 *  to a loadable URL. Already-absolute URLs and local-upload API paths pass through unchanged. */
export function assetUrl(path: string): string {
  // Absolute/self-contained URL (COS object, local object URL, inline data) — use as-is.
  if (/^(https?:\/\/|blob:|data:)/.test(path)) return path;
  // Dev-fallback upload served by the API (proxied), not a COS key.
  if (path.startsWith('/api/')) return path;
  // Seed restaurant images: COS object key, resolved against VITE_COS_BASE_URL.
  const base = import.meta.env.VITE_COS_BASE_URL ?? '';
  return `${base.replace(/\/$/, '')}/${path}`;
}
