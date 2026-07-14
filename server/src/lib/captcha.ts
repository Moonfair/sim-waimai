import { sign, verify } from 'hono/jwt';
import type { CaptchaChallenge } from '@sim-waimai/shared';
import { env } from '../env';

const CAPTCHA_TTL_S = 5 * 60;

interface CaptchaPayload {
  answer: number;
  exp: number;
  [key: string]: unknown;
}

function randomDigit(): number {
  return Math.floor(Math.random() * 9) + 1;
}

/** Stateless arithmetic captcha: the answer travels inside a signed, short-lived JWT rather
 *  than server-side session state, so a single process needs no Redis to verify it later. */
export async function issueCaptcha(): Promise<CaptchaChallenge> {
  const a = randomDigit();
  const b = randomDigit();
  const token = await sign(
    { answer: a + b, exp: Math.floor(Date.now() / 1000) + CAPTCHA_TTL_S },
    env.JWT_SECRET,
  );
  return { token, question: `${a} + ${b}` };
}

export async function verifyCaptcha(token: string, answer: number): Promise<boolean> {
  try {
    const payload = (await verify(token, env.JWT_SECRET, 'HS256')) as CaptchaPayload;
    return payload.answer === answer;
  } catch {
    return false;
  }
}
