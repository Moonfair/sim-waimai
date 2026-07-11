import { describe, expect, it } from 'vitest';
import { cosPublicBase } from '../lib/cos';
import { isAllowedImageUrl } from '../lib/imageUrl';

describe('isAllowedImageUrl', () => {
  it('allows our own local uploads path', () => {
    expect(isAllowedImageUrl('/api/uploads/local/uploads/u-x/items/abc.png')).toBe(true);
  });

  it('rejects arbitrary third-party urls', () => {
    expect(isAllowedImageUrl('https://evil.example.com/pixel.png')).toBe(false);
  });

  it('rejects non-image schemes', () => {
    expect(isAllowedImageUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedImageUrl('data:image/png;base64,AAAA')).toBe(false);
  });

  it('rejects empty and lookalike prefixes', () => {
    expect(isAllowedImageUrl('')).toBe(false);
    // must not be fooled by an attacker host that merely starts with the string
    expect(isAllowedImageUrl('https://api.uploads.evil.com/x.png')).toBe(false);
  });

  const base = cosPublicBase();
  it.runIf(base)('allows the configured COS public base', () => {
    expect(isAllowedImageUrl(`${base}/uploads/reviews/u-x/abc.jpg`)).toBe(true);
    expect(isAllowedImageUrl(`${base}.attacker.com/x.png`)).toBe(false);
  });
});
