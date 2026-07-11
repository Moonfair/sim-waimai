import { z } from 'zod';
import { cosPublicBase } from './cos';

/** True only for image URLs this server itself hands out: the local uploads path or the
 *  configured COS public base. Blocks persisting arbitrary third-party URLs that would then be
 *  served to other users (tracking pixels, referer/IP leaks, content spoofing). */
export function isAllowedImageUrl(value: string): boolean {
  if (value.startsWith('/api/uploads/')) return true;
  const base = cosPublicBase();
  return base !== null && value.startsWith(`${base}/`);
}

/** Reusable field validator for user-supplied image URLs. */
export const imageUrlSchema = z.string().max(500).refine(isAllowedImageUrl, '图片地址不合法');
