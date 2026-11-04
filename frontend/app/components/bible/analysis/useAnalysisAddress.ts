'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

import { closeOnBrowserMove, historyStepHere } from '@/utils/historyStep';

import { leaveAnalysisAddress, openAnalysisStep, readAnalysisAddress, writeAnalysisAddress } from './analysisAddress';

import type { AnalysisMode } from './AnalysisParts';
import type { AnalysisOpening } from './useAnalysisNote';

/**
 * THE ANALYSIS SCREEN IN THE PAGE'S ADDRESS AND HISTORY (`analysisAddress.ts`). Opened over the page — from Studies' list,
 * from the reader's text — it is one step in history: Back (the browser's button, a swipe) closes it as its own way back
 * does, and the page stands as it was (the owner, 03.11: «должно запоминать, откуда я пришел»). Arrived at by an address
 * (a link from a sermon, a reload) it stands on that entry, and Back leaves for where the person came from. While open the
 * address names its note in its mode — a new analysis once it has one — so a reload opens it again. Closed while the page
 * stays, it takes its step back. An analysis on no copy this device can reach (`gone`) closes the screen; one deleted
 * elsewhere with work still here stays, and the note's status asks what to keep.
 */
export function useAnalysisAddress({ opening, id, mode, gone, onGone, onBack }: {
  opening: AnalysisOpening;
  /** Its note, once it has one. */
  id: string | null;
  mode: AnalysisMode;
  /** No copy this device can reach holds its note any more. */
  gone: boolean;
  onGone: () => void;
  /** The screen's own way back — what Back does too. */
  onBack: () => void;
}) {
  const step = useRef<string | null | undefined>(undefined);
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Closed because the browser moved: the entry it moved to is the person's choice, not the screen's to change. */
  const movedOff = useRef(false);
  const current = useRef({ id, onBack });
  current.current = { id, onBack };

  // Before the address is written: the step is decided once. A remount in place (React's strict check runs effects twice)
  // keeps it, so the step is taken back only when the screen is really gone — a moment after, by then a navigation away
  // has moved the address off it and nothing is taken.
  useLayoutEffect(() => {
    clearTimeout(leaving.current);
    if (step.current === undefined) {
      const arrived = opening.kind === 'open' && readAnalysisAddress()?.id === opening.id;
      step.current = arrived ? historyStepHere() : openAnalysisStep(id ? { id, mode } : null);
    }
    return () => {
      leaving.current = setTimeout(() => { if (!movedOff.current) leaveAnalysisAddress(current.current.id, step.current ?? null); }, 0);
    };
    // The step is the opening's: decided at mount, as `opening` is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (id) writeAnalysisAddress({ id, mode }); }, [id, mode]);

  // Back, or any move off the entry the screen stands on, closes it.
  useEffect(() => {
    const moved = () => {
      if (readAnalysisAddress()?.id === (current.current.id ?? undefined) && historyStepHere() === step.current) return;
      movedOff.current = true;
      closeOnBrowserMove(current.current.onBack);
    };
    window.addEventListener('popstate', moved);
    return () => window.removeEventListener('popstate', moved);
  }, []);

  useEffect(() => { if (gone) onGone(); }, [gone, onGone]);
}
