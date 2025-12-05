/**
 * Zod schema for thought generation structured output.
 * Used with OpenAI's structured output feature for type-safe AI responses.
 */
import { z } from "zod";

/**
 * Schema for AI-generated thought from transcription.
 * 
 * @property originalText - The original transcription text provided as input
 * @property formattedText - The processed and formatted thought text
 * @property tags - List of relevant tags for categorization
 * @property meaningPreserved - Whether the generated text preserves the original meaning
 */
export const ThoughtResponseSchema = z.object({
  originalText: z
    .string()
    .describe("The original transcription text provided as input"),
  formattedText: z
    .string()
    .describe("The processed and formatted thought text derived from the original input"),
  tags: z
    .array(z.string())
    .describe("List of relevant tags for the thought"),
  meaningPreserved: z
    .boolean()
    .describe("Whether the generated text accurately reflects the core meaning of the original transcription"),
});

/**
 * TypeScript type inferred from the Zod schema.
 * Use this for type-safe handling of AI responses.
 */
export type ThoughtResponse = z.infer<typeof ThoughtResponseSchema>;

