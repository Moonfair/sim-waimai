import { sign, verify } from 'hono/jwt';
import { env } from '../env';

export interface AuthPayload {
  /** User id. */
  sub: string;
  username: string;
  exp: number;
  [key: string]: unknown;
}

const SEVEN_DAYS_S = 7 * 24 * 3600;

export function signToken(user: { id: string; username: string }): Promise<string> {
  return sign(
    { sub: user.id, username: user.username, exp: Math.floor(Date.now() / 1000) + SEVEN_DAYS_S },
    env.JWT_SECRET,
  );
}

export async function verifyToken(token: string): Promise<AuthPayload | null> {
  try {
    return (await verify(token, env.JWT_SECRET, 'HS256')) as AuthPayload;
  } catch {
    return null;
  }
}
