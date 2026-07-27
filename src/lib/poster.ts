import { toBlob } from 'html-to-image';
import QRCode from 'qrcode';

/** 生成用于海报内嵌的二维码 PNG data URL。 */
export async function generateQrCodeDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { width: 200, margin: 1 });
}

/** 把海报 DOM 节点截图为 PNG Blob。 */
export async function capturePosterImage(node: HTMLElement): Promise<Blob> {
  const blob = await toBlob(node, { pixelRatio: 2, cacheBust: true, backgroundColor: '#ffffff' });
  if (!blob) throw new Error('海报截图失败');
  return blob;
}

/** 触发浏览器下载海报图片。 */
export function savePosterImage(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
