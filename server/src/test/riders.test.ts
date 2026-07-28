import { describe, expect, it } from 'vitest';
import { buildRealPersonRider } from '../lib/riders';

describe('buildRealPersonRider', () => {
  it('uses the grabbing user\'s own name and id, not a random fictional rider', () => {
    const rider = buildRealPersonRider({ sub: 'user-1', username: '小明' });
    expect(rider.id).toBe('user-1');
    expect(rider.name).toBe('小明');
  });

  it('is deterministic for the same user (same emojis every call)', () => {
    const a = buildRealPersonRider({ sub: 'user-42', username: 'Alice' });
    const b = buildRealPersonRider({ sub: 'user-42', username: 'Alice' });
    expect(a).toEqual(b);
  });

  it('gives a perfect rating and a real-person placeholder delivery count', () => {
    const rider = buildRealPersonRider({ sub: 'user-1', username: '小明' });
    expect(rider.rating).toBe(5.0);
    expect(rider.deliveryCount).toBe('真人骑手');
  });

  it('picks non-empty avatar and vehicle emojis', () => {
    const rider = buildRealPersonRider({ sub: 'user-7', username: '小红' });
    expect(rider.avatarEmoji.length).toBeGreaterThan(0);
    expect(rider.vehicleEmoji.length).toBeGreaterThan(0);
  });
});
