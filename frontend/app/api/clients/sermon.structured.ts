/**
 * Structured Output Functions for Sermon Analytics
 * 
 * This module contains refactored OpenAI API calls using the structured output pattern.
 * These functions replace the legacy XML-based parsing with Zod schemas for type safety
 * and automatic analytics logging.
 */

import {
    insightsSystemPrompt,
    createInsightsUserMessage,
    topicsSystemPrompt,
    createTopicsUserMessage,
    versesSystemPrompt,
    createVersesUserMessage,
    planSystemPrompt,
    createSectionHintsUserMessage,
    brainstormSystemPrompt,
    createBrainstormUserMessage,
} from "@/config/prompts";
import {
    InsightsResponseSchema,
    TopicsResponseSchema,
    VersesResponseSchema,
	SectionHintsResponseSchema,
	SermonPointsResponseSchema,
	ComposePlanResponseSchema,
	BrainstormSuggestionSchema,
	type ComposedPlanOutline,
	type ComposePlanResponse,
} from "@/config/schemas/zod";
import {
    Sermon,
    Insights,
    VerseWithRelevance,
    SermonPoint,
    BrainstormSuggestion,
    SectionHints,
    ScratchNote,
    SermonOutline,
    OutlinePoint,
    SubPoint,
} from "@/models/models";

import { extractSectionContent, extractSermonContent } from "./openAIHelpers";
import { buildPromptBlueprint, buildSimplePromptBlueprint } from "./promptBuilder";
import { callWithStructuredOutput } from "./structuredOutput";

import type { PlanContext, PlanStyle } from "./planTypes";

const isDebugMode = process.env.DEBUG_MODE === 'true';
type ComposeSectionKey = 'introduction' | 'main' | 'conclusion';

const COMPOSE_SECTION_KEYS: ComposeSectionKey[] = ['introduction', 'main', 'conclusion'];

/**
 * Compose-plan per-request deadline. Sits under the 60s Vercel function wall so a stalled
 * provider is aborted by us with a real error instead of the platform killing the whole
 * invocation with an empty 504. Measured healthy latency for this call is ~2s.
 */
const COMPOSE_PLAN_REQUEST_TIMEOUT_MS = 45_000;

// ===== Structured Output Functions =====

/**
 * Generate insights for a sermon using structured output
 * @param sermon The sermon to analyze
 * @returns Insights object or null on error
 */
export async function generateSermonInsightsStructured(
    sermon: Sermon,
    userId: string = sermon.userId
): Promise<Insights | null> {
    const sermonContent = extractSermonContent(sermon);
    const userMessage = createInsightsUserMessage(sermon, sermonContent);
    const promptBlueprint = buildSimplePromptBlueprint({
        promptName: "sermon.insights.all",
        promptVersion: "v1",
        systemPrompt: insightsSystemPrompt,
        userMessage,
        context: {
            sermonId: sermon.id,
            sermonTitle: sermon.title,
            contentLength: sermonContent.length,
        },
    });

    if (isDebugMode) {
        console.log("DEBUG: Generating insights for sermon (structured):", sermon.id);
    }

    const result = await callWithStructuredOutput(
        promptBlueprint.systemPrompt,
        promptBlueprint.userMessage,
        InsightsResponseSchema,
        {
            formatName: "sermon_insights",
            userId,
            promptBlueprint,
            logContext: {
                sermonId: sermon.id,
                sermonTitle: sermon.title,
                contentLength: sermonContent.length,
            },
        }
    );

    if (!result.success || !result.data) {
        console.error("ERROR: Failed to generate sermon insights:", result.error || result.refusal);
        return null;
    }

    return result.data;
}

/**
 * Generate topics for a sermon using structured output
 * @param sermon The sermon to analyze
 * @returns Array of topic strings
 */
