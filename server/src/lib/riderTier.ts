const TIERS = [
  { min: 0, label: '新手骑手' },
  { min: 5, label: '资深骑手' },
  { min: 20, label: '金牌骑手' },
  { min: 50, label: '王牌骑手' },
] as const;

export interface RiderTier {
  label: string;
  index: number;
  nextThreshold: number | null;
}

export function computeRiderTier(completedCount: number): RiderTier {
  let index = 0;
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (completedCount >= TIERS[i]!.min) {
      index = i;
      break;
    }
  }
  const next = TIERS[index + 1];
  return {
    label: TIERS[index]!.label,
    index,
    nextThreshold: next ? next.min : null,
  };
}
