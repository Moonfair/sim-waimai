import type { createApp } from '../app';

/** Solves the arithmetic captcha and registers a user, mirroring the real browser flow
 *  (POST /auth/register requires a valid captchaToken + captchaAnswer since the
 *  2026-07-14 security hardening). Every other test file that needs a logged-in user
 *  should call this instead of posting to /auth/register directly. */
export async function registerTestUser(
  app: ReturnType<typeof createApp>,
  cred: { username: string; password: string },
): Promise<Response> {
  const challenge = (await (await app.request('/api/auth/captcha')).json()) as {
    token: string;
    question: string;
  };
  const [a, b] = challenge.question.split('+').map((n) => Number(n.trim()));
  return app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...cred, captchaToken: challenge.token, captchaAnswer: a! + b! }),
  });
}
