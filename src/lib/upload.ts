import type { PresignResponse, UploadKind } from '@sim-waimai/shared';
import { api } from './api';

/** Upload an image via presigned PUT (COS in prod, local-disk fallback in dev).
 *  Returns the public URL to store on the entity. */
export async function uploadImage(
  file: File,
  kind: UploadKind,
  restaurantId?: string,
): Promise<string> {
  const grant = await api.post<PresignResponse>('/uploads/presign', {
    kind,
    restaurantId,
    contentType: file.type,
  });
  const res = await fetch(grant.uploadUrl, {
    method: grant.method,
    body: file,
    headers: grant.headers,
    // same-origin dev fallback needs the auth cookie; COS URLs are cross-origin
    credentials: grant.uploadUrl.startsWith('/') ? 'include' : 'omit',
  });
  if (!res.ok) throw new Error('图片上传失败，请稍后重试');
  return grant.publicUrl;
}
