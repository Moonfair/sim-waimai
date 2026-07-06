import { useCallback, useEffect, useRef } from 'react';

const INITIAL_DELAY = 450;
const START_INTERVAL = 300;
const MIN_INTERVAL = 60;
const ACCELERATION = 0.85;

/**
 * Repeatedly invokes `onStep` while the user holds down a pointer, starting
 * slow and accelerating. `onStep` should return `false` to stop the repeat
 * early (e.g. a counter hit its floor).
 */
export function useLongPressStep(onStep: () => boolean) {
  const timeoutRef = useRef<number | undefined>(undefined);
  const intervalDelayRef = useRef(START_INTERVAL);
  const firedRef = useRef(false);
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  const clear = useCallback(() => {
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = undefined;
    intervalDelayRef.current = START_INTERVAL;
  }, []);

  const scheduleNext = useCallback(() => {
    timeoutRef.current = window.setTimeout(() => {
      firedRef.current = true;
      const shouldContinue = onStepRef.current();
      if (!shouldContinue) {
        clear();
        return;
      }
      intervalDelayRef.current = Math.max(MIN_INTERVAL, intervalDelayRef.current * ACCELERATION);
      scheduleNext();
    }, intervalDelayRef.current);
  }, [clear]);

  const start = useCallback(() => {
    clear();
    firedRef.current = false;
    intervalDelayRef.current = START_INTERVAL;
    timeoutRef.current = window.setTimeout(() => {
      firedRef.current = true;
      const shouldContinue = onStepRef.current();
      if (shouldContinue) scheduleNext();
    }, INITIAL_DELAY);
  }, [clear, scheduleNext]);

  useEffect(() => clear, [clear]);

  const wrapClick = useCallback((handler: () => void) => () => {
    if (firedRef.current) {
      firedRef.current = false;
      return;
    }
    handler();
  }, []);

  return {
    handlers: {
      onPointerDown: start,
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
    },
    wrapClick,
  };
}
