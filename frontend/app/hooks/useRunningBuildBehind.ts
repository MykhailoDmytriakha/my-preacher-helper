'use client';

import { useEffect, useRef, useState } from 'react';

import { recordDiagnostic } from '@/utils/appDiagnostics';
import { getConnectivityStatus, subscribeToConnectivity } from '@/utils/connectivity';
import { isRunningBuildBehind } from '@/utils/runningBuild';

/**
 * WHILE A REFUSAL IS SHOWN: IS THIS TAB OLDER THAN THE SERVER? (BUG-20261107-outdated-tab-refusal-unexplained)
 *
 * Asked only while `active` (a server refusal is on screen) — a conflict or a calm screen never asks.
 * Every answer replaces the last one: a server rolled back to this tab's build makes a later refusal
 * an ordinary one again. Leaving the refusal forgets the answer, so the next refusal asks afresh and
 * never shows the old verdict for a frame.
 *
 * A check that could not be answered is asked again when the app's own connection answer comes back
 * (`utils/connectivity` — a recovered server is not always a browser `online` event) or the page comes
 * back into view. A reason to ask that arrives while a check is under way is kept and asked once that
 * check settles without a verdict: sharing the pending request alone would let its failure answer for
 * the recovery too (Codex review, 07.11). Concurrent consumers still share one request (`isRunningBuildBehind`).
 */
export function useRunningBuildBehind(active: boolean): boolean {
  const [behind, setBehind] = useState(false);
  const said = useRef(false);
  useEffect(() => {
    if (!active) return;
    let current = true;
    let checking = false;
    let askAgain = false;
    const ask = () => {
      if (checking) { askAgain = true; return; }
      checking = true;
      void isRunningBuildBehind().then(answer => {
        checking = false;
        if (!current) return;
        setBehind(answer);
        // What the person was shown goes into the technical report's path (owner, 2026-10-10), once per refusal.
        if (answer && !said.current) recordDiagnostic('sync-trouble', { code: 'outdated-build' });
        said.current = answer;
        const again = askAgain;
        askAgain = false;
        if (again && !answer) ask();
      });
    };
    const onConnection = () => { if (getConnectivityStatus()) ask(); };
    const onVisible = () => { if (document.visibilityState === 'visible') ask(); };
    ask();
    const stopListening = subscribeToConnectivity(onConnection);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      current = false;
      stopListening();
      document.removeEventListener('visibilitychange', onVisible);
      said.current = false;
      setBehind(false);
    };
  }, [active]);
  return active && behind;
}
