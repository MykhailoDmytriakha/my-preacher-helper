/**
 * TTS (Text-to-Speech) Client
 * 
 * Handles OpenAI TTS API calls with text chunking and audio generation.
 * Supports multiple voices and quality levels.
 */

import OpenAI from 'openai';

import { MAX_CHUNK_SIZE } from '@/types/audioGeneration.types';

import type {
    TTSGenerationOptions,
    TTSChunkResult,
    AudioChunk,
    AudioGenerationProgress,
    SermonSection,
} from '@/types/audioGeneration.types';

// ============================================================================
// OpenAI Client Setup
// ============================================================================

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// ============================================================================
// Public API
// ============================================================================

/**
 * Generates audio for a single text chunk using OpenAI TTS.
 * 
 * @param text - Text to convert to speech (max 4096 chars)
 * @param options - TTS options (voice, model, format)
 * @returns Audio blob and metadata
 * 
 * @example
 * ```typescript
 * const result = await generateChunkAudio(
 *   "Сегодня мы поговорим о пути смирения...",
 *   { voice: 'onyx', model: 'gpt-4o-mini-tts', format: 'mp3' }
 * );
 * ```
 */
export async function generateChunkAudio(
    text: string,
    options: TTSGenerationOptions
): Promise<TTSChunkResult> {
    // Validate text length
    if (text.length > 4096) {
        throw new Error(`Text exceeds maximum length of 4096 characters (got ${text.length})`);
    }

    const response = await openai.audio.speech.create({
        model: options.model,
        voice: options.voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer',
        input: text,
        response_format: options.format || 'wav',
    });

    // Convert response to Blob
    const arrayBuffer = await response.arrayBuffer();
    const audioBlob = new Blob([arrayBuffer], { type: 'audio/wav' });

    return {
        audioBlob,
        index: 0, // Will be set by caller
        durationSeconds: estimateDuration(text),
    };
}

/**
 * Generates audio for all chunks with progress callback.
 * 
 * @param chunks - Array of audio chunks to process
 * @param options - TTS options
 * @param onProgress - Progress callback for UI updates
 * @returns Array of audio blobs in order
 * 
 * @example
 * ```typescript
 * const blobs = await generateAllChunksAudio(
 *   chunks,
 *   { voice: 'onyx', model: 'gpt-4o-mini-tts' },
 *   (progress) => setProgress(progress)
 * );
 * ```
 */
export async function generateAllChunksAudio(
    chunks: AudioChunk[],
    options: TTSGenerationOptions,
    onProgress?: (progress: AudioGenerationProgress) => void
): Promise<Blob[]> {
    const blobs: Blob[] = [];
    const totalChunks = chunks.length;

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        // Report progress
        if (onProgress) {
            const percent = 30 + Math.round(((i + 1) / totalChunks) * 50);
            onProgress({
                step: 'generating',
                percent,
                currentChunk: i + 1,
                totalChunks,
                message: `Генерация аудио (чанк ${i + 1} из ${totalChunks})...`,
            });
        }

        const result = await generateChunkAudio(chunk.text, options);
        blobs.push(result.audioBlob);
    }

    return blobs;
}

// ============================================================================
// Text Chunking
// ============================================================================

/**
 * Splits text into chunks suitable for TTS API.
 * Respects paragraph boundaries when possible.
 * 
 * @param text - Full text to split
 * @param maxSize - Maximum chunk size (default: 4000)
 * @returns Array of text chunks
 * 
 * @example
 * ```typescript
 * const chunks = splitTextIntoChunks(longText, 4000);
 * // ["Первый абзац...", "Второй абзац...", ...]
 * ```
 */
/**
 * Splits a long sentence into smaller chunks by words.
 * @internal
 */
