/**
 * @jest-environment node
 */
import { parseBuffer } from 'music-metadata';
import { validateAudioDuration } from '@/utils/server/audioServerUtils';

// Mock audioRecorderConfig
jest.mock('@/utils/audioRecorderConfig', () => ({
    getTotalRecordingDuration: jest.fn(() => 93), // 90s + 3s grace
}));

const mockParseBuffer = parseBuffer as jest.Mock;

describe('audioServerUtils', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('validateAudioDuration', () => {
        it('should return valid for audio within duration limit', async () => {
            mockParseBuffer.mockResolvedValue({
                format: { duration: 90 },
            });

            const blob = new Blob(['test audio data'], { type: 'audio/webm' });
            const result = await validateAudioDuration(blob);

            expect(result.valid).toBe(true);
            expect(result.duration).toBe(90);
            expect(result.maxAllowed).toBe(95); // 93 + 2s offset
        });

        it('should return invalid for audio exceeding duration limit', async () => {
            mockParseBuffer.mockResolvedValue({
                format: { duration: 100 },
            });

            const blob = new Blob(['test audio data'], { type: 'audio/webm' });
            const result = await validateAudioDuration(blob);

            expect(result.valid).toBe(false);
            expect(result.duration).toBe(100);
            expect(result.error).toContain('exceeds maximum allowed');
        });

        it('should return valid when duration cannot be determined', async () => {
            mockParseBuffer.mockResolvedValue({
                format: { duration: undefined },
            });

            const blob = new Blob(['test audio data'], { type: 'audio/webm' });
            const result = await validateAudioDuration(blob);

            expect(result.valid).toBe(true);
            expect(result.duration).toBeUndefined();
        });

        it('should return valid on metadata parsing error', async () => {
            mockParseBuffer.mockRejectedValue(new Error('Parse error'));

            const blob = new Blob(['test audio data'], { type: 'audio/webm' });
            const result = await validateAudioDuration(blob);

            expect(result.valid).toBe(true);
            expect(result.maxAllowed).toBe(95);
        });
    });
});
