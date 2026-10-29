'use client';

import { useEffect, useRef } from 'react';

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'wheel'] as const;
const LAST_ACTIVITY_KEY = 'lastActivityAt';
const CROSS_TAB_THROTTLE_MS = 5000;

/**
 * Logs the user out after `timeoutMs` of no interaction. Activity is
 * synced across tabs via localStorage so switching tabs doesn't trigger
 * a spurious timeout while the user is active elsewhere.
 */
export function useIdleTimeout(timeoutMs: number, onIdle: () => void, enabled: boolean = true) {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout>;
    let lastBroadcast = 0;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => onIdleRef.current(), timeoutMs);
    };

    const recordActivity = () => {
      resetTimer();
      const now = Date.now();
      if (now - lastBroadcast > CROSS_TAB_THROTTLE_MS) {
        lastBroadcast = now;
        localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === LAST_ACTIVITY_KEY) {
        resetTimer();
      }
    };

    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, recordActivity, { passive: true }));
    window.addEventListener('storage', handleStorage);
    resetTimer();

    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, recordActivity));
      window.removeEventListener('storage', handleStorage);
    };
  }, [timeoutMs, enabled]);
}
