/** How many valid-image dishes it takes to reach the full boost. */
export const FULL_IMAGE_BOOST_COUNT = 10;
/** Cap: at most this many times the weight of a same-priority store with zero valid-image dishes. */
export const MAX_IMAGE_BOOST = 3;

/**
 * Saturating [1, MAX_IMAGE_BOOST] multiplier: rises linearly with validImageCount until
 * FULL_IMAGE_BOOST_COUNT, then flattens. Computed independently per restaurant (no normalization
 * against peers), so the ratio between any two restaurants sharing the same recommendPriority
 * tier is bounded by MAX_IMAGE_BOOST regardless of what else is in that tier.
 */
export function imageBoostFactor(validImageCount: number): number {
  const ratio = Math.min(Math.max(validImageCount, 0), FULL_IMAGE_BOOST_COUNT) / FULL_IMAGE_BOOST_COUNT;
  return 1 + (MAX_IMAGE_BOOST - 1) * ratio;
}