export async function generateSermonTopicsStructured(
    sermon: Sermon,
    userId: string = sermon.userId
): Promise<string[]> {
    const sermonContent = extractSermonContent(sermon);
    const userMessage = createTopicsUserMessage(sermon, sermonContent);
    const promptBlueprint = buildSimplePromptBlueprint({
        promptName: "sermon.insights.topics",
        promptVersion: "v1",
        systemPrompt: topicsSystemPrompt,
        userMessage,
        context: {
            sermonId: sermon.id,
            sermonTitle: sermon.title,
            contentLength: sermonContent.length,
        },
    });

    if (isDebugMode) {
        console.log("DEBUG: Generating topics for sermon (structured):", sermon.id);
    }

    const result = await callWithStructuredOutput(
        promptBlueprint.systemPrompt,
        promptBlueprint.userMessage,
        TopicsResponseSchema,
        {
            formatName: "sermon_topics",
            userId,
            promptBlueprint,
            logContext: {
                sermonId: sermon.id,
                sermonTitle: sermon.title,
                contentLength: sermonContent.length,
            },
        }
    );

    if (!result.success || !result.data) {
        console.error("ERROR: Failed to generate sermon topics:", result.error || result.refusal);
        return [];
    }

    return result.data.topics || [];
}

/**
 * Generate Bible verse suggestions for a sermon using structured output
 * @param sermon The sermon to analyze
 * @returns Array of verse objects with reference and relevance
 */
export async function generateSermonVersesStructured(
    sermon: Sermon,
    userId: string = sermon.userId
): Promise<VerseWithRelevance[]> {
    const sermonContent = extractSermonContent(sermon);
    const userMessage = createVersesUserMessage(sermon, sermonContent);
    const promptBlueprint = buildSimplePromptBlueprint({
        promptName: "sermon.insights.verses",
        promptVersion: "v2",
        systemPrompt: versesSystemPrompt,
        userMessage,
        context: {
            sermonId: sermon.id,
            sermonTitle: sermon.title,
            contentLength: sermonContent.length,
        },
    });

    if (isDebugMode) {
        console.log("DEBUG: Generating verse suggestions for sermon (structured):", sermon.id);
    }

    const result = await callWithStructuredOutput(
        promptBlueprint.systemPrompt,
        promptBlueprint.userMessage,
        VersesResponseSchema,
        {
            formatName: "sermon_verses",
            userId,
            promptBlueprint,
            logContext: {
                sermonId: sermon.id,
                sermonTitle: sermon.title,
                contentLength: sermonContent.length,
            },
        }
    );

    if (!result.success || !result.data) {
        console.error("ERROR: Failed to generate sermon verses:", result.error || result.refusal);
        return [];
    }

    return result.data.verses || [];
}

/**
 * Generate section hints for organizing sermon thoughts using structured output
 * @param sermon The sermon to analyze
 * @returns SectionHints object or null on error
 */
export async function generateSectionHintsStructured(
    sermon: Sermon,
    userId: string = sermon.userId
): Promise<SectionHints | null> {
    const sermonContent = extractSermonContent(sermon);
    const userMessage = createSectionHintsUserMessage(sermon, sermonContent);
    const promptBlueprint = buildSimplePromptBlueprint({
        promptName: "sermon.insights.section_hints",
        promptVersion: "v1",
        systemPrompt: planSystemPrompt,
        userMessage,
        context: {
            sermonId: sermon.id,
            sermonTitle: sermon.title,
            contentLength: sermonContent.length,
        },
    });

    if (isDebugMode) {
        console.log("DEBUG: Generating section hints for sermon (structured):", sermon.id);
    }

    const result = await callWithStructuredOutput(
        promptBlueprint.systemPrompt,
        promptBlueprint.userMessage,
        SectionHintsResponseSchema,
        {
            formatName: "section_hints",
            userId,
            promptBlueprint,
            logContext: {
                sermonId: sermon.id,
                sermonTitle: sermon.title,
                contentLength: sermonContent.length,
            },
        }
    );

    if (!result.success || !result.data) {
        console.error("ERROR: Failed to generate section hints:", result.error || result.refusal);
        return null;
    }

    return result.data;
}

/**
 * Generate outline points for a sermon section using structured output
 * @param sermon The sermon to analyze
 * @param section The section to generate outline points for (introduction, main, conclusion)
 * @returns Array of generated outline points and success status
 */
