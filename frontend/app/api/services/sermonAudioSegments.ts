/**
 * Sermon → narratable segments.
 *
 * Flattens the hierarchical sermon structure (section → outline point → sub-point)
 * into an ordered list of segments. Each segment is a unit that gets its own spoken
 * bridge in the audio export, so sub-points are split out into their own segments —
 * that's what makes sub-point transitions audible.
 *
 * Extracted from the optimize route so the split logic (what becomes a narratable
 * part, in what order) is unit-testable in isolation.
 */

import {
    SectionKey,
    SECTION_CONFIG,
    getSectionOutlinePoints,
    getSectionThoughtsInVisualOrder,
} from '@/api/services/sermonTextService';

import type { Sermon, Thought } from '@/models/models';

/**
 * A narratable unit of the sermon.
 * - `point`        — an outline point (or a whole section): gets a real spoken lead-in
 * - `subpoint`     — a sub-point: gets a lighter, shorter lead-in
 * - `continuation` — the point's own thoughts resuming AFTER a sub-point; no lead-in
 *   (it's the same point continuing, so re-announcing it would be wrong)
 */
export interface GenerationSegment {
    id: string;
    section: SectionKey;
    title: string;
    thoughts: Thought[];
    level: 'point' | 'subpoint' | 'continuation';
}

/**
 * Builds the ordered segment list for the given sections.
 *
 * Segments are contiguous runs of the section's VISUAL-ORDER thoughts, cut whenever the
 * (point, sub-point) ownership changes. Building from the visual order (not by bucketing)
 * guarantees the audio plays in the exact same order as the Structure page — a direct
 * thought, then a sub-point's thoughts, then more direct thoughts stays in that order.
 *
 * The first run of a point is a `point` (announced); a sub-point's run is a `subpoint`
 * (announced lightly); a point's direct thoughts resuming after a sub-point are a
 * `continuation` (not announced). A `subPointId` not matching any of the point's
 * sub-points is treated as direct. Empty runs never occur here; empty segments are
 * dropped later when they produce no body chunks.
 */
export function buildGenerationSegments(
    sermon: Sermon,
    sectionsToProcess: SectionKey[]
): GenerationSegment[] {
    const segments: GenerationSegment[] = [];

    for (const sectionKey of sectionsToProcess) {
        const config = SECTION_CONFIG[sectionKey];
        const outlinePoints = getSectionOutlinePoints(sermon, sectionKey);
        const allThoughts = getSectionThoughtsInVisualOrder(sermon, sectionKey);

        if (outlinePoints.length === 0) {
            // No outline points: the whole section is one segment.
            if (allThoughts.length > 0) {
                segments.push({ id: sectionKey, section: sectionKey, title: config.title, thoughts: allThoughts, level: 'point' });
            }
            continue;
        }

        const pointById = new Map(outlinePoints.map(p => [p.id, p]));
        const subPointById = new Map<string, { id: string; text: string }>();
        const validSubIdsByPoint = new Map<string, Set<string>>();
        for (const p of outlinePoints) {
            const ids = new Set<string>();
            for (const sp of p.subPoints ?? []) { subPointById.set(sp.id, sp); ids.add(sp.id); }
            validSubIdsByPoint.set(p.id, ids);
        }

        // Walk the visual-order thoughts that belong to a point, cutting a new segment on
        // every (point, sub-point) change. This preserves visual order by construction.
        const seenPoint = new Set<string>();
        let contCounter = 0;
        let currentKey: string | null = null;
        let current: GenerationSegment | null = null;
        const flush = () => { if (current) { segments.push(current); current = null; } };

        for (const t of allThoughts) {
            const pid = t.outlinePointId;
            if (!pid || !pointById.has(pid)) continue; // orphans handled below

            const validSubs = validSubIdsByPoint.get(pid);
            const sub = t.subPointId && validSubs?.has(t.subPointId) ? t.subPointId : null;
            const key = `${pid}|${sub ?? ''}`;

            if (key !== currentKey) {
                flush();
                currentKey = key;
                if (sub) {
                    current = { id: sub, section: sectionKey, title: subPointById.get(sub)?.text ?? '', thoughts: [], level: 'subpoint' };
                } else if (!seenPoint.has(pid)) {
                    current = { id: pid, section: sectionKey, title: pointById.get(pid)?.text ?? '', thoughts: [], level: 'point' };
                } else {
                    // Direct thoughts resuming after a sub-point: continue the point, don't re-announce.
                    current = { id: `${pid}#cont${contCounter++}`, section: sectionKey, title: pointById.get(pid)?.text ?? '', thoughts: [], level: 'continuation' };
                }
                seenPoint.add(pid);
            }
            current!.thoughts.push(t);
        }
        flush();

        // Thoughts in this section not assigned to any (known) point.
        const orphaned = allThoughts.filter(t => !t.outlinePointId || !pointById.has(t.outlinePointId));
        if (orphaned.length > 0) {
            segments.push({ id: `${sectionKey}-orphans`, section: sectionKey, title: `${config.title} (Additional)`, thoughts: orphaned, level: 'point' });
        }
    }

    return segments;
}
