'use client';

import { useMediaQuery } from '@/hooks/useMediaQuery';

/** Tailwind's `lg` breakpoint — where the note page has room for a side panel. */
const WIDE_QUERY = '(min-width: 1024px)';
/** Tailwind's `sm` breakpoint — below it the note's action bar needs its own two rows. */
const ROOMY_HEADER_QUERY = '(min-width: 640px)';

/**
 * True when the viewport is wide enough for the note's side panel.
 *
 * Why JS and not just a CSS breakpoint: the panel and the narrow layout must not both
 * render the note's metadata blocks — those carry inputs and pickers, and two live
 * copies would mean two of each. The flag picks ONE place to mount them.
 *
 * Starts `true` so it matches what the server rendered; a narrow client corrects it on
 * the first effect.
 */
export function useWideViewport(): boolean {
    return useMediaQuery(WIDE_QUERY);
}

/**
 * True when the action bar can lay out on one row with the title centred over it.
 *
 * Below it the same controls need two rows, and the second row is the one that stays
 * while reading — so which layout is mounted is a decision, not a set of hidden copies.
 */
export function useRoomyHeader(): boolean {
    return useMediaQuery(ROOMY_HEADER_QUERY);
}
