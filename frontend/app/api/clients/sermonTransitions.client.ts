/**
 * Sermon Narration Transitions Client
 *
 * Generates the spoken connective tissue (opening, per-part lead-ins, closing)
 * that makes the audio export's structure audible. Uses the same structured-output
 * pipeline as thought/sermon processing (`callWithStructuredOutput`), so it runs on
 * whichever provider the default structured workload resolves.
 *
 * Transitions are ADDITIVE: if generation fails (network, refusal, bad JSON) we
 * return empty transitions and log a warning, so the core audio export still works.
 */

import { EMPTY_TRANSITIONS } from '@/api/services/sermonTransitions';
import { SermonTransitionsResponseSchema } from "@/config/schemas/zod";

import { callWithStructuredOutput } from "./structuredOutput";

import type { SermonTransitions, TransitionSegment } from '@/api/services/sermonTransitions';
import type { Sermon } from '@/models/models';

const SYSTEM_PROMPT = `You are the preacher himself, speaking aloud. You are recording the audio version of your own sermon and you voice the short living words that connect its parts — so a listener who cannot see the outline still feels where they are.

Produce three things:
1. "intro": a warm spoken opening (1-3 sentences). Greet the listener and name the sermon — ALWAYS set the title off clearly, wrapped in quotation marks («…»), so it reads as a distinct name and never runs into the sentence (e.g. «размышляем над проповедью «Божий человек»», not «над темой Божий человек»). Add its main scripture if given, and draw them into the message the way you would actually begin from the pulpit.
2. "bridges": one spoken lead-in per part, IN THE SAME ORDER as the parts listed. It carries the listener from what came before into this part, weaving in the part's idea.
3. "outro": a short spoken closing (1-2 sentences) — a benediction-like ending.

Make it sound HUMAN, like a real preacher, not a table of contents:
- Speak as a living voice: warm, reverent, pastoral, first-person ("давайте", "обратимся", "посмотрим вместе"). It must feel spoken, not read.
- VARY every lead-in. Do NOT start them the same way and do NOT enumerate mechanically ("Пункт первый", "Первое", "Второе", "Point 2"). Never say the words point / sub-point / section / part / transition.
- Do NOT quote the title as a label. Take its MEANING and phrase a natural, flowing sentence around it.
- LEVEL matters: a part marked (point) gets a real lead-in (1-2 sentences). A part marked (sub) is a smaller step INSIDE the current thought — keep it very light and short (a soft connective phrase, sometimes just a few words like "И вот что важно здесь…"), never a full new announcement.
- Plain spoken text only: no markdown, no headings, no bullets, no surrounding quotation marks.
- Write in the SAME LANGUAGE as the sermon's titles.
- bridges MUST have exactly one entry per part, in the given order.`;

function buildPrompt(sermon: Sermon, segments: TransitionSegment[]): string {
    const lines: string[] = [];
    lines.push(`Sermon title: "${sermon.title || 'Untitled'}"`);
    if (sermon.verse) lines.push(`Main scripture: ${sermon.verse}`);
    lines.push('');
    lines.push('Parts of the sermon, in narration order (write one bridge per part, in this order).');
    lines.push('Each part is marked (point) for a main part or (sub) for a lighter sub-step:');
    segments.forEach((seg, i) => {
        const mark = seg.level === 'subpoint' ? '(sub)' : '(point)';
        lines.push(`${i + 1}. ${mark} ${seg.title}`);
    });
    lines.push('');
    lines.push('Return the intro, the bridges array (one per part, same order), and the outro.');
    return lines.join('\n');
}

/**
 * Generates narration transitions for the given ordered sermon parts.
 * Never throws: on any failure returns EMPTY_TRANSITIONS so audio export continues.
 */
export async function generateSermonTransitions(
    sermon: Sermon,
    segments: TransitionSegment[],
    userId: string = sermon.userId
): Promise<SermonTransitions> {
    if (segments.length === 0) return EMPTY_TRANSITIONS;

    try {
        const result = await callWithStructuredOutput(
            SYSTEM_PROMPT,
            buildPrompt(sermon, segments),
            SermonTransitionsResponseSchema,
            {
                formatName: "sermon_transitions",
                userId,
                promptName: "sermon_transitions",
                promptVersion: "v1",
                logContext: {
                    sermonTitle: sermon.title,
                    partsCount: segments.length,
                },
            }
        );

        if (!result.success || !result.data) {
            console.warn('[Transitions] generation returned no data; continuing without transitions', {
                refusal: result.refusal,
                error: result.error?.message,
            });
            return EMPTY_TRANSITIONS;
        }

        const { intro, bridges, outro } = result.data;

        // bridges are index-aligned to `segments`; key them by segment id for weaving.
        const bridgeMap: Record<string, string> = {};
        segments.forEach((seg, i) => {
            const text = bridges[i];
            if (typeof text === 'string' && text.trim()) bridgeMap[seg.id] = text.trim();
        });

        return {
            intro: (intro || '').trim(),
            outro: (outro || '').trim(),
            bridges: bridgeMap,
        };
    } catch (error) {
        console.warn('[Transitions] generation failed; continuing without transitions', error);
        return EMPTY_TRANSITIONS;
    }
}
