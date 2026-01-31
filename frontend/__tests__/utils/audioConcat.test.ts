// Ensure global Blob has arrayBuffer (needed for some environments/jsdom versions)
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
    (Blob.prototype as any).arrayBuffer = function () {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.readAsArrayBuffer(this);
        });
    };
} else if (typeof Blob === 'undefined') {
    (global as any).Blob = class {
        constructor(public parts: any[], public options: any = {}) { }
        get size() {
            return this.parts.reduce((acc, p) => acc + (p.length || p.size || 0), 0);
        }
        get type() { return this.options.type || ''; }
        async arrayBuffer() {
            const res = new Uint8Array(this.size);
            let offset = 0;
            for (const p of this.parts) {
                const part = new Uint8Array(p instanceof ArrayBuffer ? p : (p.parts?.[0] || p));
                res.set(part, offset);
                offset += part.length;
            }
            return res.buffer;
        }
    };
}

// Mock FileReader if needed
if (typeof FileReader === 'undefined') {
    (global as any).FileReader = class {
        onload: any;
        result: any;
        readAsArrayBuffer(blob: any) {
            blob.arrayBuffer().then((buf: any) => {
                this.result = buf;
                this.onload();
            });
        }
    };
}

import {
    concatenateAudioBlobs,
    createSilenceBlob,
    insertSilenceBetweenBlobs,
    blobToAudioBuffer,
    audioBufferToWavBlob
} from '@/utils/audioConcat';

// Mock AudioContext and other web APIs 
const mockDecodeAudioData = jest.fn();
if (typeof AudioContext === 'undefined') {
    (global as any).AudioContext = class {
        close = jest.fn();
        decodeAudioData = mockDecodeAudioData;
        createBuffer = (ch: number, len: number, sr: number) => ({
            numberOfChannels: ch,
            length: len,
            sampleRate: sr,
            getChannelData: () => new Float32Array(len)
        });
    };
}

describe('audioConcat', () => {
    const createMockWav = (dataSize: number) => {
        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);

        // RIFF header
        view.setUint32(0, 0x52494646, false); // "RIFF"
        view.setUint32(4, 36 + dataSize, true); // ChunkSize
        view.setUint32(8, 0x57415645, false); // "WAVE"

        // fmt chunk
        view.setUint32(12, 0x666d7420, false); // "fmt "
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, 1, true); // Mono
        view.setUint32(24, 44100, true); // SampleRate
        view.setUint32(28, 88200, true); // ByteRate
        view.setUint16(32, 2, true); // BlockAlign
        view.setUint16(34, 16, true); // BitsPerSample

        // data chunk
        view.setUint32(36, 0x64617461, false); // "data"
        view.setUint32(40, dataSize, true);

        // Fill some "data"
        const dataArr = new Uint8Array(buffer, 44, dataSize);
        for (let i = 0; i < dataSize; i++) dataArr[i] = i % 256;

        return new Blob([buffer], { type: 'audio/wav' });
    };

    it('should concatenate two WAV blobs correctly', async () => {
        const blob1 = createMockWav(100);
        const blob2 = createMockWav(200);

        const result = await concatenateAudioBlobs([blob1, blob2]);

        expect(result).toBeDefined();
        expect(result.type).toBe('audio/wav');
        expect(result.size).toBe(44 + 100 + 200);

        const buffer = await result.arrayBuffer();
        const view = new DataView(buffer);
        expect(view.getUint32(0, false)).toBe(0x52494646); // "RIFF"
        expect(view.getUint32(40, true)).toBe(300); // New data size
    });

    it('should throw error if first blob is not valid WAV', async () => {
        // Create a blob that is clearly not WAV (no "RIFF" at 0)
        const invalidBlob = new Blob([new Uint8Array(100).fill(1)], { type: 'audio/wav' });
        await expect(concatenateAudioBlobs([invalidBlob, invalidBlob])).rejects.toThrow();
    });

    it('should clamp malformed data chunk size if it exceeds buffer length', async () => {
        const dataSize = 100;
        const malformedSize = 1000; // Larger than actual data
        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);

        // RIFF header
        view.setUint32(0, 0x52494646, false);
        view.setUint32(4, 36 + dataSize, true);
        view.setUint32(8, 0x57415645, false);

        // data chunk with INCORRECT size
        view.setUint32(36, 0x64617461, false); // "data"
        view.setUint32(40, malformedSize, true); // WRONG SIZE

        const blob = new Blob([buffer], { type: 'audio/wav' });

        // This should not throw anymore because of clamping
        const result = await concatenateAudioBlobs([blob, createMockWav(50)]);
        expect(result).toBeDefined();
        // Clamped size (100) + new data (50) + header (44) = 194
        expect(result.size).toBe(44 + 100 + 50);
    });

    it('should return the same blob if only one provided', async () => {
        const blob = createMockWav(50);
        const result = await concatenateAudioBlobs([blob]);
        expect(result).toBe(blob);
    });

    it('should handle odd data chunk sizes with padding (WAV spec)', async () => {
        const blob1 = createMockWav(101);
        const blob2 = createMockWav(100);

        const result = await concatenateAudioBlobs([blob1, blob2]);
        expect(result.size).toBe(44 + 101 + 100);
    });

    describe('createSilenceBlob', () => {
        it('should create a valid silent WAV blob (stereo by default)', async () => {
            const blob = await createSilenceBlob(500, 44100);
            expect(blob.type).toBe('audio/wav');
            // 0.5s * 44100 samples/s * 2 channels * 2 bytes/sample = 88200
            const expectedDataSize = 88200;
            expect(blob.size).toBe(44 + expectedDataSize);
        });
    });

    describe('insertSilenceBetweenBlobs', () => {
        it('should insert silence blobs between provided blobs', async () => {
            const blobs = [createMockWav(100), createMockWav(200)];
            const result = await insertSilenceBetweenBlobs(blobs, 500);
            expect(result).toHaveLength(3);
            expect(result[1].size).toBeGreaterThan(44);
        });

        it('should return original blobs if only one provided', async () => {
            const blobs = [createMockWav(100)];
            const result = await insertSilenceBetweenBlobs(blobs, 500);
            expect(result).toEqual(blobs);
        });
    });

    describe('blobToAudioBuffer', () => {
        it('should decode blob to audio buffer', async () => {
            const blob = createMockWav(100);
            mockDecodeAudioData.mockResolvedValue({ duration: 1 });
            const buffer = await blobToAudioBuffer(blob);
            expect(buffer).toBeDefined();
            expect(mockDecodeAudioData).toHaveBeenCalled();
        });
    });

    describe('audioBufferToWavBlob', () => {
        it('should encode audio buffer to wav blob', () => {
            const ctx = new AudioContext();
            const buffer = ctx.createBuffer(1, 44100, 44100);
            const blob = audioBufferToWavBlob(buffer);
            expect(blob.type).toBe('audio/wav');
            expect(blob.size).toBe(44 + 44100 * 2);
        });
    });
});
