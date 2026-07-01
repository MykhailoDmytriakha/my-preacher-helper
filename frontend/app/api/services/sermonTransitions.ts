/**
 * Sermon Narration Transitions — weaving logic (pure).
 *
 * The audio export used to concatenate body chunks with no audible structure, so
 * a listener could not tell where the introduction, main points or conclusion
 * began. Transitions fix that by inserting short generated chunks between the
 * sermon's parts:
 *
 *   [intro] → [part 0 body] → [bridge] → [part 1 body] → … → [outro]
 *
 * The intro announces the sermon; each bridge announces the next part; the outro
 * closes. A transition is just an AudioChunk with `kind: 'transition'`, so it
 * needs no special handling downstream — the preview renders it distinctly and
 * TTS voices its `.text` like any other chunk.
 *
 * `weaveTransitionChunks` is intentionally pure: its output is exactly the ordered
 * chunk list (and therefore the exact text, in order) that reaches the TTS engine.
 */

import type { AudioChunk, SermonSection } from '@/types/audioGeneration.types';

/** One narratable part of the sermon (a section, an outline point, or a sub-point). */
export interface TransitionSegment {
    /** Stable id (outline point id, sub-point id, or a section-derived id). */
    id: string;
    section: SermonSection;
    /** Human-readable title used to phrase the spoken lead-in. */
    title: string;
    /** Hierarchy level — sub-points get a lighter, shorter lead-in. */
    level?: 'point' | 'subpoint';
}

/** The body chunks produced for a single segment, before transitions are woven in. */
export interface SegmentBody {
    id: string;
    section: SermonSection;
    bodyChunks: AudioChunk[];
}

/** Generated connective text. `bridges` is keyed by segment id (lead-in INTO that segment). */
export interface SermonTransitions {
    intro: string;
    outro: string;
    bridges: Record<string, string>;
}

/** Controls whether the global opening/closing are emitted (off for partial re-optimize). */
export interface WeaveOptions {
    includeIntro: boolean;
    includeOutro: boolean;
}

export const EMPTY_TRANSITIONS: SermonTransitions = { intro: '', outro: '', bridges: {} };

function transitionChunk(
    text: string,
    section: SermonSection,
    role: 'intro' | 'bridge' | 'outro',
    now: string
): AudioChunk {
    // `index` is a placeholder — the caller re-indexes the full list 0-based after merging.
    return { text, sectionId: section, createdAt: now, index: 0, kind: 'transition', role };
}

/**
 * Weaves generated transition chunks into ordered per-segment body chunks.
 *
 * Order: optional intro → for each non-empty segment [bridge (skipped for the first,
 * which the intro already opens) → body chunks] → optional outro. Segments with no
 * body are dropped so we never announce an empty part.
 */
export function weaveTransitionChunks(
    segmentBodies: SegmentBody[],
    transitions: SermonTransitions,
    now: string,
    opts: WeaveOptions = { includeIntro: true, includeOutro: true }
): AudioChunk[] {
    const nonEmpty = segmentBodies.filter(s => s.bodyChunks.length > 0);
    if (nonEmpty.length === 0) return [];

    const out: AudioChunk[] = [];
    const first = nonEmpty[0];
    const last = nonEmpty[nonEmpty.length - 1];

    const intro = transitions.intro?.trim();
    if (opts.includeIntro && intro) {
        out.push(transitionChunk(intro, first.section, 'intro', now));
    }

    nonEmpty.forEach((seg, i) => {
        // The first segment is opened by the intro (or nothing); every later segment
        // gets its own spoken bridge so the listener hears the part change.
        if (i > 0) {
            const bridge = transitions.bridges[seg.id]?.trim();
            if (bridge) out.push(transitionChunk(bridge, seg.section, 'bridge', now));
        }
        for (const chunk of seg.bodyChunks) {
            out.push({ ...chunk, kind: 'body' });
        }
    });

    const outro = transitions.outro?.trim();
    if (opts.includeOutro && outro) {
        out.push(transitionChunk(outro, last.section, 'outro', now));
    }

    return out;
}
