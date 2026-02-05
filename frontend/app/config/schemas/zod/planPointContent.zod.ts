/**
 * Zod schema for plan point content structured output.
 * Used with OpenAI's structured output feature for type-safe AI responses.
 */
import { z } from "zod";

/**
 * Schema for AI-generated plan point content.
 * Returns formatted markdown content for a specific outline point.
 * 
 * @property content - Markdown-formatted content for the outline point
 */
export const PlanPointContentResponseSchema = z.object({
    content: z
        .string()
        .describe("Markdown-formatted content for the outline point, optimized for quick preaching reference"),
});

/**
 * TypeScript type inferred from the Zod schema.
 * Use this for type-safe handling of AI responses.
 */
export type PlanPointContentResponse = z.infer<typeof PlanPointContentResponseSchema>;
