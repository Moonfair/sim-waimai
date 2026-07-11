/** Memoize a single async value for `ttlMs`. Concurrent cache misses share one in-flight load,
 *  and a rejected load is never cached. Intended for cheap, process-local read caching. */
export function ttlCache<T>(ttlMs: number, load: () => Promise<T>): () => Promise<T> {
  let value: T;
  let hasValue = false;
  let expiresAt = 0;
  let inflight: Promise<T> | null = null;

  return () => {
    const now = Date.now();
    if (hasValue && now < expiresAt) return Promise.resolve(value);
    if (inflight) return inflight;
    inflight = load()
      .then((v) => {
        value = v;
        hasValue = true;
        expiresAt = Date.now() + ttlMs;
        inflight = null;
        return v;
      })
      .catch((err) => {
        inflight = null;
        throw err;
      });
    return inflight;
  };
}
