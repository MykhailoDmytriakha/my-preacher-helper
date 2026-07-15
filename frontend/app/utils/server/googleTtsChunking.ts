import { splitTextEvenly, splitTextIntoChunks } from '@/api/clients/tts.client';
import { GOOGLE_SMALL_CHUNKING } from '@/config/audioGeneration';

export const GOOGLE_TTS_INPUT_TOKEN_LIMIT = 8192;
export const GOOGLE_TTS_SAFE_CHARS_PER_TOKEN = 3;
export const GOOGLE_TTS_MAX_CHUNK_SIZE = GOOGLE_TTS_INPUT_TOKEN_LIMIT * GOOGLE_TTS_SAFE_CHARS_PER_TOKEN;

export function splitGoogleTextForRequestLimit(text: string): string[] {
    if (text.length <= GOOGLE_TTS_MAX_CHUNK_SIZE) {
        return [text];
    }

    return splitTextIntoChunks(text, GOOGLE_TTS_MAX_CHUNK_SIZE);
}

/**
 * Single reversible seam for the Google rollout. The false branch deliberately
 * delegates to the untouched legacy request-limit splitter.
 */
export function splitGoogleTextForGeneration(
    text: string,
    useSmallChunking: boolean = GOOGLE_SMALL_CHUNKING
): string[] {
    return useSmallChunking
        ? splitTextEvenly(text)
        : splitGoogleTextForRequestLimit(text);
}
