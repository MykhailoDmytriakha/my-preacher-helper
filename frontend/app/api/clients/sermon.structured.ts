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
    BrainstormSuggestionSchema,
} from "@/config/schemas/zod";
import { Sermon, Insights, VerseWithRelevance, SermonPoint, BrainstormSuggestion, SectionHints } from "@/models/models";

import { extractSectionContent, extractSermonContent } from "./openAIHelpers";
import { buildPromptBlueprint, buildSimplePromptBlueprint } from "./promptBuilder";
import { callWithStructuredOutput } from "./structuredOutput";

import type { PlanContext, PlanStyle } from "./planTypes";

const isDebugMode = process.env.DEBUG_MODE === 'true';

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
        promptVersion: "v1",
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
