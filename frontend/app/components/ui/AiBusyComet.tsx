'use client';

import React from 'react';

/**
 * The "AI is working" indicator: a comet of sparks circling the control that started the
 * request. It is one component on purpose — the busy state is one idea, and three hand-made
 * copies of it drift apart the moment anyone tunes the timing.
 *
 * The lap is EASED, not linear, and that is the whole character. At a constant speed the
 * gap between the trail stars can never change, so the tail is locked in formation like
 * carriages behind an engine; easing makes the head pull away through the fast part of the
 * circle and lets the tail close on it where the motion slows.
 *
 * The parent must be `relative` and must NOT clip its overflow: the comet orbits outside
 * the control's box.
 */

/** Head first, then the fading tail. Negative delays place the stars along the same lap. */
const TRAIL = [
    { delay: '0s', opacity: 1, size: 9 },
    { delay: '-0.096s', opacity: 0.55, size: 8 },
    { delay: '-0.192s', opacity: 0.3, size: 7 },
    { delay: '-0.288s', opacity: 0.15, size: 6 },
] as const;

interface AiBusyCometProps {
    /**
     * Orbit radius as a Tailwind inset. Bigger controls need the ring pushed further out so
     * the sparks clear the edge instead of grazing it.
     */
    inset?: string;
}

export function AiBusyComet({ inset = '-inset-[7px]' }: AiBusyCometProps) {
    return (
        <>
            {TRAIL.map((star) => (
                <span
                    key={star.delay}
                    aria-hidden="true"
                    className={`pointer-events-none absolute ${inset} animate-ai-orbit text-violet-500 motion-reduce:hidden dark:text-violet-400`}
                    style={{ animationDelay: star.delay }}
                >
                    <span
                        className="absolute -top-0.5 left-1/2 -translate-x-1/2 leading-none"
                        style={{ opacity: star.opacity, fontSize: `${star.size}px` }}
                    >
                        ✦
                    </span>
                </span>
            ))}
        </>
    );
}

export default AiBusyComet;