function splitByWords(sentence: string, maxSize: number): string[] {
    const chunks: string[] = [];
    const words = sentence.split(/\s+/);
    let wordChunk = '';

    for (const word of words) {
        if ((wordChunk + ' ' + word).length > maxSize) {
            if (wordChunk.trim()) chunks.push(wordChunk.trim());
            wordChunk = word;
        } else {
            wordChunk = wordChunk ? wordChunk + ' ' + word : word;
        }
    }

    if (wordChunk.trim()) chunks.push(wordChunk.trim());
    return chunks;
}

/**
 * Splits a long paragraph into chunks by sentences or words.
 * @internal
 */
function splitParagraph(paragraph: string, maxSize: number): string[] {
    const chunks: string[] = [];
    const sentences = splitBySentences(paragraph);
    let currentChunk = '';

    for (const sentence of sentences) {
        if (sentence.length > maxSize) {
            // Flush current before word splitting
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }
            chunks.push(...splitByWords(sentence, maxSize));
        } else if ((currentChunk + ' ' + sentence).length > maxSize) {
            if (currentChunk.trim()) chunks.push(currentChunk.trim());
            currentChunk = sentence;
        } else {
            currentChunk = currentChunk ? currentChunk + ' ' + sentence : sentence;
        }
    }

    if (currentChunk.trim()) chunks.push(currentChunk.trim());
    return chunks;
}

/**
 * Splits text into chunks suitable for TTS API.
 * Respects paragraph boundaries when possible.
 */
export function splitTextIntoChunks(
    text: string,
    maxSize: number = MAX_CHUNK_SIZE
): string[] {
    if (text.length <= maxSize) return [text];

    const chunks: string[] = [];
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
    let currentChunk = '';

    for (const paragraph of paragraphs) {
        if (paragraph.length > maxSize) {
            // Split long paragraph
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }
            chunks.push(...splitParagraph(paragraph, maxSize));
        } else if ((currentChunk + '\n\n' + paragraph).length > maxSize) {
            if (currentChunk.trim()) chunks.push(currentChunk.trim());
            currentChunk = paragraph;
        } else {
            currentChunk = currentChunk ? currentChunk + '\n\n' + paragraph : paragraph;
        }
    }

    if (currentChunk.trim()) chunks.push(currentChunk.trim());
    return chunks;
}

/**
 * Splits text by sentence boundaries.
 * @internal
 */
function splitBySentences(text: string): string[] {
    // Match sentence-ending punctuation followed by space or end
    return text.split(/(?<=[.!?])\s+/).filter(s => s.trim());
}

/**
 * Creates AudioChunk objects from text chunks.
 * 
 * @param textChunks - Array of text strings
 * @param sectionId - Section these chunks belong to
 * @returns Array of AudioChunk objects with metadata
 */
export function createAudioChunks(
    textChunks: string[],
    sectionId: SermonSection | 'all' = 'all'
): AudioChunk[] {
    const now = new Date().toISOString();

    // Map 'all' to a sensible default section
    const section: SermonSection = sectionId === 'all' ? 'mainPart' : sectionId;

    return textChunks.map((text, index) => ({
        text,
        sectionId: section,
        createdAt: now,
        index,
    }));
}

// ============================================================================
// Duration Estimation
// ============================================================================

/**
 * Estimates audio duration from text length.
 * Based on average speaking rate of ~150 words/minute.
 * 
 * @param text - Text to estimate duration for
 * @returns Estimated duration in seconds
 */
export function estimateDuration(text: string): number {
    const wordsPerMinute = 150;
    const wordCount = text.split(/\s+/).length;
    return Math.round((wordCount / wordsPerMinute) * 60);
}

// ============================================================================
// TTS Model Selection
// ============================================================================

/**
 * Gets TTS model based on quality setting.
 * 
 * @param quality - 'standard' or 'hd'
 * @param preferMiniTTS - Use gpt-4o-mini-tts for cost savings
 * @returns Model identifier string
 */
export function getTTSModel(
    quality: 'standard' | 'hd',
    preferMiniTTS: boolean = true
): string {
    if (preferMiniTTS) {
        return 'gpt-4o-mini-tts';
    }
    return quality === 'hd' ? 'tts-1-hd' : 'tts-1';
}
