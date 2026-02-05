/**
 * Zod schema for brainstorm suggestion structured output.
 * Used with OpenAI's structured output feature for type-safe AI responses.
 */
import { z } from "zod";

/**
 * Schema for AI-generated brainstorm suggestion.
 * Helps overcome mental blocks during sermon preparation.
 * 
 * @property text - The brainstorm suggestion text
 * @property type - Type of brainstorm suggestion
 * @property complexity - Complexity level based on sermon context
 * @property dimensions - Array of thinking dimensions included
 */
export const BrainstormSuggestionSchema = z.object({
    text: z
        .string()
        .describe("The brainstorm suggestion text that encourages thinking, with complexity matching the sermon's contextual richness"),
    type: z
        .enum(["text", "question", "context", "reflection", "relationship", "application", "synthesis", "multi-perspective"])
        .describe("The type of brainstorm suggestion - synthesis and multi-perspective for rich contexts"),
    complexity: z
        .enum(["basic", "moderate", "high", "multi-dimensional"])
        .optional()
        .describe("The complexity level of the suggestion based on sermon context richness"),
    dimensions: z
        .array(z.string())
        .optional()
        .describe("Array of thinking dimensions or perspectives included in this suggestion (e.g., ['textual-analysis', 'contemporary-application', 'theological-depth'])"),
});

/**
 * TypeScript type inferred from the Zod schema.
 * Use this for type-safe handling of AI responses.
 */
export type BrainstormSuggestion = z.infer<typeof BrainstormSuggestionSchema>;
