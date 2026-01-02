/**
 * Structured Output Implementation for Polish Transcription
 * 
 * This module provides AI-powered cleaning of voice transcriptions:
 * - Removes filler words (ну, э-э-э, короче, в общем, типа)
 * - Fixes grammar and punctuation
 * - Preserves original meaning and speaking style
 * 
 * Used for voice input in Study Notes.
 */
import { PolishTranscriptionSchema, PolishTranscription } from "@/config/schemas/zod";

import { logger } from "./openAIHelpers";
import { callWithStructuredOutput, StructuredOutputResult } from "./structuredOutput";

const isDebugMode = process.env.DEBUG_MODE === 'true';

/**
 * Result structure for polishTranscription operation.
 */
export interface PolishTranscriptionResult {
    success: boolean;
    polishedText: string | null;
    originalText: string;
    error: string | null;
}

/**
 * System prompt for polish transcription.
 * Simple and focused on cleaning up spoken text.
 */
const POLISH_SYSTEM_PROMPT = `You are a text cleaning assistant that processes voice transcriptions.

Your task is to clean up transcribed speech while preserving the original meaning and style.

LANGUAGE RULE:
- The input may be in English, Russian, or Ukrainian.
- You MUST respond in the SAME language as the input.

WHAT TO REMOVE:
- Filler words: "ну", "э-э-э", "эм", "типа", "короче", "в общем", "как бы", "значит", "вот"
- False starts and self-corrections (keep only the final version)
- Repetitions that don't add meaning
- Verbal hesitations and pauses

WHAT TO FIX:
- Grammar errors
- Punctuation (add missing periods, commas, question marks)
- Capitalization

WHAT TO PRESERVE:
- The original meaning and intent
- The speaker's natural style and voice
- Important repetitions used for emphasis
- Any religious or biblical references exactly as spoken

SCRIPTURE QUOTES & REFERENCES (LANGUAGE-SPECIFIC):
- If the speaker clearly quotes Scripture or explicitly references a verse (e.g., "James 1:5", "Иак. 1:5", "Як. 1:5"),
  then append the verse reference in parentheses at the end of that sentence.
- If the quote is explicit or the reference is precise, you MAY include the exact verse text in the polished output
  using the appropriate translation for the detected language:
  - English → KJV
  - Russian → Russian Synodal translation
  - Ukrainian → Ogienko translation
- Never fabricate references or verses. If you are not confident, keep the original wording and omit the reference/quote.
- Do not add full-verse quotes when the speaker did not clearly quote or explicitly reference a verse.

RULES:
- Keep the text natural and conversational
- Don't add content that wasn't in the original
- Don't change the meaning
- If the transcription is very short or just filler words, return meaningPreserved: false

Return the cleaned text in polishedText and set meaningPreserved to true if the meaning was preserved.`;

/**
 * Polish (clean up) a voice transcription.
 * 
 * @param transcription - The raw transcription text to clean up
 * @returns Cleaned up text with filler words removed
 * 
 * @example
 * ```typescript
 * const result = await polishTranscription(
 *   "Ну эээ... я хотел сказать что Бог есть любовь, вот"
 * );
 * 
 * if (result.success) {
 *   console.log(result.polishedText); // "Я хотел сказать, что Бог есть любовь."
 * }
 * ```
 */
export async function polishTranscription(
    transcription: string
): Promise<PolishTranscriptionResult> {
    const trimmed = transcription.trim();

    // Return early for empty input
    if (!trimmed) {
        return {
            success: false,
            polishedText: null,
            originalText: transcription,
            error: "Transcription is empty",
        };
    }

    if (isDebugMode) {
        logger.debug('PolishTranscription', "Starting polish", {
            transcriptionLength: trimmed.length,
            transcriptionPreview: trimmed.substring(0, 100),
        });
    }

    try {
        const userMessage = `Clean up this voice transcription:\n\n${trimmed}`;

        const result: StructuredOutputResult<PolishTranscription> = await callWithStructuredOutput(
            POLISH_SYSTEM_PROMPT,
            userMessage,
            PolishTranscriptionSchema,
            {
                formatName: "polishTranscription",
                logContext: {
                    transcriptionLength: trimmed.length,
                },
            }
        );

        // Handle refusal
        if (result.refusal) {
            logger.warn('PolishTranscription', `Model refused: ${result.refusal}`);
            return {
                success: false,
                polishedText: null,
                originalText: transcription,
                error: `AI refused: ${result.refusal}`,
            };
        }

        // Handle error
        if (result.error || !result.data) {
            const errorMessage = result.error?.message ?? "No data received from AI";
            logger.error('PolishTranscription', errorMessage);
            return {
                success: false,
                polishedText: null,
                originalText: transcription,
                error: errorMessage,
            };
        }

        // Check if meaning was preserved
        if (!result.data.meaningPreserved) {
            logger.warn('PolishTranscription', "Meaning not preserved, returning original");
            return {
                success: false,
                polishedText: null,
                originalText: transcription,
                error: "Could not preserve meaning while cleaning",
            };
        }

        logger.success('PolishTranscription', "Polish completed", {
            originalLength: trimmed.length,
            polishedLength: result.data.polishedText.length,
        });

        return {
            success: true,
            polishedText: result.data.polishedText,
            originalText: transcription,
            error: null,
        };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('PolishTranscription', `Failed: ${errorMessage}`);
        return {
            success: false,
            polishedText: null,
            originalText: transcription,
            error: errorMessage,
        };
    }
}
