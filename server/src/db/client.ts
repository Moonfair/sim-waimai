import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env';
import * as schema from './schema';

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  // Fail slow/stuck queries instead of pinning a pool connection indefinitely.
  statement_timeout: 10_000,
  idle_in_transaction_session_timeout: 10_000,
});

export const db = drizzle(pool, { schema });
