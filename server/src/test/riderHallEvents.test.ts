import { describe, expect, it, vi } from 'vitest';
import { emitHallChanged, subscribeHallChanged } from '../lib/riderHallEvents';

describe('riderHallEvents', () => {
  it('calls a subscribed listener when the hall changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeHallChanged(listener);
    emitHallChanged();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('stops calling a listener after it unsubscribes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeHallChanged(listener);
    unsubscribe();
    emitHallChanged();
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies multiple independent subscribers', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeHallChanged(a);
    const unsubB = subscribeHallChanged(b);
    emitHallChanged();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    unsubA();
    unsubB();
  });
});
