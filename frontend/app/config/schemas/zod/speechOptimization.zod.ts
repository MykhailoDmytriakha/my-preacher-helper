import { z } from "zod";

/**
 * Zod schema for speech optimization response.
 * Defines the structure for converting written text to semantic speech chunks.
 */
export const SpeechOptimizationResponseSchema = z.object({
    chunks: z.array(
        z.string().describe("Semantic chunk of optimized speech text, max 4000 characters. Each chunk must be a complete thought or paragraph.")
    ),
});

/**
 * TypeScript type derived from the Zod schema.
 */
export type SpeechOptimizationResponse = z.infer<typeof SpeechOptimizationResponseSchema>;
