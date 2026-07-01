/**
 * Tests the transition-generation client: it aligns the model's `bridges` array to
 * the sermon parts by order (keyed by segment id), trims, and — critically — degrades
 * gracefully. Transitions are additive, so any failure (refusal, no data, thrown error)
 * must yield EMPTY transitions rather than break the audio export.
 *
 * The structured-output layer is mocked so no network/API key is needed.
 */

// Mock the LLM layer before importing the client.
const mockCall = jest.fn();
jest.mock('@/api/clients/structuredOutput', () => ({
    callWithStructuredOutput: (...args: unknown[]) => mockCall(...args),
    getCurrentAIProvider: () => 'GEMINI',
}));

import { generateSermonTransitions } from '@/api/clients/sermonTransitions.client';
import { EMPTY_TRANSITIONS, type TransitionSegment } from '@/api/services/sermonTransitions';

import type { Sermon } from '@/models/models';

const sermon = { id: 's1', title: 'God is faithful', verse: 'Gen 45:4-8' } as Sermon;

const segments: TransitionSegment[] = [
    { id: 'a', section: 'introduction', title: 'Opening' },
    { id: 'b', section: 'mainPart', title: 'God remembers' },
    { id: 'c', section: 'conclusion', title: 'Trust Him' },
];

beforeEach(() => mockCall.mockReset());

describe('generateSermonTransitions', () => {
    it('maps bridges to segment ids by order and trims', async () => {
        mockCall.mockResolvedValue({
            success: true,
            data: { intro: '  Welcome.  ', bridges: ['Lead a', 'Lead b', 'Lead c'], outro: ' Amen. ' },
            refusal: null,
            error: null,
        });

        const result = await generateSermonTransitions(sermon, segments);

        expect(result).toEqual({
            intro: 'Welcome.',
            outro: 'Amen.',
            bridges: { a: 'Lead a', b: 'Lead b', c: 'Lead c' },
        });
    });

    it('skips blank bridges and ignores extras beyond the parts', async () => {
        mockCall.mockResolvedValue({
            success: true,
            data: { intro: 'I', bridges: ['', '  ', 'Lead c', 'EXTRA'], outro: 'O' },
            refusal: null,
            error: null,
        });

        const result = await generateSermonTransitions(sermon, segments);

        expect(result.bridges).toEqual({ c: 'Lead c' }); // a/b blank → absent; EXTRA has no part
    });

    it('returns EMPTY transitions when the model refuses / returns no data', async () => {
        mockCall.mockResolvedValue({ success: false, data: null, refusal: 'no', error: null });
        await expect(generateSermonTransitions(sermon, segments)).resolves.toEqual(EMPTY_TRANSITIONS);
    });

    it('returns EMPTY transitions when the call throws (LLM unavailable)', async () => {
        mockCall.mockRejectedValue(new Error('network down'));
        await expect(generateSermonTransitions(sermon, segments)).resolves.toEqual(EMPTY_TRANSITIONS);
    });

    it('does not call the model when there are no parts', async () => {
        const result = await generateSermonTransitions(sermon, []);
        expect(result).toEqual(EMPTY_TRANSITIONS);
        expect(mockCall).not.toHaveBeenCalled();
    });
});
