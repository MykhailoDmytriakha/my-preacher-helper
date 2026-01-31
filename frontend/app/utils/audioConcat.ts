/**
 * Audio Concatenation Utilities
 * 
 * Uses Web Audio API to merge multiple audio blobs into a single file.
 * Note: Browser-side only - uses AudioContext.
 */

// ============================================================================
// Public API
// ============================================================================

/**
 * Concatenates multiple audio blobs into a single audio file.
 * Manually merges WAV files by combining PCM data and updating headers.
 * Safe for both server (Node.js) and browser environments.
 * 
 * @param blobs - Array of audio blobs to merge (must be WAV format)
 * @returns Single merged audio blob (WAV format)
 */
export async function concatenateAudioBlobs(blobs: Blob[]): Promise<Blob> {
    if (blobs.length === 0) {
        throw new Error('No audio blobs provided for concatenation');
    }

    if (blobs.length === 1) {
        return blobs[0];
    }

    // Convert all blobs to ArrayBuffers
    const arrayBuffers = await Promise.all(blobs.map(b => b.arrayBuffer()));

    // Find data chunk info for the first blob (this will be our template)
    const firstInfo = findSubchunk(arrayBuffers[0], 'data');
    if (!firstInfo) throw new Error('First audio blob is not a valid WAV file (missing data chunk)');

    const header = new Uint8Array(arrayBuffers[0].slice(0, firstInfo.offset));

    // Calculate total data size across all blobs
    let totalDataSize = 0;
    const dataChunks: Uint8Array[] = [];

    for (let i = 0; i < arrayBuffers.length; i++) {
        const info = findSubchunk(arrayBuffers[i], 'data');
        if (!info) {
            console.warn(`Skipping blob ${i}: Not a valid WAV file (missing data chunk)`);
            continue;
        }
        totalDataSize += info.size;
        dataChunks.push(new Uint8Array(arrayBuffers[i].slice(info.offset, info.offset + info.size)));
    }

    // Create resulting buffer: Header of first blob + all data chunks
    const resultBuffer = new Uint8Array(header.length + totalDataSize);

    // 1. Copy template header
    resultBuffer.set(header, 0);

    // 2. Update lengths in the header
    const view = new DataView(resultBuffer.buffer);

    // RIFF ChunkSize: FileSize - 8
    // Usually at offset 4
    if (view.getUint32(0, false) === 0x52494646) { // "RIFF"
        view.setUint32(4, resultBuffer.byteLength - 8, true);
    }

    // data Subchunk size: actual data size
    // Usually at offset -4 from the data start (firstInfo.offset - 4)
    view.setUint32(firstInfo.offset - 4, totalDataSize, true);

    // 3. Copy data from all buffers
    let currentOffset = header.length;
    for (const data of dataChunks) {
        resultBuffer.set(data, currentOffset);
        currentOffset += data.length;
    }

    return new Blob([resultBuffer], { type: 'audio/wav' });
}

/**
 * Finds a specific subchunk in a WAV file buffer.
 * @internal
 */
function findSubchunk(buffer: ArrayBuffer, name: string): { offset: number; size: number } | null {
    const view = new DataView(buffer);
    const magic = name.split('').reduce((acc, char, i) => acc | (char.charCodeAt(0) << (i * 8)), 0);

    // Start after "RIFF" (4), Size (4), "WAVE" (4)
    let offset = 12;

    while (offset + 8 <= buffer.byteLength) {
        const chunkId = view.getUint32(offset, true);
        const chunkSize = view.getUint32(offset + 4, true);

        if (chunkId === magic) {
            // Validate size
            if (offset + 8 + chunkSize > buffer.byteLength) {
                console.warn(`[WAV] Invalid chunk size for '${name}': ${chunkSize} bytes (buffer remains: ${buffer.byteLength - offset - 8})`);

                // Fix for cases where size is 0xFFFFFFFF (-1) or just wrong (larger than file)
                // If this is the 'data' chunk, we can safely assume it consumes the rest of the file
                if (name === 'data') {
                    const remaining = buffer.byteLength - (offset + 8);
                    console.warn(`[WAV] Clamping '${name}' chunk size to ${remaining} bytes`);
                    return { offset: offset + 8, size: remaining };
                }

                return null;
            }
            return { offset: offset + 8, size: chunkSize };
        }

        offset += 8 + chunkSize;
        // Padding byte if chunkSize is odd
        if (chunkSize % 2 !== 0) offset++;
    }

    return null;
}

/**
 * Converts a Blob to an AudioBuffer.
 * 
 * @param blob - Audio blob to decode
 * @param audioContext - AudioContext to use for decoding
 * @returns Decoded AudioBuffer
 */
