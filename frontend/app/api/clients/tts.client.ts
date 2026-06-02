import 'openai/shims/node';

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

const TTS_MODEL_STANDARD = process.env.OPENAI_TTS_MODEL_STANDARD || 'gpt-4o-mini-tts';
const TTS_MODEL_HD = process.env.OPENAI_TTS_MODEL_HD || 'tts-1';

const GOOGLE_TTS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const GOOGLE_TTS_SAMPLE_RATE = 24000;
const GOOGLE_TTS_CHANNELS = 1;
const GOOGLE_TTS_BYTES_PER_SAMPLE = 2;

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
    if (options.provider === 'google') {
        return generateGeminiChunkAudio(text, options);
    }

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

    // Convert response to Blob (mime must match the requested format)
    const arrayBuffer = await response.arrayBuffer();
    const mimeType = (options.format || 'wav') === 'mp3' ? 'audio/mpeg' : 'audio/wav';
    const audioBlob = new Blob([arrayBuffer], { type: mimeType });

    return {
        audioBlob,
        index: 0, // Will be set by caller
        durationSeconds: estimateDuration(text),
        mimeType,
    };
}

async function generateGeminiChunkAudio(
    text: string,
    options: TTSGenerationOptions
): Promise<TTSChunkResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is required for Google TTS generation');
    }

    const response = await fetch(`${GOOGLE_TTS_ENDPOINT}/${options.model}:generateContent`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
            contents: [
                {
                    parts: [
                        {
                            text,
                        },
                    ],
                },
            ],
            generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: options.voice,
                        },
                    },
                },
            },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google TTS failed (${response.status}): ${errorText || response.statusText}`);
    }

    const payload = await response.json();
    const part = payload?.candidates?.[0]?.content?.parts?.find(
        (candidatePart: { inlineData?: { data?: string }; inline_data?: { data?: string } }) =>
            candidatePart.inlineData?.data || candidatePart.inline_data?.data
    );
    const base64Audio = part?.inlineData?.data || part?.inline_data?.data;

    if (!base64Audio) {
        throw new Error('Google TTS response did not include audio data');
    }

    const pcmBuffer = Buffer.from(base64Audio, 'base64');
    const audioBlob = pcm16ToWavBlob(pcmBuffer);

    return {
        audioBlob,
        index: 0,
        durationSeconds: estimateDuration(text),
        mimeType: 'audio/wav',
    };
}

function pcm16ToWavBlob(
    pcmData: Uint8Array,
    sampleRate: number = GOOGLE_TTS_SAMPLE_RATE,
    channels: number = GOOGLE_TTS_CHANNELS,
    bytesPerSample: number = GOOGLE_TTS_BYTES_PER_SAMPLE
): Blob {
    const dataSize = pcmData.byteLength;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeAscii(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    new Uint8Array(buffer, 44).set(pcmData);

    return new Blob([buffer], { type: 'audio/wav' });
}

function writeAscii(view: DataView, offset: number, value: string): void {
    for (let i = 0; i < value.length; i++) {
        view.setUint8(offset + i, value.charCodeAt(i));
    }
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
 * Quality-path chunking target. Autoregressive TTS models (gpt-4o-mini-tts, Gemini
 * TTS) drift/whistle the longer the generated audio gets, so we keep each clip in
 * the ~1500-2000 char band. With the round() rule below the largest single chunk is
 * ~2625 chars — safely under OpenAI's 4096-char hard cap.
 */
export const EVEN_SPLIT_IDEAL_SIZE = 1750;
const EVEN_SPLIT_HARD_MAX = 4000;

/**
 * Splits text into N EVEN chunks on sentence boundaries, where
 *   N = max(1, round(len / idealSize)).
 *
 * Unlike the greedy splitTextIntoChunks (fills each chunk to the max and leaves a
 * small tail), this balances every chunk to ~equal size:
 *   1500 → [1500]      2000 → [2000]      2500 → [2500]
 *   3000 → [1500, 1500]      5000 → [~1667 ×3]
 * Shorter, uniform clips = better TTS quality and no tiny tail chunks.
 */
export function splitTextEvenly(
    text: string,
    idealSize: number = EVEN_SPLIT_IDEAL_SIZE
): string[] {
    const clean = text.trim();
    if (!clean) return [];

    const n = Math.max(1, Math.round(clean.length / idealSize));
    if (n === 1) return [clean];

    const sentences = splitBySentences(clean);
    if (sentences.length <= 1) {
        // A single very long sentence — fall back to even-ish word splitting.
        return splitByWords(clean, Math.ceil(clean.length / n));
    }

    // Distribute sentences across n buckets by position so each lands ~len/n chars —
    // balanced, and never cutting mid-sentence.
    const target = clean.length / n;
    const buckets: string[] = Array.from({ length: n }, () => '');
    let pos = 0;
    for (const sentence of sentences) {
        const bucket = Math.min(n - 1, Math.floor((pos + sentence.length / 2) / target));
        buckets[bucket] = buckets[bucket] ? `${buckets[bucket]} ${sentence}` : sentence;
        pos += sentence.length + 1;
    }

    // Safety net: a pathological giant sentence could overflow a bucket past the hard
    // cap — word-split just that one so we never exceed the API limit.
    const result: string[] = [];
    for (const bucket of buckets) {
        const trimmed = bucket.trim();
        if (!trimmed) continue;
        if (trimmed.length > EVEN_SPLIT_HARD_MAX) result.push(...splitByWords(trimmed, idealSize));
        else result.push(trimmed);
    }
    return result;
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
 * @returns Model identifier string
 */
export function getTTSModel(
    quality: 'standard' | 'hd'
): string {
    return quality === 'hd' ? TTS_MODEL_HD : TTS_MODEL_STANDARD;
}
