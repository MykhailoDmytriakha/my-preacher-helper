/**
 * Zod schema for sermon topics structured output.
 * Used with OpenAI's structured output feature for type-safe AI responses.
 */
import { z } from "zod";

/**
 * Schema for AI-generated sermon topics.
 * 
 * @property topics - Array of topic strings relevant to the sermon
 */
export const TopicsResponseSchema = z.object({
    topics: z
        .array(z.string())
        .describe("List of topics relevant to the sermon"),
});

/**
 * TypeScript type inferred from the Zod schema.
 * Use this for type-safe handling of AI responses.
 */
export type TopicsResponse = z.infer<typeof TopicsResponseSchema>;
