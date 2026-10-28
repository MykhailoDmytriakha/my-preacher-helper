'use client';

import { useMemo, useRef } from 'react';

/**
 * THE ADDRESS'S WAY IN, TAKEN ONCE. A section, a step or an entry the address names is brought into sight on arrival —
 * and never again when the page's data changes under it (BUG-20261027-plan-scrolls-back-to-section: after «Сохранить»,
 * or the sermon coming again from the server, the plan went back to «Вступление»). The effect that scrolls asks
 * `isTaken(key)` first and calls `take(key)` once it has brought the place into sight; a new key — another section,
 * another page — is a new arrival, and so is the same one coming back after the address let it go: the effect calls
 * `release()` when the address names none (Codex review, 2026-10-27: Back to the same section did not scroll). Hold it
 * above anything that mounts the screen anew — the plan's copy giving way to its editor is not a new arrival.
 */
export type WayIn = ReturnType<typeof useWayInOnce>;

export function useWayInOnce() {
  const taken = useRef<string | null>(null);
  return useMemo(() => ({
    /**
     * Whether the way in the address names now (`key`; null — none) is still to be taken. Naming another, or none, lets
     * the last one go: to Main and back to Introduction before Main's scroll came is a new arrival at Introduction
     * (Codex review, 2026-10-27).
     */
    arriving: (key: string | null): boolean => {
      if (taken.current !== key) taken.current = null;
      return key !== null && taken.current !== key;
    },
    isTaken: (key: string) => taken.current === key,
    take: (key: string) => { taken.current = key; },
  }), []);
}
