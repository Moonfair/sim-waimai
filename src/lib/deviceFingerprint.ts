import FingerprintJS from '@fingerprintjs/fingerprintjs';

const STORAGE_KEY = 'sw_device_id';

let cached: Promise<string> | null = null;

/** Stable per-browser device id: cached in localStorage so it's computed once, not on every call. */
export function getDeviceId(): Promise<string> {
  if (cached) return cached;

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    cached = Promise.resolve(stored);
    return cached;
  }

  cached = FingerprintJS.load()
    .then((fp) => fp.get())
    .then((result) => {
      localStorage.setItem(STORAGE_KEY, result.visitorId);
      return result.visitorId;
    });
  return cached;
}
