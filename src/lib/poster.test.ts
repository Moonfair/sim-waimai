import { describe, expect, it } from 'vitest';
import { generateQrCodeDataUrl } from './poster';

describe('generateQrCodeDataUrl', () => {
  it('返回 PNG data URL', async () => {
    const url = await generateQrCodeDataUrl('https://example.com/restaurant/abc');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('相同输入得到相同结果', async () => {
    const a = await generateQrCodeDataUrl('https://example.com/x');
    const b = await generateQrCodeDataUrl('https://example.com/x');
    expect(a).toBe(b);
  });

  it('不同输入得到不同结果', async () => {
    const a = await generateQrCodeDataUrl('https://example.com/x');
    const b = await generateQrCodeDataUrl('https://example.com/y');
    expect(a).not.toBe(b);
  });
});
