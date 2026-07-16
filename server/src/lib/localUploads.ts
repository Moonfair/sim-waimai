import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本地盘回落时上传文件的根目录（server/uploads/）。 */
export const UPLOADS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');

/** 按上传 key（形如 uploads/reviews/{userId}/{uuid}.jpg）读取本地盘文件。 */
export function readLocalUpload(key: string): Promise<Buffer> {
  return fs.readFile(path.join(UPLOADS_DIR, key.replace(/^uploads\//, '')));
}
