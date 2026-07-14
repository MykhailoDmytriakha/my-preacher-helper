import { submitFeedback } from '@/services/feedback.service';
import {
    MAX_FEEDBACK_PAYLOAD_BYTES,
    MAX_FEEDBACK_TEXT_BYTES,
} from '@/utils/feedbackPayload';

// Mock global fetch
global.fetch = jest.fn();

describe('feedback.service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ success: true }),
        });
    });

    test('submitFeedback calls fetch with correct parameters (all fields)', async () => {
        const text = 'Test feedback';
        const type = 'bug';
        const images = ['data:image/png;base64,123'];
        const userId = 'user123';

        await submitFeedback(text, type, images, userId);

        expect(global.fetch).toHaveBeenCalledWith('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-id-token' },
            body: JSON.stringify({
                feedbackText: text,
                feedbackType: type,
                images,
                userId
            })
        });
    });

    test('submitFeedback handles defaults (no images, no userId)', async () => {
        const text = 'Minimal feedback';
        const type = 'suggestion';

        await submitFeedback(text, type);

        expect(global.fetch).toHaveBeenCalledWith('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-id-token' },
            body: JSON.stringify({
                feedbackText: text,
                feedbackType: type,
                images: [],
                userId: 'anonymous'
            })
        });
    });

    test('submitFeedback throws error on non-ok response', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: false,
            json: jest.fn().mockResolvedValue({ error: 'Failed to submit' }),
        });

        await expect(submitFeedback('test', 'bug')).rejects.toThrow('Failed to submit');
    });

    test('submitFeedback uses default error message if none provided', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: false,
            json: jest.fn().mockResolvedValue({}),
        });

        await expect(submitFeedback('test', 'bug')).rejects.toThrow('Error submitting feedback');
    });

    test('submitFeedback rejects an oversized serialized payload before fetch', async () => {
        const twoMiBImage = `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024).toString('base64')}`;

        await expect(submitFeedback('Two accepted-size images', 'bug', [twoMiBImage, twoMiBImage])).rejects.toThrow(
            'Feedback payload is too large'
        );
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('submitFeedback rejects text too large for Firestore before fetch', async () => {
        const oversizedText = 'x'.repeat(MAX_FEEDBACK_TEXT_BYTES + 1);

        await expect(submitFeedback(oversizedText, 'bug')).rejects.toThrow(
            'Feedback text is too large'
        );
        expect(global.fetch).not.toHaveBeenCalled();
        expect(MAX_FEEDBACK_TEXT_BYTES).toBeLessThan(MAX_FEEDBACK_PAYLOAD_BYTES);
    });
});
