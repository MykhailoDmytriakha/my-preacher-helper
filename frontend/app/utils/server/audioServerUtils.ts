/**
 * Server-side Audio Utilities
 *
 * Provides functions for validating and processing audio files on the server.
 * Uses `music-metadata` for robust metadata extraction from various audio formats.
 */
import { parseBuffer } from 'music-metadata';

import { getTotalRecordingDuration } from '@/utils/audioRecorderConfig';

/** Buffer in seconds to allow for minor timing discrepancies */
const DURATION_OFFSET_SECONDS = 2;

/**
 * Result of audio duration validation.
 */
export interface AudioDurationValidationResult {
    valid: boolean;
    duration?: number; // Duration in seconds
    maxAllowed?: number; // Maximum allowed duration in seconds
    error?: string;
}

/**
 * Validates that an audio file's duration does not exceed the configured maximum.
 *
 * The maximum duration is calculated as:
 * `NEXT_PUBLIC_AUDIO_RECORDING_DURATION` + `NEXT_PUBLIC_AUDIO_GRACE_PERIOD` + offset
 *
 * @param audioBlob - The audio file as a Blob
 * @returns Validation result with duration info
 */
export async function validateAudioDuration(
    audioBlob: Blob
): Promise<AudioDurationValidationResult> {
    const maxAllowedDuration = getTotalRecordingDuration() + DURATION_OFFSET_SECONDS;

    try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const metadata = await parseBuffer(buffer, { mimeType: audioBlob.type });

        const duration = metadata.format.duration;

        if (duration === undefined) {
            console.warn('audioServerUtils: Could not determine audio duration from metadata.');
            // If duration is not determinable, we allow the request to proceed
            // to avoid blocking legitimate files with missing metadata.
            return { valid: true, maxAllowed: maxAllowedDuration };
        }

        console.log(`audioServerUtils: Audio duration: ${duration.toFixed(2)}s, Max allowed: ${maxAllowedDuration}s`);

        if (duration > maxAllowedDuration) {
            return {
                valid: false,
                duration,
                maxAllowed: maxAllowedDuration,
                error: `Audio duration (${duration.toFixed(1)}s) exceeds maximum allowed (${maxAllowedDuration}s).`,
            };
        }

        return { valid: true, duration, maxAllowed: maxAllowedDuration };
    } catch (error) {
        console.error('audioServerUtils: Error parsing audio metadata:', error);
        // On parsing error, we also allow the request to proceed.
        // OpenAI will perform its own validation.
        return { valid: true, maxAllowed: maxAllowedDuration };
    }
}
