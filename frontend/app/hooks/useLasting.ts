'use client';

import { useEffect, useState } from 'react';

/** How long a state must last before the page says it: a copy unconfirmed, a check failing, no connection. */
export const STATUS_SETTLE_MS = 10_000;

/**
 * THE PAGE DOES NOT JUMP ON A BACKGROUND CHECK. Measured live on a council 2026-09-27: after two
 * quiet minutes the engine asks the server every ~16 s, and each ask put "Checking for updates…"
 * under "Saved." for a tenth of a second — everything below moved 20 px down and back, and the
 * owner, only reading, saw the page jump. A routine check is not news; a copy that stays unconfirmed
 * or a check that keeps failing is, so those are said once they have lasted.
 */
export function useLasting(active: boolean, atOnce = false): boolean {
  const [lasted, setLasted] = useState(false);
  useEffect(() => {
    if (!active) { setLasted(false); return; }
    // Something certain says it now (the phone itself: no network); said once, it stays said while
    // the state lasts — it does not go quiet and come back when the certainty is gone.
    if (atOnce) { setLasted(true); return; }
    const timer = setTimeout(() => setLasted(true), STATUS_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [active, atOnce]);
  return active && (lasted || atOnce);
}
