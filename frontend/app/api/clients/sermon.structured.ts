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
	type ComposePlanPoint,
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

// ===== Structured Output Functions =====

/**
 * Generate insights for a sermon using structured output
 * @param sermon The sermon to analyze
 * @returns Insights object or null on error
 */
export async function generateSermonInsightsStructured(sermon: Sermon): Promise<Insights | null> {
    const sermonContent = extractSermonContent(sermon);
    const userMessage = createInsightsUserMessage(sermon, sermonContent);
    const promptBlueprint = buildSimplePromptBlueprint({
        promptName: "sermon_insights",
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
export async function generateSermonTopicsStructured(sermon: Sermon): Promise<string[]> {
    const sermonContent = extractSermonContent(sermon);
    const userMessage = createTopicsUserMessage(sermon, sermonContent);
    const promptBlueprint = buildSimplePromptBlueprint({
        promptName: "sermon_topics",
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
export async function generateSermonVersesStructured(sermon: Sermon): Promise<VerseWithRelevance[]> {
    const sermonContent = extractSermonContent(sermon);
    const userMessage = createVersesUserMessage(sermon, sermonContent);
    const promptBlueprint = buildSimplePromptBlueprint({
        promptName: "sermon_verses",
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
export async function generateSectionHintsStructured(sermon: Sermon): Promise<SectionHints | null> {
    const sermonContent = extractSermonContent(sermon);
    const userMessage = createSectionHintsUserMessage(sermon, sermonContent);
    const promptBlueprint = buildSimplePromptBlueprint({
        promptName: "section_hints",
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
    section: string
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
        promptName: "sermon_points",
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

function scratchPromptLine(note: ScratchNote, index: number) {
    return `${index + 1}. id=${note.id}; section=${scratchSectionLabel(note.section)}; text="${note.text.replace(/"/g, '\\"')}"`;
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

function collectComposePoints(outline: Record<ComposeSectionKey, ComposePlanPoint[]>) {
    return COMPOSE_SECTION_KEYS.flatMap((section) => outline[section].map((point) => ({ section, point })));
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

function outlinePromptLine(section: ComposeSectionKey, point: OutlinePoint, index: number) {
    const subPoints = (point.subPoints ?? [])
        .map((subPoint) => `${subPoint.id}:${subPoint.text}`)
        .join(' | ');
    const note = point.note ? `; note="${point.note.replace(/"/g, '\\"')}"` : '';
    const children = subPoints ? `; subPoints=${subPoints}` : '';

    return `${index + 1}. id=${point.id}; section=${section}; text="${point.text.replace(/"/g, '\\"')}"${note}${children}`;
}

function existingOutlinePrompt(existingOutline?: SermonOutline) {
    const lines = COMPOSE_SECTION_KEYS.flatMap((section) =>
        (existingOutline?.[section] ?? []).map((point, index) => outlinePromptLine(section, point, index))
    );

    return lines.length > 0 ? lines.join('\n') : '(none)';
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
    point: ComposePlanPoint
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
                        text: compactScratchText(point.text || scratchNote.text),
                        note: point.note?.trim() || scratchNote.text,
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
    point?: ComposePlanPoint
) {
    outline[section].push({
        id: composePointId(),
        scratchNoteId: scratchNote.id,
        text: compactScratchText(point?.text || scratchNote.text),
        note: point?.note?.trim() || scratchNote.text,
        source: scratchSource(scratchNote),
    });
}

function normalizeComposePlan(
    aiPlan: Record<ComposeSectionKey, ComposePlanPoint[]>,
    scratch: ScratchNote[],
    existingOutline?: SermonOutline
): ComposedPlanOutline {
    const scratchById = new Map(scratch.map((note) => [note.id, note]));
    const consumedScratchIds = new Set<string>();
    const normalized = normalizeExistingOutline(existingOutline);

    collectComposePoints(aiPlan).forEach(({ section, point }) => {
        const scratchNote = scratchById.get(point.scratchNoteId);
        if (!scratchNote || consumedScratchIds.has(scratchNote.id)) return;

        const forcedSection = scratchNote.section ?? inferExplicitCueSection(scratchNote.text);
        const targetLocation = point.outlinePointId ? findPointLocation(normalized, point.outlinePointId) : null;

        if (targetLocation && (!forcedSection || forcedSection === targetLocation.section)) {
            addScratchAsSubPoint(normalized, targetLocation.point.id, scratchNote, point);
        } else {
            addScratchAsNewPoint(normalized, forcedSection ?? targetLocation?.section ?? section, scratchNote, point);
        }
        consumedScratchIds.add(scratchNote.id);
    });

    scratch.forEach((scratchNote) => {
        if (consumedScratchIds.has(scratchNote.id)) return;

        const targetSection = scratchNote.section ?? inferSectionFromCue(scratchNote.text);
        addScratchAsNewPoint(normalized, targetSection, scratchNote);
    });

    return normalized;
}

function findUnknownScratchIds(
    aiPlan: Record<ComposeSectionKey, ComposePlanPoint[]>,
    scratch: ScratchNote[]
): string[] {
    const knownIds = new Set(scratch.map((note) => note.id));
    const unknownIds = new Set<string>();

    collectComposePoints(aiPlan).forEach(({ point }) => {
        if (!knownIds.has(point.scratchNoteId)) {
            unknownIds.add(point.scratchNoteId);
        }
    });

    return [...unknownIds];
}

/**
 * Compose an ephemeral sermon outline from scratch notes.
 * Manual scratch sections are pinned server-side after the AI response, so a
 * model drift cannot move preacher-placed notes to a different section.
 */
export async function composePlanFromScratchStructured(
    sermon: Sermon,
    existingOutline?: SermonOutline
): Promise<{ outline: ComposedPlanOutline; success: boolean }> {
    const scratch = sermon.scratch ?? [];
    const outlineToAugment = existingOutline ?? sermon.outline;
    const baseOutline = normalizeExistingOutline(outlineToAugment);

    if (scratch.length === 0) {
        return { outline: baseOutline, success: true };
    }

    const manualCount = scratch.filter((note) => note.section).length;
    const unplacedCount = scratch.length - manualCount;
    const scratchList = scratch.map(scratchPromptLine).join('\n');
    const outlineList = existingOutlinePrompt(outlineToAugment);
    const existingPointCount = COMPOSE_SECTION_KEYS.reduce(
        (count, section) => count + (outlineToAugment?.[section]?.length ?? 0),
        0
    );
    const hasNonLatinChars = /[^\u0000-\u007F]/.test(
        [
            sermon.title,
            sermon.verse,
            ...scratch.map((note) => note.text),
            ...COMPOSE_SECTION_KEYS.flatMap((section) => (outlineToAugment?.[section] ?? []).map((point) => point.text)),
        ].join(' ')
    );
    const expectedLanguage = hasNonLatinChars ? 'non-english' : 'en';

    const systemPrompt = `You are a sermon preparation assistant augmenting an existing sermon outline with scratch notes.

Return scratch-note placements grouped by introduction, main, and conclusion.

Rules:
1. Every scratch note must appear exactly once using its exact scratchNoteId.
2. Prefer attaching a scratch note to the best-matching EXISTING OUTLINE POINT as a sub-point by returning outlinePointId.
3. Create a new outline point only when no existing point fits; in that case omit outlinePointId.
4. Never invent outline point ids. Use only ids from EXISTING OUTLINE when outlinePointId is present.
5. Notes that already have section=introduction/main/conclusion must stay in that section.
6. Respect leading note cues only: "в начале", "сначала", "вступление" at the start -> introduction; "в конце", "в заключение", "заключение", "призыв" at the start -> conclusion.
7. Keep text concise, sermon-outline style, in the same language as the notes.
8. Put the original wording in note. Use note to preserve the preacher's raw phrase.
9. Order new points naturally inside each section.`;

    const userMessage = `SERMON TITLE: ${sermon.title || '(untitled)'}
SCRIPTURE: ${sermon.verse || '(not provided)'}
MANUAL_PLACED_NOTES: ${manualCount}
UNPLACED_NOTES: ${unplacedCount}
EXISTING_OUTLINE_POINTS: ${existingPointCount}

EXISTING OUTLINE:
${outlineList}

SCRATCH NOTES:
${scratchList}

Place each scratch note into the existing outline when it fits, or create a new point placement when it does not.`;

    const promptBlueprint = buildPromptBlueprint({
        promptName: "compose_plan_from_scratch",
        promptVersion: "v2",
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
            promptBlueprint,
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
        return { outline: baseOutline, success: false };
    }

    const unknownScratchIds = findUnknownScratchIds(result.data, scratch);
    if (unknownScratchIds.length > 0) {
        console.error("ERROR: Compose plan returned unknown scratch ids:", unknownScratchIds);
        return { outline: baseOutline, success: false };
    }

    return {
        outline: normalizeComposePlan(result.data, scratch, outlineToAugment),
        success: true,
    };
}

/**
 * Generate a brainstorm suggestion for a sermon using structured output
 * @param sermon The sermon to generate brainstorm suggestion for
 * @returns A single brainstorm suggestion or null on error
 */
export async function generateBrainstormSuggestionStructured(sermon: Sermon): Promise<BrainstormSuggestion | null> {
    const sermonContent = extractSermonContent(sermon);
    const userMessage = createBrainstormUserMessage(sermon, sermonContent);
    const promptBlueprint = buildSimplePromptBlueprint({
        promptName: "brainstorm_suggestion",
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
