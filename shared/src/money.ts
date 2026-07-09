/** Convert a yuan amount (may have decimals) to integer fen for DB storage. */
export function yuanToFen(yuan: number): number {
  return Math.round(yuan * 100);
}

/** Convert integer fen back to yuan for display/API responses. */
export function fenToYuan(fen: number): number {
  return fen / 100;
}
