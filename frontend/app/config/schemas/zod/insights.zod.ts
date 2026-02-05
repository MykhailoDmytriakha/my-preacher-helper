/**
 * Zod schema for sermon insights structured output.
 * Used with OpenAI's structured output feature for type-safe AI responses.
 */
import { z } from "zod";

/**
 * Schema for direction suggestion within insights.
 */
export const DirectionSuggestionSchema = z.object({
    area: z.string().optional().describe("The area or topic of the direction"),
    suggestion: z.string().optional().describe("The suggested direction or approach"),
    title: z.string().optional().describe("Alternative title format"),
    description: z.string().optional().describe("Alternative description format"),
    examples: z.array(z.string()).optional().describe("Optional examples"),
});

/**
 * Schema for verse suggestion with relevance.
 */
export const VerseWithRelevanceSchemaForInsights = z.object({
    reference: z.string().describe("Bible verse reference (e.g., 'John 3:16')"),
    relevance: z.string().describe("Explanation of how this verse relates to the sermon"),
});

/**
 * Schema for section hints.
 */
export const SectionHintsSchemaForInsights = z.object({
    introduction: z.string().describe("Hint for introduction section"),
    main: z.string().describe("Hint for main section"),
    conclusion: z.string().describe("Hint for conclusion section"),
});

/**
 * Schema for AI-generated sermon insights.
 * Based on the actual Insights interface in models.ts
 * 
 * @property topics - List of topics related to the sermon
 * @property relatedVerses - Bible verses relevant to the sermon
 * @property possibleDirections - Suggested research or development directions
 * @property sectionHints - Optional hints for organizing thoughts into sections
 */
export const InsightsResponseSchema = z.object({
    topics: z
        .array(z.string())
        .describe("List of topics related to the sermon"),
    relatedVerses: z
        .array(VerseWithRelevanceSchemaForInsights)
        .describe("Bible verses relevant to the sermon with relevance explanations"),
    possibleDirections: z
        .array(DirectionSuggestionSchema)
        .describe("Suggested research or development directions for the sermon"),
    sectionHints: SectionHintsSchemaForInsights
        .optional()
        .describe("Optional hints for organizing thoughts into introduction, main, and conclusion sections"),
});

/**
 * TypeScript type inferred from the Zod schema.
 * Use this for type-safe handling of AI responses.
 */
export type InsightsResponse = z.infer<typeof InsightsResponseSchema>;
