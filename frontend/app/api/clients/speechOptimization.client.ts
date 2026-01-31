/**
 * Speech Optimization Client
 * 
 * Uses GPT-4o-mini to convert written sermon text to natural speech format.
 * Removes markdown, smooths transitions, converts scripture references.
 */

import OpenAI from 'openai';

import type { Sermon } from '@/models/models';
import type {
    SpeechOptimizationOptions,
    SpeechOptimizationResult,
    SermonSection
} from '@/types/audioGeneration.types';

// ============================================================================
// OpenAI Client Setup
// ============================================================================

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const OPTIMIZATION_MODEL = 'gpt-4o-mini';

// ============================================================================
// System Prompt
// ============================================================================

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

Output Format (JSON):
{
  "chunks": [
    "First chunk of optimized text...",
    "Second chunk of text...",
    ...
  ]
}
`;

// ============================================================================
// Public API
// ============================================================================

/**
 * Optimizes sermon text for natural speech synthesis.
 * Uses semantic chunking via LLM to preserve flow.
 */
export async function optimizeTextForSpeech(
    rawText: string,
    sermon: Sermon,
    options: SpeechOptimizationOptions
): Promise<SpeechOptimizationResult> {
    const userPrompt = buildOptimizationPrompt(rawText, options);

    console.log('[SpeechOptimization] Request Prompt:', userPrompt);

    const response = await openai.chat.completions.create({
        model: OPTIMIZATION_MODEL,
        messages: [
            { role: 'system', content: SPEECH_OPTIMIZATION_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }, // Enforce JSON
        max_tokens: 16000,
    });

    const content = response.choices[0]?.message?.content?.trim() || '{}';
    console.log('[SpeechOptimization] AI Response Content:', content);
    let chunks: string[] = [];

    try {
        const parsed = JSON.parse(content);
        chunks = parsed.chunks || [];

        // Fallback if chunks empty but text exists (unlikely with json mode)
        if (chunks.length === 0 && content.length > 20) {
            chunks = [content];
        }
    } catch (e) {
        console.error('Failed to parse GPT JSON response:', e);
        // Fallback: treat whole response as one text block if parse fails
        chunks = [content];
    }

    const fullText = chunks.join(' ');

    return {
        optimizedText: fullText, // For reference/metadata
        chunks, // NEW: Direct chunks from LLM
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

    // Section markers in Russian (matching exportContent.ts output)
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
        // Section not found, return empty
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
 * @internal
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
    prompt += 'Convert the following sermon text to natural speech format:\n\n';
    prompt += '---\n';
    prompt += rawText;
    prompt += '\n---\n';

    return prompt;
}

/**
 * Gets the system prompt for speech optimization.
 * @internal
 */
export function getSystemPrompt(): string {
    return SPEECH_OPTIMIZATION_SYSTEM_PROMPT;
}
