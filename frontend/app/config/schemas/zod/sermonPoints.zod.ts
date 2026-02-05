/**
 * Zod schema for sermon outline points structured output.
 * Used with OpenAI's structured output feature for type-safe AI responses.
 */
import { z } from "zod";

/**
 * Schema for a single sermon outline point.
 */
export const SermonPointSchema = z.object({
    text: z.string().describe("The text of the outline point (short phrase, 10 words or less)"),
});

/**
 * Schema for AI-generated sermon outline points.
 * 
 * @property outlinePoints - Array of outline points for a sermon section
 */
export const SermonPointsResponseSchema = z.object({
    outlinePoints: z
        .array(SermonPointSchema)
        .min(3)
        .max(5)
        .describe("List of 3-5 outline points for the sermon section"),
});

/**
 * TypeScript type inferred from the Zod schema.
 * Use this for type-safe handling of AI responses.
 */
export type SermonPointsResponse = z.infer<typeof SermonPointsResponseSchema>;
export type SermonPoint = z.infer<typeof SermonPointSchema>;
