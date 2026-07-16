import { describe, expect, it } from 'vitest';
import { assetUrl } from './assetUrl';

describe('assetUrl', () => {
  it('blob: 与 data: URL 原样直通', () => {
    expect(assetUrl('blob:http://localhost:5173/abc-123')).toBe('blob:http://localhost:5173/abc-123');
    expect(assetUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
  });

  it('绝对 URL 与 /api/ 路径原样直通', () => {
    expect(assetUrl('https://cos.example.com/x.jpg')).toBe('https://cos.example.com/x.jpg');
    expect(assetUrl('/api/uploads/x.jpg')).toBe('/api/uploads/x.jpg');
  });
});
