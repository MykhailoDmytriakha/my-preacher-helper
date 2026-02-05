/**
 * Zod schema for sermon verse suggestions structured output.
 * Used with OpenAI's structured output feature for type-safe AI responses.
 */
import { z } from "zod";

/**
 * Schema for a single verse suggestion with relevance explanation.
 */
export const VerseWithRelevanceSchema = z.object({
    reference: z.string().describe("Bible verse reference (e.g., 'John 3:16')"),
    relevance: z.string().describe("Explanation of how this verse relates to the sermon"),
});

/**
 * Schema for AI-generated verse suggestions.
 * 
 * @property verses - Array of Bible verse suggestions with relevance
 */
export const VersesResponseSchema = z.object({
    verses: z
        .array(VerseWithRelevanceSchema)
        .describe("List of Bible verse suggestions with relevance explanations"),
});

/**
 * TypeScript type inferred from the Zod schema.
 * Use this for type-safe handling of AI responses.
 */
export type VersesResponse = z.infer<typeof VersesResponseSchema>;
export type VerseWithRelevance = z.infer<typeof VerseWithRelevanceSchema>;
