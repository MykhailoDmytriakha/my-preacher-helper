/**
 * Speech Optimization Client
 * 
 * Uses GPT-4o-mini to convert written sermon text to natural speech format.
 * Removes markdown, smooths transitions, converts scripture references.
 * Implemented using OpenAI's Structured Output for reliability.
 */

import { SpeechOptimizationResponseSchema } from "@/config/schemas/zod";

import { callWithStructuredOutput } from "./structuredOutput";

import type { Sermon } from '@/models/models';
import type {
    SpeechOptimizationOptions,
    SpeechOptimizationResult,
    SermonSection
} from '@/types/audioGeneration.types';

const OPTIMIZATION_MODEL = process.env.OPENAI_OPTIMIZATION_MODEL || 'gpt-4o-mini';

// ============================================================================
// System Prompt
// ============================================================================

const SPEECH_OPTIMIZATION_SYSTEM_PROMPT = `You are a sermon speech optimizer. Your task is to convert written sermon text into natural speech segments (chunks) for audio generation.

Input: Written sermon text (markdown).
Output: JSON object with an array of text chunks.

Requirements:
1. **Clean Text**: Remove ALL markdown (bullets, headers).
2. **References**: Convert "Быт 45:4-8" to "В книге Бытие, сорок пятой главе...".
3. **Flow**: Add natural connectors between thoughts ("Начнем с...", "Далее...").
4. **Tone**: Conversational, reverent, engaging.
5. **Chunking**: Split the text into semantic chunks (paragraphs or groups of related thoughts).
   - **CRITICAL**: Each chunk MUST be under 4000 characters.
   - **CRITICAL**: Semantic split (do not break sentences).
   - **CRITICAL**: Preserve exact meaning and sequence.
`;

// ============================================================================
// Public API
// ============================================================================

/**
 * Optimizes sermon text for natural speech synthesis.
 * Uses semantic chunking via LLM with Structured Output.
 */
export async function optimizeTextForSpeech(
    rawText: string,
    sermon: Sermon,
    options: SpeechOptimizationOptions
): Promise<SpeechOptimizationResult> {
    const userPrompt = buildOptimizationPrompt(rawText, options);

    // LOGGING: Detailed logs for user verification of Context-Aware Generation
    console.log('\n--- [Speech Optimization] Request ---');
    console.log('Section:', options.sections);
    console.log('Context Length:', options.previousContext?.length || 0);
    if (options.previousContext) {
        console.log('PREVIOUS CONTEXT (Snippet):', options.previousContext.slice(-200));
    }
    console.log('Model:', OPTIMIZATION_MODEL);
    console.log('USER PROMPT:', userPrompt);
    console.log('-------------------------------------\n');

    const result = await callWithStructuredOutput(
        SPEECH_OPTIMIZATION_SYSTEM_PROMPT,
        userPrompt,
        SpeechOptimizationResponseSchema,
        {
            formatName: "speech_optimization",
            model: OPTIMIZATION_MODEL,
            logContext: {
                sermonTitle: options.sermonTitle,
                textLength: rawText.length,
            }
        }
    );

    if (!result.success || !result.data) {
        throw result.error || new Error(result.refusal || "Failed to optimize text for speech");
    }

    const chunks = result.data.chunks;

    // LOGGING: Result
    console.log('\n--- [Speech Optimization] Result ---');
    console.log('Generated Chunks:', chunks.length);
    if (chunks.length > 0) {
        console.log('Chunk 1 Preview:', chunks[0].slice(0, 100) + '...');
    }
    console.log('------------------------------------\n');
    const fullText = chunks.join(' ');

    return {
        optimizedText: fullText,
        chunks,
        originalLength: rawText.length,
        optimizedLength: fullText.length,
    };
}

/**
 * Filters sermon text by selected sections.
 * 
 * @param rawText - Full sermon text
 * @param sections - Sections to include
 * @returns Filtered text containing only selected sections
 */
export function filterTextBySections(
    rawText: string,
    sections: SermonSection | 'all'
): string {
    if (sections === 'all') {
        return rawText;
    }

    // Section markers in Russian
    const sectionMarkers: Record<SermonSection, string[]> = {
        introduction: ['Вступление:', 'Introduction:', 'Введение:'],
        mainPart: ['Основная часть:', 'Main Part:', 'Основная:'],
        conclusion: ['Заключение:', 'Conclusion:', 'Итог:'],
    };

    const allMarkers = Object.values(sectionMarkers).flat();
    const targetMarkers = sectionMarkers[sections];

    // Find target section boundaries
    let startIndex = -1;
    let endIndex = rawText.length;

    // Find start of target section
    for (const marker of targetMarkers) {
        const idx = rawText.indexOf(marker);
        if (idx !== -1 && (startIndex === -1 || idx < startIndex)) {
            startIndex = idx;
        }
    }

    if (startIndex === -1) {
        return '';
    }

    // Find end of target section (start of next section)
    for (const marker of allMarkers) {
        if (targetMarkers.includes(marker)) continue;
        const idx = rawText.indexOf(marker, startIndex + 1);
        if (idx !== -1 && idx < endIndex) {
            endIndex = idx;
        }
    }

    return rawText.slice(startIndex, endIndex).trim();
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Builds the user prompt for GPT optimization.
 */
function buildOptimizationPrompt(
    rawText: string,
    options: SpeechOptimizationOptions
): string {
    let prompt = '';

    // Add context
    prompt += `Sermon title: "${options.sermonTitle}"\n`;
    if (options.scriptureVerse) {
        prompt += `Main scripture: ${options.scriptureVerse}\n`;
    }
    prompt += '\n';

    // Add instructions
    prompt += 'Convert the following sermon text to natural speech format:\n';

    if (options.previousContext) {
        prompt += `\nCONTEXT: The previous section ended with the following text. You must start the new section with a natural transition that flows from this context:\n"${options.previousContext}"\n`;
    }

    prompt += '\n---\n';
    prompt += rawText;
    prompt += '\n---\n';

    return prompt;
}

/**
 * Gets the system prompt for speech optimization.
 */
export function getSystemPrompt(): string {
    return SPEECH_OPTIMIZATION_SYSTEM_PROMPT;
}
