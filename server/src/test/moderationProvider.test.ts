import { describe, expect, it } from 'vitest';
import { mergeVerdicts, type PartVerdict } from '../lib/moderationProvider';

const pass = (over: Partial<PartVerdict> = {}): PartVerdict => ({
  source: 'text',
  suggestion: 'Pass',
  label: 'Normal',
  score: 100,
  ...over,
});

describe('mergeVerdicts', () => {
  it('all Pass → approve', () => {
    const r = mergeVerdicts([pass(), pass({ source: 'image' })]);
    expect(r.verdict).toBe('approve');
    expect(r.confidence).toBe(1);
  });

  it('empty parts → approve with full confidence', () => {
    expect(mergeVerdicts([])).toEqual({ verdict: 'approve', reason: '未发现违规内容', confidence: 1 });
  });

  it('any Block → reject, reason names the hit (text keywords)', () => {
    const r = mergeVerdicts([
      pass(),
      { source: 'text', suggestion: 'Block', label: 'Porn', detail: '违规词A', score: 99 },
    ]);
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('文本命中「色情」：违规词A');
    expect(r.confidence).toBeCloseTo(0.99);
  });

  it('Block wins over Review regardless of order', () => {
    const r = mergeVerdicts([
      { source: 'image', suggestion: 'Review', label: 'Sexy', score: 60 },
      { source: 'image', suggestion: 'Block', label: 'Polity', score: 95 },
    ]);
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('图片命中「涉政」');
  });

  it('Review without Block → uncertain (manual queue)', () => {
    const r = mergeVerdicts([
      pass(),
      { source: 'image', suggestion: 'Review', label: 'Abuse', detail: 'Abuse-Dirty', score: 70 },
    ]);
    expect(r.verdict).toBe('uncertain');
    expect(r.reason).toBe('图片命中「辱骂」：Abuse-Dirty');
    expect(r.confidence).toBeCloseTo(0.7);
  });

  it('unknown label falls back to the raw label text', () => {
    const r = mergeVerdicts([{ source: 'text', suggestion: 'Block', label: 'Spam', score: 80 }]);
    expect(r.reason).toBe('文本命中「Spam」');
  });

  it('Pass with a non-Normal low-score label lowers approve confidence', () => {
    const r = mergeVerdicts([pass(), { source: 'text', suggestion: 'Pass', label: 'Sexy', score: 20 }]);
    expect(r.verdict).toBe('approve');
    expect(r.confidence).toBeCloseTo(0.8);
  });
});
