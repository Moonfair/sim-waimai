import Aegis from 'aegis-web-sdk';

let aegis: Aegis | null = null;

export function initAnalytics(): void {
  const id = import.meta.env.VITE_RUM_ID;
  if (!id) return;
  if (aegis) return;

  aegis = new Aegis({
    id,
    reportApiSpeed: true,
    reportAssetSpeed: true,
    spa: true,
    hostUrl: 'https://rumt-zh.com',
  });
}

function clamp(n: number): number {
  return Math.max(0, Math.min(60000, Math.round(n)));
}

export function reportOrder(amount: number, calories: number): void {
  if (!aegis) return;
  aegis.reportTime({ name: 'order_amount', duration: clamp(amount) });
  aegis.reportTime({ name: 'order_calories', duration: clamp(calories) });
}
