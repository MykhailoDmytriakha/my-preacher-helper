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
import { buildSimplePromptBlueprint } from "./promptBuilder";
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
 * Transforms dictated voice input into written prose in the author's voice.
 */
const POLISH_SYSTEM_PROMPT = `You are a writing assistant that transforms voice dictation into polished written prose.

The input is DICTATED text — voice is the INPUT METHOD, not the target format.
Your task: transform spoken dictation into written prose in the AUTHOR'S VOICE.

LANGUAGE RULE:
- The input may be in English, Russian, or Ukrainian.
- You MUST respond in the SAME language as the input.

WHAT TO TRANSFORM (oral → written):
- Remove filler words: "ну", "э-э-э", "эм", "типа", "короче", "в общем", "как бы", "значит", "вот"
- Remove false starts and self-corrections (keep only the final version)
- Remove meaningless repetitions and verbal hesitations
- Convert oral chains ("И вот... И это... И когда...") into structured written sentences
- Fix grammar errors, punctuation, capitalization

WHAT TO PRESERVE (his voice on paper):
- His theological vocabulary and personal expressions
- Personal metaphors and illustrations
- His argument structure and logical flow
- Important repetitions used for emphasis
- Any religious or biblical references as spoken

SCRIPTURE QUOTES & REFERENCES (LANGUAGE-SPECIFIC):
- If the speaker clearly quotes Scripture or explicitly references a verse (e.g., "James 1:5", "Иак. 1:5"),
  append the verse reference in parentheses at the end of that sentence —
  ONLY IF THE REFERENCE IS NOT ALREADY PRESENT in the original text (do not duplicate).
- If the quote is explicit and you are confident, you MAY include the exact verse text using the appropriate translation:
  - English → KJV
  - Russian → Russian Synodal translation
  - Ukrainian → Ogienko translation
- Never fabricate references or verses. If not confident, keep original wording and omit reference.
- Do not add verse references to vague allusions — only for explicit quotes or clearly named references.

GOAL: The output should read like a passage from a book HE would write — written quality, his personality, not academic and not raw dictation.

RULES:
- Don't add content that wasn't in the original
- Don't change the meaning
- If the transcription is very short or just filler words, return meaningPreserved: false

Return the transformed text in polishedText and set meaningPreserved to true if the meaning was preserved.`;

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
        const promptBlueprint = buildSimplePromptBlueprint({
            promptName: "polishTranscription",
            promptVersion: "v2",
            systemPrompt: POLISH_SYSTEM_PROMPT,
            userMessage,
            context: {
                transcriptionLength: trimmed.length,
            },
        });

        const result: StructuredOutputResult<PolishTranscription> = await callWithStructuredOutput(
            promptBlueprint.systemPrompt,
            promptBlueprint.userMessage,
            PolishTranscriptionSchema,
            {
                formatName: "polishTranscription",
                promptBlueprint,
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
