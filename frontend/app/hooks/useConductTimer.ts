'use client';

import { useEffect, useState } from 'react';

/**
 * Timer hook for conduct mode.
 * - isPaused: external, managed by page (shared between global and block timers)
 * - initialElapsed: restored value when returning to a block after overview peek
 * - Reset on new block is handled by remounting with key={flowItem.id}
 */
export function useConductTimer(
  durationMin: number | null | undefined,
  isPaused = false,
  initialElapsed = 0
) {
  const [elapsed, setElapsed] = useState(initialElapsed);

  useEffect(() => {
    if (isPaused) return;
    const id = setInterval(() => setElapsed((p) => p + 1), 1000);
    return () => clearInterval(id);
  }, [isPaused]);

  const durationSec = durationMin ? durationMin * 60 : null;
  const timeLeft = durationSec !== null ? durationSec - elapsed : null;
  const isOvertime = timeLeft !== null && timeLeft < 0;
  const isWarning = timeLeft !== null && timeLeft >= 0 && timeLeft <= 60;

  return { elapsed, timeLeft, isOvertime, isWarning };
}

export function formatTime(totalSeconds: number): string {
  const abs = Math.abs(totalSeconds);
  const m = Math.floor(abs / 60).toString().padStart(2, '0');
  const s = (abs % 60).toString().padStart(2, '0');
  return totalSeconds < 0 ? `-${m}:${s}` : `${m}:${s}`;
}
