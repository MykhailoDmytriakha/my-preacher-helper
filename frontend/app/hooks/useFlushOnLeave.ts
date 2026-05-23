'use client';

import { useEffect, useRef } from 'react';

export function useFlushOnLeave(flushSave: () => Promise<void>, isDirty: boolean): void {
  const flushSaveRef = useRef(flushSave);
  const isDirtyRef = useRef(isDirty);

  flushSaveRef.current = flushSave;
  isDirtyRef.current = isDirty;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const flushCurrentSave = () => {
      try {
        void flushSaveRef.current().catch(() => undefined);
      } catch {
        // Best-effort lifecycle flush: page teardown should not throw.
      }
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;

      event.preventDefault();
      event.returnValue = '';
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isDirtyRef.current) {
        flushCurrentSave();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (isDirtyRef.current) {
        flushCurrentSave();
      }
    };
  }, []);
}
