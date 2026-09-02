'use client';

import { useEffect, useState } from 'react';

/** Scrolled past this before anything is allowed to collapse. */
const ENGAGE_AFTER = 90;
/** Downward movement that counts as "reading on", not a stray pixel. */
const COLLAPSE_DELTA = 4;
/** Upward movement that counts as "I want the controls back". */
const REVEAL_DELTA = 26;

/**
 * True while the reader is moving down the page and the controls should fold away.
 *
 * On a phone the note's action row and its title stack into two sticky bands, together
 * about a quarter of the screen — permanently, on the one screen whose whole job is to
 * show text. The row is only needed between readings, so it leaves while reading and
 * comes back on the first deliberate move upward.
 *
 * The two thresholds are not symmetric on purpose: a bar that reappears on every stray
 * pixel of upward scroll is worse than a bar that never moved, so coming back demands a
 * real gesture while leaving does not.
 */
export function useCollapseOnScroll(enabled: boolean, resetKey?: string): boolean {
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        if (!enabled || typeof window === 'undefined') {
            setCollapsed(false);
            return;
        }

        let last = window.scrollY;
        let frame = 0;
        // The decision is made HERE, not inside a state updater: React runs updaters when
        // it renders, by which time `last` has already been advanced to the current
        // position and every comparison against it is a comparison with itself.
        let isCollapsed = false;

        const measure = () => {
            frame = 0;
            const y = window.scrollY;
            const next = isCollapsed
                ? // Back at the top, or a deliberate move upward.
                  !(y < ENGAGE_AFTER / 2 || y < last - REVEAL_DELTA)
                : y > ENGAGE_AFTER && y > last + COLLAPSE_DELTA;
            last = y;
            if (next !== isCollapsed) {
                isCollapsed = next;
                setCollapsed(next);
            }
        };

        const onScroll = () => {
            if (frame) return;
            frame = window.requestAnimationFrame(measure);
        };

        // The starting value is read from the position itself, not measured against the
        // previous one — on the first pass they are the same number, so every comparison
        // is a comparison with itself. This also settles two cases that fire no scroll
        // event at all: a restored position deep in a note, and moving to another note,
        // which re-runs this effect through `resetKey`.
        isCollapsed = last > ENGAGE_AFTER;
        setCollapsed(isCollapsed);

        window.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            if (frame) window.cancelAnimationFrame(frame);
            window.removeEventListener('scroll', onScroll);
        };
    }, [enabled, resetKey]);

    return collapsed;
}
