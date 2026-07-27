import { describe, expect, it } from 'vitest';
import { FULL_IMAGE_BOOST_COUNT, MAX_IMAGE_BOOST, imageBoostFactor } from '../lib/imageBoost';

describe('imageBoostFactor', () => {
  it('is 1 with zero valid-image dishes', () => {
    expect(imageBoostFactor(0)).toBe(1);
  });

  it('reaches the cap exactly at FULL_IMAGE_BOOST_COUNT', () => {
    expect(imageBoostFactor(FULL_IMAGE_BOOST_COUNT)).toBe(MAX_IMAGE_BOOST);
  });

  it('never exceeds the cap beyond the threshold', () => {
    expect(imageBoostFactor(FULL_IMAGE_BOOST_COUNT + 50)).toBe(MAX_IMAGE_BOOST);
  });

  it('is monotonically non-decreasing', () => {
    let prev = imageBoostFactor(0);
    for (let n = 1; n <= FULL_IMAGE_BOOST_COUNT + 5; n++) {
      const next = imageBoostFactor(n);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
  });

  it('never dips below 1 for negative input', () => {
    expect(imageBoostFactor(-3)).toBe(1);
  });

  it('any two values are bounded within a 3x ratio of each other', () => {
    const samples = [0, 1, 2, 5, FULL_IMAGE_BOOST_COUNT, FULL_IMAGE_BOOST_COUNT + 20];
    for (const a of samples) {
      for (const b of samples) {
        expect(imageBoostFactor(a) / imageBoostFactor(b)).toBeLessThanOrEqual(MAX_IMAGE_BOOST);
      }
    }
  });
});
