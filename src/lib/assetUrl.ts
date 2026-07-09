/** Resolves a restaurant image's COS object key (e.g. "restaurants/burgerking/banner.jpg")
 *  to a loadable URL. Already-absolute URLs pass through unchanged. */
export function assetUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const base = import.meta.env.VITE_COS_BASE_URL ?? '';
  return `${base.replace(/\/$/, '')}/${path}`;
}
