import { apiUrl, CROSS_ORIGIN } from './api';

const COS_BASE = (import.meta.env.VITE_COS_BASE_URL ?? '').replace(/\/$/, '');

/** Resolves a restaurant image's COS object key (e.g. "restaurants/burgerking/banner.jpg")
 *  to a loadable URL. Already-absolute URLs and local-upload API paths pass through unchanged. */
export function assetUrl(path: string): string {
  // Local object URL / inline data — never proxied, always usable as-is.
  if (/^(blob:|data:)/.test(path)) return path;
  // Dev-fallback upload served by the API (proxied), not a COS key.
  if (path.startsWith('/api/')) return apiUrl(path.slice('/api'.length));

  if (CROSS_ORIGIN) {
    // The cross-origin (Toy) build can't fetch the COS domain directly (Private Network
    // Access blocks it), so route every COS object — key or already-absolute COS URL —
    // through our own /api/image-proxy instead. Uploaded images (banners, review photos)
    // are stored as full COS URLs; seed restaurant images are stored as bare keys.
    const key =
      COS_BASE && path.startsWith(COS_BASE) ? path.slice(COS_BASE.length).replace(/^\//, '') : path;
    if (/^https?:\/\//.test(key)) return key; // some other absolute URL — can't proxy, best effort
    return apiUrl(`/image-proxy?key=${encodeURIComponent(key)}`);
  }

  // Same-origin: already-absolute COS URL — use as-is.
  if (/^https?:\/\//.test(path)) return path;
  // Seed restaurant images: COS object key, resolved against VITE_COS_BASE_URL.
  return `${COS_BASE}/${path}`;
}
