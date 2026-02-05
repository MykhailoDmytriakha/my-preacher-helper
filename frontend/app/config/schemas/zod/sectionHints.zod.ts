/**
 * Zod schema for sermon section hints structured output.
 * Used with OpenAI's structured output feature for type-safe AI responses.
 */
import { z } from "zod";

/**
 * Schema for AI-generated section hints.
 * Helps organize sermon thoughts into introduction, main, and conclusion sections.
 * Based on the actual SectionHints interface in models.ts
 * 
 * @property introduction - Hint text for introduction section
 * @property main - Hint text for main section  
 * @property conclusion - Hint text for conclusion section
 */
export const SectionHintsResponseSchema = z.object({
    introduction: z
        .string()
        .describe("Hint for organizing thoughts in the introduction section"),
    main: z
        .string()
        .describe("Hint for organizing thoughts in the main section"),
    conclusion: z
        .string()
        .describe("Hint for organizing thoughts in the conclusion section"),
});

/**
 * TypeScript type inferred from the Zod schema.
 * Use this for type-safe handling of AI responses.
 */
export type SectionHintsResponse = z.infer<typeof SectionHintsResponseSchema>;
