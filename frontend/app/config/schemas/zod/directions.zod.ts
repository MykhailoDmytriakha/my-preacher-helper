/**
 * Zod schema for sermon direction suggestions structured output.
 */
import { z } from "zod";

export const DirectionSuggestionSchema = z.object({
  title: z.string().describe("Short title for the suggested direction"),
  description: z.string().describe("Detailed explanation of the direction"),
  examples: z.array(z.string()).optional().describe("Optional examples or concrete applications"),
});

export const DirectionsResponseSchema = z.object({
  directions: z
    .array(DirectionSuggestionSchema)
    .describe("Array of direction suggestions for sermon improvement"),
});

export type DirectionSuggestionResponse = z.infer<typeof DirectionSuggestionSchema>;
export type DirectionsResponse = z.infer<typeof DirectionsResponseSchema>;
