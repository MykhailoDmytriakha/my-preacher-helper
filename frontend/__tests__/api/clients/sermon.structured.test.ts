import {
  generateBrainstormSuggestionStructured,
  generatePlanPointContentStructured,
  generateSectionHintsStructured,
  generateSermonInsightsStructured,
  generateSermonPointsStructured,
  generateSermonTopicsStructured,
  generateSermonVersesStructured,
} from '@clients/sermon.structured';
import { Sermon } from '@/models/models';

jest.mock('@clients/openAIHelpers', () => ({
  extractSermonContent: jest.fn(() => 'sermon content'),
  extractSectionContent: jest.fn(() => 'section content'),
}));

jest.mock('@clients/structuredOutput', () => ({
  callWithStructuredOutput: jest.fn(),
}));

const mockCallWithStructuredOutput = () =>
  (jest.requireMock('@clients/structuredOutput') as { callWithStructuredOutput: jest.Mock }).callWithStructuredOutput;

const baseSermon: Sermon = {
  id: 'sermon-1',
  title: 'Test Sermon',
  verse: 'John 3:16',
  date: '2024-01-01',
  userId: 'user-1',
  thoughts: [{ id: 't-1', text: 'thought', tags: ['main'], date: '2024-01-01' }],
};

describe('sermon.structured', () => {
  let mockStructuredCall: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStructuredCall = mockCallWithStructuredOutput();
    mockStructuredCall.mockReset();
  });

  it('returns structured insights on success', async () => {
    mockStructuredCall.mockResolvedValue({
      success: true,
      data: { topics: ['Hope'], relatedVerses: [], possibleDirections: [] },
      refusal: null,
      error: null,
    });

    const result = await generateSermonInsightsStructured(baseSermon);

    expect(result?.topics).toEqual(['Hope']);
    expect(mockStructuredCall).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({
        formatName: 'sermon_insights',
        logContext: expect.objectContaining({ sermonId: baseSermon.id }),
      })
    );
  });

  it('returns null insights when structured call fails', async () => {
    mockStructuredCall.mockResolvedValue({ success: false, data: null, refusal: 'no', error: null });

    const result = await generateSermonInsightsStructured(baseSermon);

    expect(result).toBeNull();
  });

  it('returns topics on success', async () => {
    mockStructuredCall.mockResolvedValue({
      success: true,
      data: { topics: ['Grace', 'Faith'] },
      refusal: null,
      error: null,
    });

    const result = await generateSermonTopicsStructured(baseSermon);

    expect(result).toEqual(['Grace', 'Faith']);
  });

  it('returns empty topics when structured call fails', async () => {
    mockStructuredCall.mockResolvedValue({ success: false, data: null, refusal: null, error: new Error('x') });

    const result = await generateSermonTopicsStructured(baseSermon);

    expect(result).toEqual([]);
  });

  it('returns verses on success', async () => {
    mockStructuredCall.mockResolvedValue({
      success: true,
      data: { verses: [{ reference: 'John 3:16', relevance: 'Love' }] },
      refusal: null,
      error: null,
    });

    const result = await generateSermonVersesStructured(baseSermon);

    expect(result).toEqual([{ reference: 'John 3:16', relevance: 'Love' }]);
  });

  it('returns empty verses when structured call fails', async () => {
    mockStructuredCall.mockResolvedValue({ success: false, data: null, refusal: null, error: new Error('x') });

    const result = await generateSermonVersesStructured(baseSermon);

    expect(result).toEqual([]);
  });

  it('returns section hints on success', async () => {
    mockStructuredCall.mockResolvedValue({
      success: true,
      data: { introduction: 'Intro', main: 'Main', conclusion: 'End' },
      refusal: null,
      error: null,
    });

    const result = await generateSectionHintsStructured(baseSermon);

    expect(result).toEqual({ introduction: 'Intro', main: 'Main', conclusion: 'End' });
  });

  it('returns null section hints when structured call fails', async () => {
    mockStructuredCall.mockResolvedValue({ success: false, data: null, refusal: null, error: new Error('x') });

    const result = await generateSectionHintsStructured(baseSermon);

    expect(result).toBeNull();
  });

  it('returns generated outline points with ids and non-latin detection metadata', async () => {
    const nonLatinSermon = { ...baseSermon, title: 'Проповедь', verse: 'Иоанна 3:16' };
    mockStructuredCall.mockResolvedValue({
      success: true,
      data: { outlinePoints: [{ text: 'Пункт один' }, { text: 'Пункт два' }] },
      refusal: null,
      error: null,
    });

    const result = await generateSermonPointsStructured(nonLatinSermon, 'main');

    expect(result.success).toBe(true);
    expect(result.outlinePoints).toHaveLength(2);
    expect(result.outlinePoints[0].id).toMatch(/^op-/);
    expect(result.outlinePoints[0].text).toBe('Пункт один');
    expect(mockStructuredCall).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({
        formatName: 'sermon_points',
        logContext: expect.objectContaining({
          detectedLanguage: 'non-English (likely Russian/Ukrainian)',
        }),
      })
    );
  });

  it('returns empty outline points when structured call fails', async () => {
    mockStructuredCall.mockResolvedValue({ success: false, data: null, refusal: null, error: new Error('x') });

    const result = await generateSermonPointsStructured(baseSermon, 'main');

    expect(result).toEqual({ outlinePoints: [], success: false });
  });

  it('returns brainstorm suggestion with normalized type and generated id', async () => {
    mockStructuredCall.mockResolvedValue({
      success: true,
      data: { text: 'Try this', type: 'QUESTION' },
      refusal: null,
      error: null,
    });

    const result = await generateBrainstormSuggestionStructured(baseSermon);

    expect(result?.text).toBe('Try this');
    expect(result?.type).toBe('question');
    expect(result?.id).toMatch(/^bs-/);
  });

  it('returns null brainstorm suggestion when structured call fails', async () => {
    mockStructuredCall.mockResolvedValue({ success: false, data: null, refusal: null, error: new Error('x') });

    const result = await generateBrainstormSuggestionStructured(baseSermon);

    expect(result).toBeNull();
  });

  it('keeps plan point structured function as explicit fallback stub', async () => {
    const result = await generatePlanPointContentStructured(
      'Title',
      'John 3:16',
      'Point',
      ['Thought'],
      'main'
    );

    expect(result).toEqual({ content: '', success: false });
  });
});
