import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();
emitter.setMaxListeners(0); // unbounded: one listener per open SSE connection

/** Fires whenever a real-person order enters or leaves 抢单大厅. Carries no payload —
 *  subscribers are expected to refetch the authoritative list from the API. */
export function emitHallChanged(): void {
  emitter.emit('changed');
}

/** Returns an unsubscribe function. */
export function subscribeHallChanged(fn: () => void): () => void {
  emitter.on('changed', fn);
  return () => emitter.off('changed', fn);
}
