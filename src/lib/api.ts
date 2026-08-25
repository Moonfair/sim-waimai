export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Set only for cross-origin builds (e.g. the Toy static bundle) that can't reach the API
 *  same-origin. Empty string keeps the existing relative-path, same-origin behavior. */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
export const CROSS_ORIGIN = API_BASE !== '';

const TOKEN_STORAGE_KEY = 'sw_token';

/** Cross-origin builds can't use the httpOnly session cookie (third-party cookie blocking),
 *  so the JWT travels as a Bearer header instead and is cached here. No-op same-origin. */
export function getStoredToken(): string | null {
  if (!CROSS_ORIGIN) return null;
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  if (!CROSS_ORIGIN) return;
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // storage unavailable (private mode, quota) — session just won't persist across reloads
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (CROSS_ORIGIN) {
    headers['X-Client'] = 'toy-bearer';
    const token = getStoredToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    credentials: CROSS_ORIGIN ? 'omit' : 'include',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = '请求失败，请稍后重试';
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // non-JSON error body; keep the generic message
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** Same-origin path (default) or the cross-origin API base (Toy build) — for building URLs
 *  that bypass the `api` client, e.g. EventSource, which can't send custom headers. */
export function apiUrl(path: string): string {
  return `${API_BASE}/api${path}`;
}
