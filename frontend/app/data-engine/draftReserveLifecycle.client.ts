'use client';

import type { DataEngine } from './engine';

export function watchDraftReserves(engine: Pick<DataEngine, 'preserveDraftReserves' | 'flushServiceOrderInputs' | 'flushGroupMeetingEdits'>): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const preserve = () => {
    engine.preserveDraftReserves();
    engine.flushServiceOrderInputs();
    engine.flushGroupMeetingEdits();
  };
  window.addEventListener('pagehide', preserve);
  return () => window.removeEventListener('pagehide', preserve);
}
