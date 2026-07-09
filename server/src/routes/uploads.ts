import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { PresignResponse } from '@sim-waimai/shared';
import { db } from '../db/client';
import { restaurants } from '../db/schema';
import { isCosConfigured, presignPut, publicUrlFor } from '../lib/cos';
import { validateJson } from '../lib/validate';
import { optionalAuth, requireAuth } from '../middleware/auth';

const UPLOADS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const presignSchema = z.object({
  kind: z.enum(['banner', 'item', 'review']),
  restaurantId: z.string().max(50).optional(),
  contentType: z.string(),
});

/** Keys are server-generated, but re-validate on the local PUT/GET path. */
const KEY_RE = /^uploads\/[\w-]+(\/[\w-]+)*\.(jpg|png|webp)$/;

export const uploadRoutes = new Hono()
  .post('/presign', requireAuth, validateJson(presignSchema), async (c) => {
    const user = c.get('user');
    const { kind, restaurantId, contentType } = c.req.valid('json');

    const ext = EXT_BY_CONTENT_TYPE[contentType.toLowerCase()];
    if (!ext) return c.json({ error: '仅支持 jpg/png/webp 图片' }, 400);

    let key: string;
    if (kind === 'review') {
      key = `uploads/reviews/${user.sub}/${randomUUID()}.${ext}`;
    } else {
      if (!restaurantId) return c.json({ error: '缺少店铺 id' }, 400);
      const [shop] = await db
        .select({ ownerId: restaurants.ownerId })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId));
      if (!shop) return c.json({ error: '店铺不存在' }, 404);
      if (shop.ownerId !== user.sub) return c.json({ error: '无权管理该店铺' }, 403);
      key = `uploads/${restaurantId}/${kind === 'banner' ? 'banner' : 'items'}/${randomUUID()}.${ext}`;
    }

    const response: PresignResponse = isCosConfigured()
      ? {
          uploadUrl: await presignPut(key),
          method: 'PUT',
          publicUrl: publicUrlFor(key),
          headers: { 'Content-Type': contentType },
        }
      : {
          // dev fallback: bytes land on local disk via the routes below
          uploadUrl: `/api/uploads/local/${key}`,
          method: 'PUT',
          publicUrl: `/api/uploads/local/${key}`,
          headers: { 'Content-Type': contentType },
        };
    return c.json(response);
  })
  .put('/local/:key{.+}', requireAuth, async (c) => {
    const key = c.req.param('key');
    if (!KEY_RE.test(key)) return c.json({ error: '无效的文件路径' }, 400);
    const body = await c.req.arrayBuffer();
    if (body.byteLength === 0) return c.json({ error: '文件为空' }, 400);
    if (body.byteLength > MAX_UPLOAD_BYTES) return c.json({ error: '图片不能超过5MB' }, 413);
    const filePath = path.join(UPLOADS_DIR, key.replace(/^uploads\//, ''));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from(body));
    return c.json({ ok: true });
  })
  .get('/local/:key{.+}', optionalAuth, async (c) => {
    const key = c.req.param('key');
    if (!KEY_RE.test(key)) return c.json({ error: '无效的文件路径' }, 400);
    const filePath = path.join(UPLOADS_DIR, key.replace(/^uploads\//, ''));
    try {
      const data = await fs.readFile(filePath);
      const ext = key.split('.').pop()!;
      return c.body(new Uint8Array(data).buffer as ArrayBuffer, 200, {
        'Content-Type': CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
    } catch {
      return c.json({ error: '文件不存在' }, 404);
    }
  });
