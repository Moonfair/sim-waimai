/**
 * Weighted random sampling without replacement (Efraimidis–Spirakis key method):
 * each item gets key = rng() ** (1/weight); the k items with the largest keys win.
 * Higher weight makes an item more likely to win, but never guarantees it.
 */
export function weightedSample<T>(
  items: T[],
  weight: (item: T) => number,
  k: number,
  rng: () => number = Math.random,
): T[] {
  return items
    .map((item) => ({ item, key: rng() ** (1 / Math.max(weight(item), 1e-6)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, k)
    .map(({ item }) => item);
}
