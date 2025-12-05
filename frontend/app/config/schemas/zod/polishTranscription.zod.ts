/**
 * Zod schema for polish transcription structured output.
 * Used to clean up voice transcriptions by removing filler words
 * and fixing grammar/punctuation while preserving meaning.
 */
import { z } from "zod";

/**
 * Schema for polish transcription response.
 * Simple structure: just the cleaned-up text.
 */
export const PolishTranscriptionSchema = z.object({
    polishedText: z
        .string()
        .describe("The cleaned-up transcription with filler words removed, grammar and punctuation fixed, while preserving the original meaning and style."),
    meaningPreserved: z
        .boolean()
        .describe("Whether the original meaning was successfully preserved after cleaning."),
});

/**
 * TypeScript type inferred from the Zod schema.
 */
export type PolishTranscription = z.infer<typeof PolishTranscriptionSchema>;