export async function generateSermonPointsStructured(
    sermon: Sermon,
    section: string,
    userId: string = sermon.userId
): Promise<{ outlinePoints: SermonPoint[]; success: boolean }> {
    const sectionContent = extractSectionContent(sermon, section);
    const hasNonLatinChars = /[^\u0000-\u007F]/.test(sermon.title + sermon.verse);
    const detectedLanguage = hasNonLatinChars ? "non-English (likely Russian/Ukrainian)" : "English";

    if (isDebugMode) {
        console.log(`DEBUG: Detected sermon language: ${detectedLanguage}`);
        console.log(`DEBUG: Generating outline points for ${section} section (structured)`);
    }

    const systemPrompt = `You are a helpful assistant for sermon preparation.

Your task is to generate a list of outline points for the ${section} section of a sermon, based on the content provided.

IMPORTANT:
1. Always generate the outline points in the SAME LANGUAGE as the input. Do not translate.
2. Generate 3-5 clear, concise outline points that capture the key themes and ideas in the provided content.
3. Each outline point should be a short phrase, not a complete sentence (10 words or less is ideal).
4. The outline points should flow logically and build on each other.
5. For the introduction section, focus on points that introduce the sermon theme and capture attention.
6. For the main section, focus on the key theological points and arguments.
7. For the conclusion section, focus on application points and closing thoughts.
8. Maintain the theological perspective from the original content.`;

    const userMessage = `Please generate 3-5 outline points for the ${section.toUpperCase()} section of my sermon based on the following content:

SERMON TITLE: ${sermon.title}
SCRIPTURE: ${sermon.verse}

SECTION CONTENT:
${sectionContent}

Generate each outline point as a short, clear phrase (not a complete sentence). Make each point build logically on the previous ones.
Keep the outline points in the ${hasNonLatinChars ? 'same non-English' : 'English'} language as the input.`;
    const promptBlueprint = buildPromptBlueprint({
        promptName: "sermon.structure.focus.generate_outline",
        promptVersion: "v1",
        expectedLanguage: hasNonLatinChars ? "non-english" : "en",
        context: {
            sermonId: sermon.id,
            sermonTitle: sermon.title,
            section,
            contentLength: sectionContent.length,
            detectedLanguage,
        },
        systemBlocks: [
            {
                blockId: "sermon_points.role_task",
                category: "task",
                content: systemPrompt,
            },
        ],
        userBlocks: [
            {
                blockId: "sermon_points.request_context",
                category: "context",
                content: userMessage,
            },
        ],
    });

    const result = await callWithStructuredOutput(
        promptBlueprint.systemPrompt,
        promptBlueprint.userMessage,
        SermonPointsResponseSchema,
        {
            formatName: "sermon_points",
            userId,
            promptBlueprint,
            logContext: {
                sermonId: sermon.id,
                sermonTitle: sermon.title,
                section,
                contentLength: sectionContent.length,
                detectedLanguage,
            },
        }
    );

    if (!result.success || !result.data) {
        console.error(`ERROR: Failed to generate outline points for ${section} section:`, result.error || result.refusal);
        return { outlinePoints: [], success: false };
    }

    const outlinePoints: SermonPoint[] = result.data.outlinePoints.map((point) => ({
        id: `op-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        text: point.text,
    }));

    return { outlinePoints, success: true };
}

function scratchSectionLabel(section: ScratchNote['section']) {
    if (section === 'introduction') return 'introduction';
    if (section === 'main') return 'main';
    if (section === 'conclusion') return 'conclusion';
    return 'unplaced';
}

/**
 * Notes reach the model as SHORT KEYS (n1, n2, …), never as UUIDs.
 * Measured 2026-07-26: with `id=<uuid>` in a numbered list the model echoed the ORDINAL
 * ("20") instead of the UUID in 4 of 5 runs — 25 of 25 ids wrong — and the whole response
 * was discarded downstream. Short keys make that failure unreachable.
 */
function scratchNoteKey(index: number) {
    return `n${index + 1}`;
}

function outlinePointKey(index: number) {
    return `p${index + 1}`;
}

function scratchPromptLine(note: ScratchNote, index: number) {
    const pinned = note.section ? ` [pinned:${scratchSectionLabel(note.section)}]` : '';
    return `${scratchNoteKey(index)}: ${note.text.replace(/\s+/g, ' ').trim()}${pinned}`;
}

/**
 * Scratch notes are stored newest-first, so the sequence the preacher actually dictated
 * reached the model REVERSED (measured: first array element createdAt 22:30:52, last
 * 21:59:59). That order carries intent — notes routinely continue one another ("после
 * этого", "переходим к"). Sorted here by timestamp, with id as a stable tie-break.
 *
 * Honest naming: this is TIMESTAMP order, not proven dictation order — `createdAt` comes
 * from the browser clock, so notes written on two devices with skewed clocks can invert.
 */
function sortScratchByCapture(scratch: ScratchNote[]): ScratchNote[] {
    return [...scratch].sort((left, right) => {
        const byTime = (left.createdAt ?? '').localeCompare(right.createdAt ?? '');
        return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
    });
}

const LEADING_CONCLUSION_CUE_PATTERN = /^\s*(?:в\s+конце|в\s+заключение|заключение|призыв|завершение)(?=$|[\s—–:,.!?;])/iu;
const LEADING_INTRODUCTION_CUE_PATTERN = /^\s*(?:в\s+начале|сначала|вступление)(?=$|[\s—–:,.!?;])/iu;

function inferExplicitCueSection(text: string): ComposeSectionKey | null {
    const normalized = text.toLowerCase();

    if (LEADING_CONCLUSION_CUE_PATTERN.test(normalized)) {
        return 'conclusion';
    }

    if (LEADING_INTRODUCTION_CUE_PATTERN.test(normalized)) {
        return 'introduction';
    }

    return null;
}

function inferSectionFromCue(text: string): ComposeSectionKey {
    const explicitSection = inferExplicitCueSection(text);
    if (explicitSection) return explicitSection;
    return 'main';
}

function compactScratchText(text: string) {
    const compacted = text
        .replace(/^\s*(в начале|на початку|at the beginning)\s*[—:-]\s*/i, '')
        .replace(/^\s*(в конце|в кінці|at the end)\s*[—:-]\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    return compacted || text.trim();
}

function composePointId() {
    return `op-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

function composeSubPointId() {
    return `sp-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

function cloneSubPoint(subPoint: SubPoint) {
    return { ...subPoint };
}

function cloneOutlinePoint(point: OutlinePoint) {
    return {
        ...point,
        subPoints: point.subPoints?.map(cloneSubPoint),
    };
}

function normalizeExistingOutline(existingOutline?: SermonOutline): ComposedPlanOutline {
    return {
        introduction: (existingOutline?.introduction ?? []).map(cloneOutlinePoint),
        main: (existingOutline?.main ?? []).map(cloneOutlinePoint),
        conclusion: (existingOutline?.conclusion ?? []).map(cloneOutlinePoint),
    };
}

/**
 * Existing outline points also get short keys (p1, p2, …) so the model can target them
 * without ever seeing — or inventing — a real point id.
 */
function collectExistingPoints(existingOutline?: SermonOutline) {
    return COMPOSE_SECTION_KEYS.flatMap((section) =>
        (existingOutline?.[section] ?? []).map((point) => ({ section, point }))
    );
}

function existingOutlinePrompt(entries: Array<{ section: ComposeSectionKey; point: OutlinePoint }>) {
    if (entries.length === 0) return '(none)';

    return entries
        .map(({ section, point }, index) =>
            `${outlinePointKey(index)} [${section}]: ${point.text.replace(/\s+/g, ' ').trim()}`
        )
        .join('\n');
}

function findPointLocation(outline: ComposedPlanOutline, pointId: string) {
    for (const section of COMPOSE_SECTION_KEYS) {
        const point = outline[section].find((candidate) => candidate.id === pointId);
        if (point) return { section, point };
    }

    return null;
}

function nextSubPointPosition(subPoints: SubPoint[] | undefined) {
    if (!subPoints || subPoints.length === 0) return 1000;
    return Math.max(...subPoints.map((subPoint) => subPoint.position)) + 1000;
}

function scratchSource(scratchNote: ScratchNote) {
    return scratchNote.section ? 'manual' : 'ai';
}

function addScratchAsSubPoint(
    outline: ComposedPlanOutline,
    targetPointId: string,
    scratchNote: ScratchNote,
    headingText: string
) {
    for (const section of COMPOSE_SECTION_KEYS) {
        outline[section] = outline[section].map((candidate) => {
            if (candidate.id !== targetPointId) return candidate;
            const existingSubPoints = candidate.subPoints ?? [];
            return {
                ...candidate,
                subPoints: [
                    ...existingSubPoints,
                    {
                        id: composeSubPointId(),
                        scratchNoteId: scratchNote.id,
                        text: compactScratchText(headingText || scratchNote.text),
                        // The preacher's raw phrase comes from OUR copy of the note, never
                        // from the model. It used to be echoed back verbatim — 5287 wasted
                        // characters on a 25-note sermon, and a chance to corrupt the text.
                        note: scratchNote.text,
                        source: scratchSource(scratchNote),
                        position: nextSubPointPosition(existingSubPoints),
                    },
                ],
            };
        });
    }
}

function addScratchAsNewPoint(
    outline: ComposedPlanOutline,
    section: ComposeSectionKey,
    scratchNote: ScratchNote,
    headingText?: string
) {
    outline[section].push({
        id: composePointId(),
        scratchNoteId: scratchNote.id,
        text: compactScratchText(headingText || scratchNote.text),
        note: scratchNote.text,
        source: scratchSource(scratchNote),
    });
}

interface KeyedComposeResult {
    outline: ComposedPlanOutline;
    /** Notes the model never placed (or placed with an unusable key). Reported, not hidden. */
    unplacedScratchNoteIds: string[];
    /** Keys the model invented. Each is dropped on its own — the response is NOT discarded. */
    unknownNoteKeys: string[];
}

/**
 * Turn the model's key-based placements back into a real outline.
 *
 * Two guarantees the old path did not give:
 * - a bad key drops only ITSELF (the previous code threw away the entire response when a
 *   single id looked wrong — and the model got ids wrong in 4 of 5 measured runs);
 * - completeness is decided by COUNTING, not by set membership, so a note referenced twice
 *   cannot masquerade as full coverage.
 */
function normalizeKeyedComposePlan(
    response: ComposePlanResponse,
    orderedScratch: ScratchNote[],
    existingEntries: Array<{ section: ComposeSectionKey; point: OutlinePoint }>,
    existingOutline?: SermonOutline
): KeyedComposeResult {
    const scratchByKey = new Map(orderedScratch.map((note, index) => [scratchNoteKey(index), note]));
    const pointIdByKey = new Map(existingEntries.map(({ point }, index) => [outlinePointKey(index), point.id]));
    const consumedScratchIds = new Set<string>();
    const unknownNoteKeys: string[] = [];
    const normalized = normalizeExistingOutline(existingOutline);

    response.placements.forEach((placement) => {
        const scratchNote = scratchByKey.get(placement.noteKey);
        if (!scratchNote) {
            unknownNoteKeys.push(placement.noteKey);
            return;
        }
        // Second mention of the same note is ignored, not applied twice.
        if (consumedScratchIds.has(scratchNote.id)) return;

        // A manual pin, then an explicit leading cue, always beat the model's opinion.
        const forcedSection = scratchNote.section ?? inferExplicitCueSection(scratchNote.text);
        const targetPointId = placement.targetKind === 'existing_point'
            ? pointIdByKey.get(placement.targetKey)
            : undefined;
        const targetLocation = targetPointId ? findPointLocation(normalized, targetPointId) : null;

        if (targetLocation && (!forcedSection || forcedSection === targetLocation.section)) {
            addScratchAsSubPoint(normalized, targetLocation.point.id, scratchNote, placement.text);
        } else {
            addScratchAsNewPoint(
                normalized,
                forcedSection ?? targetLocation?.section ?? placement.section,
                scratchNote,
                placement.text
            );
        }
        consumedScratchIds.add(scratchNote.id);
    });

    // Nothing is lost silently: whatever the model skipped still lands in the outline,
    // and its id is handed back so the caller can say so out loud.
    const unplacedScratchNoteIds: string[] = [];
    orderedScratch.forEach((scratchNote) => {
        if (consumedScratchIds.has(scratchNote.id)) return;
        unplacedScratchNoteIds.push(scratchNote.id);
        addScratchAsNewPoint(normalized, scratchNote.section ?? inferSectionFromCue(scratchNote.text), scratchNote);
    });

    return { outline: normalized, unplacedScratchNoteIds, unknownNoteKeys };
}

/**
 * Compose an ephemeral sermon outline from scratch notes.
 * Manual scratch sections are pinned server-side after the AI response, so a
 * model drift cannot move preacher-placed notes to a different section.
 */
export async function composePlanFromScratchStructured(
    sermon: Sermon,
    existingOutline?: SermonOutline,
    userId: string = sermon.userId
): Promise<{ outline: ComposedPlanOutline; success: boolean; unplacedScratchNoteIds: string[] }> {
    const scratch = sermon.scratch ?? [];
    const outlineToAugment = existingOutline ?? sermon.outline;
    const baseOutline = normalizeExistingOutline(outlineToAugment);

    if (scratch.length === 0) {
        return { outline: baseOutline, success: true, unplacedScratchNoteIds: [] };
    }

    const orderedScratch = sortScratchByCapture(scratch);
    const existingEntries = collectExistingPoints(outlineToAugment);
    const manualCount = orderedScratch.filter((note) => note.section).length;
    const unplacedCount = orderedScratch.length - manualCount;
    const scratchList = orderedScratch.map(scratchPromptLine).join('\n');
    const outlineList = existingOutlinePrompt(existingEntries);
    const existingPointCount = existingEntries.length;
    const hasNonLatinChars = /[^\u0000-\u007F]/.test(
        [
            sermon.title,
            sermon.verse,
            ...orderedScratch.map((note) => note.text),
            ...existingEntries.map(({ point }) => point.text),
        ].join(' ')
    );
    const expectedLanguage = hasNonLatinChars ? 'non-english' : 'en';

    const systemPrompt = `You are a sermon preparation assistant arranging a preacher's scratch notes into a sermon outline.

You never see the notes' real identifiers. Each scratch note has a SHORT KEY (n1, n2, ...) and each existing outline point has a SHORT KEY (p1, p2, ...). Answer with keys only.

Rules:
1. NEVER repeat the text of a scratch note. Reference every note ONLY by its key.
2. Every note key must appear EXACTLY ONCE — either in "placements" or in "unplaced". Never omit a key, never use one twice.
3. Use only keys listed below. Never invent a key.
4. Attach a note to the best-matching EXISTING outline point when one fits: targetKind="existing_point", targetKey="p<N>".
5. Otherwise start a new point: targetKind="new_point", targetKey="".
6. "text" is a SHORT outline heading YOU write for that note - sermon-outline style, same language as the notes, ideally under 8 words.
7. "section" is introduction, main or conclusion. A note marked [pinned:...] must keep that section.
8. Respect leading note cues: "в начале", "сначала", "вступление" at the start -> introduction; "в конце", "в заключение", "заключение", "призыв" at the start -> conclusion.
9. The notes are listed in the order the preacher recorded them. That sequence carries his intended flow - a note often continues the previous one. Keep it unless the content clearly says otherwise.
10. Put a note in "unplaced" only when it genuinely fits nowhere, with a short reasonCode.`;

    const userMessage = `SERMON TITLE: ${sermon.title || '(untitled)'}
SCRIPTURE: ${sermon.verse || '(not provided)'}
MANUAL_PLACED_NOTES: ${manualCount}
UNPLACED_NOTES: ${unplacedCount}
EXISTING_OUTLINE_POINTS: ${existingPointCount}

EXISTING OUTLINE POINTS:
${outlineList}

SCRATCH NOTES (${orderedScratch.length}, in the order the preacher recorded them):
${scratchList}

Arrange every note. Return keys and headings only.`;

    const promptBlueprint = buildPromptBlueprint({
        promptName: "sermon.scratch.to_outline",
        promptVersion: "v3-keys",
        expectedLanguage,
        context: {
            sermonId: sermon.id,
            sermonTitle: sermon.title,
            scratchCount: scratch.length,
            manualCount,
            unplacedCount,
            existingPointCount,
        },
        systemBlocks: [
            {
                blockId: "compose_plan_from_scratch.role_rules",
                category: "task",
                content: systemPrompt,
            },
        ],
        userBlocks: [
            {
                blockId: "compose_plan_from_scratch.notes",
                category: "context",
                content: userMessage,
            },
        ],
    });

    const result = await callWithStructuredOutput(
        promptBlueprint.systemPrompt,
        promptBlueprint.userMessage,
        ComposePlanResponseSchema,
        {
            formatName: "compose_plan_from_scratch",
            userId,
            promptBlueprint,
            // Our own deadline sits UNDER the 60s Vercel wall, and the SDK is told not to
            // retry silently (its default is 2 hidden retries with a 10-minute timeout).
            // A slow provider is then aborted by US — a typed error the route can answer
            // with — instead of the platform killing the function with no JSON body.
            requestOptions: { timeout: COMPOSE_PLAN_REQUEST_TIMEOUT_MS, maxRetries: 0 },
            logContext: {
                sermonId: sermon.id,
                sermonTitle: sermon.title,
                scratchCount: scratch.length,
                manualCount,
                unplacedCount,
                existingPointCount,
            },
        }
    );

    if (!result.success || !result.data) {
        console.error("ERROR: Failed to compose plan from scratch:", result.error || result.refusal);
        return { outline: baseOutline, success: false, unplacedScratchNoteIds: [] };
    }

    const { outline, unplacedScratchNoteIds, unknownNoteKeys } = normalizeKeyedComposePlan(
        result.data,
        orderedScratch,
        existingEntries,
        outlineToAugment
    );

    // Both are reported, never fatal: an invented key costs only itself, and a skipped note
    // still reaches the outline. Previously either one discarded the whole response.
    if (unknownNoteKeys.length > 0) {
        console.warn("WARN: Compose plan referenced unknown note keys (dropped):", unknownNoteKeys);
    }
    if (unplacedScratchNoteIds.length > 0) {
        console.warn(
            `WARN: Compose plan left ${unplacedScratchNoteIds.length} of ${orderedScratch.length} notes unplaced; appended them as their own points.`
        );
    }

    return { outline, success: true, unplacedScratchNoteIds };
}

/**
 * Generate a brainstorm suggestion for a sermon using structured output
 * @param sermon The sermon to generate brainstorm suggestion for
 * @returns A single brainstorm suggestion or null on error
 */
export async function generateBrainstormSuggestionStructured(
    sermon: Sermon,
    userId: string = sermon.userId
): Promise<BrainstormSuggestion | null> {
    const sermonContent = extractSermonContent(sermon);
    const userMessage = createBrainstormUserMessage(sermon, sermonContent);
    const promptBlueprint = buildSimplePromptBlueprint({
        promptName: "sermon.ideas.suggest",
        promptVersion: "v1",
        systemPrompt: brainstormSystemPrompt,
        userMessage,
        context: {
            sermonId: sermon.id,
            sermonTitle: sermon.title,
            contentLength: sermonContent.length,
        },
    });

    if (isDebugMode) {
        console.log("DEBUG: Generating brainstorm suggestion for sermon (structured):", sermon.id);
    }

    const result = await callWithStructuredOutput(
        promptBlueprint.systemPrompt,
        promptBlueprint.userMessage,
        BrainstormSuggestionSchema,
        {
            formatName: "brainstorm_suggestion",
            userId,
            promptBlueprint,
            logContext: {
                sermonId: sermon.id,
                sermonTitle: sermon.title,
                contentLength: sermonContent.length,
            },
        }
    );

    if (!result.success || !result.data) {
        console.error("ERROR: Failed to generate brainstorm suggestion:", result.error || result.refusal);
        return null;
    }

    // Add an ID to the suggestion and normalize the type to lowercase
    const suggestion: BrainstormSuggestion = {
        ...result.data,
        type: result.data.type.toLowerCase() as BrainstormSuggestion['type'],
        id: `bs-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    };

    return suggestion;
}

/**
 * Generate plan content for a specific outline point using structured output
 * @param sermonTitle The title of the sermon
 * @param sermonVerse The Bible verse for the sermon
 * @param outlinePointText The text of the outline point
 * @param relatedThoughtsTexts Array of texts from related thoughts
 * @param sectionName The section name (introduction, main, conclusion)
 * @param keyFragments Array of key fragments to include in the prompt
 * @param context Optional context about adjacent points to improve flow
 * @param style Optional style for the plan generation (default: 'memory')
 * @returns The generated content and success status
 */
export async function generatePlanPointContentStructured(
    _sermonTitle: string,
    _sermonVerse: string,
    _outlinePointText: string,
    _relatedThoughtsTexts: string[],
    _sectionName: string,
    _keyFragments: string[] = [],
    _context?: PlanContext,
    _style: PlanStyle = 'memory'
): Promise<{ content: string; success: boolean }> {
    // NOTE: This function is complex and requires extensive prompt engineering
    // For now, keeping the legacy implementation in openAI.client.ts
    // This would require migrating buildPlanPointSystemPrompt and buildPlanPointUserMessage
    // which are substantial functions with language detection logic

    // TODO: Migrate when ready to handle all edge cases
    console.warn("generatePlanPointContentStructured: Not yet implemented, using legacy version");
    return { content: "", success: false };
}