export async function blobToAudioBuffer(
    blob: Blob,
    audioContext?: AudioContext
): Promise<AudioBuffer> {
    const ctx = audioContext || new AudioContext();
    const shouldClose = !audioContext;

    try {
        const arrayBuffer = await blob.arrayBuffer();
        return await ctx.decodeAudioData(arrayBuffer);
    } finally {
        if (shouldClose) {
            await ctx.close();
        }
    }
}

/**
 * Encodes an AudioBuffer to a WAV Blob.
 * WAV is used because it's straightforward to encode without external libraries.
 * 
 * @param buffer - AudioBuffer to encode
 * @returns Encoded audio as WAV Blob
 */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;

    // Interleave channels
    const interleaved = interleaveChannels(buffer);

    // Create WAV file
    const wavBuffer = encodeWav(interleaved, sampleRate, numberOfChannels);

    return new Blob([wavBuffer], { type: 'audio/wav' });
}

/**
 * Interleaves audio channels into a single Float32Array.
 * @internal
 */
function interleaveChannels(buffer: AudioBuffer): Float32Array {
    const numberOfChannels = buffer.numberOfChannels;
    const length = buffer.length;
    const result = new Float32Array(length * numberOfChannels);

    for (let i = 0; i < length; i++) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
            result[i * numberOfChannels + channel] = buffer.getChannelData(channel)[i];
        }
    }

    return result;
}

/**
 * Encodes audio samples to WAV format.
 * @internal
 */
function encodeWav(
    samples: Float32Array,
    sampleRate: number,
    numberOfChannels: number
): ArrayBuffer {
    const bytesPerSample = 2; // 16-bit
    const blockAlign = numberOfChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples.length * bytesPerSample;
    const bufferSize = 44 + dataSize;

    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true);
    writeString(view, 8, 'WAVE');

    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true); // BitsPerSample

    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Write audio data (convert float to 16-bit PCM)
    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, int16, true);
        offset += 2;
    }

    return buffer;
}

/**
 * Writes a string to a DataView.
 * @internal
 */
function writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}

// ============================================================================
// Silence Generation
// ============================================================================

/**
 * Creates a silent audio segment.
 * Useful for adding pauses between sections.
 * 
 * @param durationMs - Duration of silence in milliseconds
 * @param sampleRate - Audio sample rate (default: 44100)
 * @param numberOfChannels - Number of audio channels (default: 2)
 * @returns Blob containing silent audio
 */
export function createSilenceBlob(
    durationMs: number,
    sampleRate: number = 44100,
    numberOfChannels: number = 2
): Blob {
    const length = Math.round((durationMs / 1000) * sampleRate);
    const samples = new Float32Array(length * numberOfChannels);
    // samples are already initialized to 0 (silence)

    return new Blob([encodeWav(samples, sampleRate, numberOfChannels)], {
        type: 'audio/wav',
    });
}

/**
 * Adds silence between audio blobs before concatenation.
 * 
 * @param blobs - Audio blobs to separate
 * @param silenceDurationMs - Duration of silence between blobs
 * @returns New array with silence blobs inserted
 */
export async function insertSilenceBetweenBlobs(
    blobs: Blob[],
    silenceDurationMs: number = 500
): Promise<Blob[]> {
    if (blobs.length <= 1) {
        return blobs;
    }

    const silenceBlob = createSilenceBlob(silenceDurationMs);
    const result: Blob[] = [];

    for (let i = 0; i < blobs.length; i++) {
        result.push(blobs[i]);
        if (i < blobs.length - 1) {
            result.push(silenceBlob);
        }
    }

    return result;
}

// ============================================================================
// File Download
// ============================================================================

/**
 * Triggers download of an audio blob as file.
 * 
 * @param blob - Audio blob to download
 * @param filename - Name for the downloaded file
 * 
 * @example
 * ```typescript
 * downloadAudioAsFile(audioBlob, 'sermon-audio.wav');
 * ```
 */
export function downloadAudioAsFile(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Generates a safe filename from sermon title.
 * 
 * @param sermonTitle - Original sermon title
 * @param extension - File extension (default: 'wav')
 * @returns Sanitized filename
 */
export function generateAudioFilename(
    sermonTitle: string,
    extension: string = 'wav'
): string {
    const sanitized = sermonTitle
        .toLowerCase()
        .replace(/[^a-zа-яё0-9\s]/gi, '')
        .replace(/\s+/g, '-')
        .slice(0, 50);

    return `${sanitized}-audio.${extension}`;
}
