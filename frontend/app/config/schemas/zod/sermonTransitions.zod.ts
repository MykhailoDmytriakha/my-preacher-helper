import { z } from "zod";

/**
 * Zod schema for generated sermon narration transitions.
 *
 * Given the sermon's ordered parts (introduction, main-part points, conclusion),
 * the model returns spoken connective tissue that makes the audio's structure
 * audible: an opening, a short lead-in per part, and a closing.
 *
 * `bridges` is index-aligned to the parts passed in the prompt: `bridges[i]`
 * is the spoken lead-in that announces part `i`. Kept as a flat string array
 * (not array-of-objects) because that shape is the most reliable across the
 * OpenAI/Gemini structured-output clients used in this project.
 */
export const SermonTransitionsResponseSchema = z.object({
    intro: z
        .string()
        .describe(
            "A short spoken opening (1-3 sentences) that announces the sermon by title and, if given, its main scripture, then warmly leads into the message. Plain speech, no markdown, no headings like 'Introduction'."
        ),
    bridges: z
        .array(
            z
                .string()
                .describe(
                    "A short spoken lead-in (1-2 sentences) that naturally announces the next part of the sermon using its title, so a listener knows where they are. Conversational and reverent — never mechanical like 'Point 2'."
                )
        )
        .describe(
            "One lead-in per sermon part, in the SAME ORDER as the parts listed in the prompt. bridges[i] announces part i."
        ),
    outro: z
        .string()
        .describe(
            "A short spoken closing (1-2 sentences) that gently concludes the message. Plain speech, no markdown."
        ),
});

/** TypeScript type derived from the Zod schema. */
export type SermonTransitionsResponse = z.infer<typeof SermonTransitionsResponseSchema>;
