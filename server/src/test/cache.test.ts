import { afterEach, describe, expect, it, vi } from 'vitest';
import { ttlCache } from '../lib/cache';

afterEach(() => {
  vi.useRealTimers();
});

describe('ttlCache', () => {
  it('loads once and serves the cached value within the ttl', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const get = ttlCache(1000, async () => {
      calls++;
      return calls;
    });
    expect(await get()).toBe(1);
    expect(await get()).toBe(1);
    expect(calls).toBe(1);
  });

  it('reloads after the ttl expires', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const get = ttlCache(1000, async () => {
      calls++;
      return calls;
    });
    expect(await get()).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(await get()).toBe(2);
  });

  it('coalesces concurrent misses into a single load', async () => {
    let calls = 0;
    const get = ttlCache(1000, async () => {
      calls++;
      await Promise.resolve();
      return 'v';
    });
    const [a, b] = await Promise.all([get(), get()]);
    expect(a).toBe('v');
    expect(b).toBe('v');
    expect(calls).toBe(1);
  });

  it('does not cache a rejected load', async () => {
    let attempt = 0;
    const get = ttlCache(1000, async () => {
      attempt++;
      if (attempt === 1) throw new Error('boom');
      return 'ok';
    });
    await expect(get()).rejects.toThrow('boom');
    expect(await get()).toBe('ok');
  });
});
