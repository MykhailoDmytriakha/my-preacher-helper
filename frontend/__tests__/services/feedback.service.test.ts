import { submitFeedback } from '@/services/feedback.service';

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
            headers: { 'Content-Type': 'application/json' },
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
            headers: { 'Content-Type': 'application/json' },
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
});
