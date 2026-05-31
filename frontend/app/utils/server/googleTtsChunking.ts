import { splitTextIntoChunks } from '@/api/clients/tts.client';

export const GOOGLE_TTS_INPUT_TOKEN_LIMIT = 8192;
export const GOOGLE_TTS_SAFE_CHARS_PER_TOKEN = 3;
export const GOOGLE_TTS_MAX_CHUNK_SIZE = GOOGLE_TTS_INPUT_TOKEN_LIMIT * GOOGLE_TTS_SAFE_CHARS_PER_TOKEN;

export function splitGoogleTextForRequestLimit(text: string): string[] {
    if (text.length <= GOOGLE_TTS_MAX_CHUNK_SIZE) {
        return [text];
    }

    return splitTextIntoChunks(text, GOOGLE_TTS_MAX_CHUNK_SIZE);
}
