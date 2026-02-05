import { generateSermonDirections } from '@clients/openAI.client';
import { Sermon } from '@/models/models';

jest.mock('@clients/structuredOutput', () => ({
  callWithStructuredOutput: jest.fn(),
}));

const getStructuredOutputMock = () => jest.requireMock('@clients/structuredOutput') as {
  callWithStructuredOutput: jest.Mock;
};

describe('openAI.client', () => {
  const mockSermon: Sermon = {
    id: 'test-sermon-123',
    title: 'Test Sermon',
    userId: 'user-1',
    date: new Date().toISOString(),
    verse: 'John 3:16',
    thoughts: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getStructuredOutputMock().callWithStructuredOutput.mockReset();
  });

  describe('generateSermonDirections', () => {
    it('maps title/description to area/suggestion', async () => {
      getStructuredOutputMock().callWithStructuredOutput.mockResolvedValue({
        success: true,
        data: {
          directions: [
            { title: 'Theology', description: 'Explore deeper.', examples: ['Trace context'] },
            { title: 'History', description: 'Check sources.' },
          ],
        },
        refusal: null,
        error: null,
      });

      const result = await generateSermonDirections(mockSermon);

      expect(result).toEqual([
        { area: 'Theology', suggestion: 'Explore deeper.', examples: ['Trace context'] },
        { area: 'History', suggestion: 'Check sources.' },
      ]);
    });

    it('returns empty array when structured call fails', async () => {
      getStructuredOutputMock().callWithStructuredOutput.mockResolvedValue({
        success: false,
        data: null,
        refusal: null,
        error: new Error('AI API Failed'),
      });

      const result = await generateSermonDirections(mockSermon);
      expect(result).toEqual([]);
    });

    it('returns empty array when structured call refuses', async () => {
      getStructuredOutputMock().callWithStructuredOutput.mockResolvedValue({
        success: false,
        data: null,
        refusal: 'refused',
        error: null,
      });

      const result = await generateSermonDirections(mockSermon);
      expect(result).toEqual([]);
    });
  });
});
