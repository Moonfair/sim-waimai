// Restaurant data now lives in the backend database (seeded from ./restaurants/*.json
// by server/src/db/seed.ts). Pages fetch it via /api/restaurants. This module only
// re-exports the shared types for the components that import from here.
export type { Category, MenuItem, Restaurant } from './types';
