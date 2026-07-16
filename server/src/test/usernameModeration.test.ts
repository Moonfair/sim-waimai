import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { createApp } from '../app';
import { db, pool } from '../db/client';
import { users } from '../db/schema';
import { __setReviewer, moderateTextSync } from '../lib/moderationProvider';
import { registerTestUser } from './testHelpers';

const app = createApp();
const stamp = Date.now().toString(36);
const created: string[] = [];

function cred(suffix: string) {
  const c = { username: `t_um_${suffix}_${stamp}`, password: 'secret123' };
  created.push(c.username);
  return c;
}

afterAll(async () => {
  await db.delete(users).where(inArray(users.username, created));
  await pool.end();
});

afterEach(() => {
  __setReviewer(null);
});

describe('注册用户名 AI 审核（fail-open）', () => {
  it('AI 判定违规 → 400 拒绝注册', async () => {
    __setReviewer(async () => ({ verdict: 'reject', reason: '文本命中「辱骂」', confidence: 0.98 }));
    const res = await registerTestUser(app, cred('rej'));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('违规');
  });

  it('AI 通过或存疑 → 正常注册', async () => {
    __setReviewer(async () => ({ verdict: 'approve', reason: 'ok', confidence: 0.99 }));
    expect((await registerTestUser(app, cred('ok'))).status).toBe(200);

    __setReviewer(async () => ({ verdict: 'uncertain', reason: '无法判断', confidence: 0.4 }));
    expect((await registerTestUser(app, cred('unc'))).status).toBe(200);
  });

  it('AI 调用抛错 → fail-open 正常注册', async () => {
    __setReviewer(async () => {
      throw new Error('boom');
    });
    expect((await registerTestUser(app, cred('err'))).status).toBe(200);
  });

  it('未配置凭证 → 正常注册', async () => {
    expect((await registerTestUser(app, cred('nokey'))).status).toBe(200);
  });

  it('moderateTextSync：审核挂起超时返回 null（fail-open 依据）', async () => {
    __setReviewer(() => new Promise(() => {})); // never resolves
    expect(await moderateTextSync('慢吞吞的用户名', 50)).toBeNull();
  });
});
