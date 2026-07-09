import { zValidator } from '@hono/zod-validator';
import type { ZodType } from 'zod';

/** JSON-body validator that answers with `{error: firstIssueMessage}` on failure. */
export function validateJson<T extends ZodType>(schema: T) {
  return zValidator('json', schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: result.error.issues[0]?.message ?? '参数错误' }, 400);
    }
  });
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
