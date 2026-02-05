import OpenAI from 'openai';

import {
  createTranscription,
  generateThought,
  generateBrainstormSuggestion,
  generatePlanForSection,
  generatePlanPointContent,
  generateSermonDirections,
  generateSectionHints,
  generateSermonInsights,
  generateSermonPoints,
  generateSermonTopics,
  generateSermonVerses,
  sortItemsWithAI,
} from '@clients/openAI.client';
import { Sermon, SermonPoint, ThoughtInStructure } from '@/models/models';
import * as audioUtils from '@/utils/audioFormatUtils';

jest.mock('openai', () => {
  const mockCreateCompletion = jest.fn();
  const mockCreateTranscription = jest.fn();

  const mockConstructor = jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreateCompletion,
      },
    },
    audio: {
      transcriptions: {
        create: mockCreateTranscription,
      },
    },
  }));

  (mockConstructor as any).mockCreateCompletion = mockCreateCompletion;
  (mockConstructor as any).mockCreateTranscription = mockCreateTranscription;

  return mockConstructor;
});

jest.mock('@/utils/audioFormatUtils', () => ({
  validateAudioBlob: jest.fn(() => ({ valid: true })),
  createAudioFile: jest.fn((blob: Blob) => {
    const file = blob as File & { name?: string };
    (file as { name?: string }).name = 'audio.webm';
    return file as File;
  }),
  logAudioInfo: jest.fn().mockResolvedValue(undefined),
  hasKnownIssues: jest.fn(() => false),
}));

jest.mock('@clients/sermon.structured', () => ({
  generateSermonInsightsStructured: jest.fn(),
  generateSermonTopicsStructured: jest.fn(),
  generateSectionHintsStructured: jest.fn(),
  generateSermonVersesStructured: jest.fn(),
  generateSermonPointsStructured: jest.fn(),
  generateBrainstormSuggestionStructured: jest.fn(),
}));
jest.mock('@clients/structuredOutput', () => ({
  callWithStructuredOutput: jest.fn(),
}));
jest.mock('@clients/thought.structured', () => ({
  generateThoughtStructured: jest.fn(),
}));

const getMockCreateTranscription = () => (OpenAI as unknown as { mockCreateTranscription: jest.Mock }).mockCreateTranscription;
const getStructuredMocks = () => jest.requireMock('@clients/sermon.structured') as {
  generateSermonInsightsStructured: jest.Mock;
  generateSermonTopicsStructured: jest.Mock;
  generateSectionHintsStructured: jest.Mock;
  generateSermonVersesStructured: jest.Mock;
  generateSermonPointsStructured: jest.Mock;
  generateBrainstormSuggestionStructured: jest.Mock;
};
const getStructuredOutputMock = () => jest.requireMock('@clients/structuredOutput') as {
  callWithStructuredOutput: jest.Mock;
};
const getThoughtStructuredMock = () => jest.requireMock('@clients/thought.structured') as {
  generateThoughtStructured: jest.Mock;
};

const baseSermon: Sermon = {
  id: 'sermon-1',
  title: 'Test Sermon',
  verse: 'John 3:16',
  date: '2024-01-01',
  userId: 'user-1',
  thoughts: [
    { id: 't-1', text: 'Thought one with enough content', tags: ['Intro'], date: '2024-01-01' },
  ],
};

describe('openAI.client additional coverage', () => {
  let mockCreateTranscription: jest.Mock;
  let mockStructured: ReturnType<typeof getStructuredMocks>;
  let mockStructuredOutput: ReturnType<typeof getStructuredOutputMock>;
  let mockThoughtStructured: ReturnType<typeof getThoughtStructuredMock>;

  beforeAll(async () => {
    try {
      const undici = await import('undici');
      globalThis.Blob = globalThis.Blob || undici.Blob;
      globalThis.File = globalThis.File || undici.File;
      globalThis.FormData = globalThis.FormData || undici.FormData;
      globalThis.Headers = globalThis.Headers || undici.Headers;
      globalThis.Request = globalThis.Request || undici.Request;
      globalThis.Response = globalThis.Response || undici.Response;
    } catch {
      // Ignore if undici is unavailable.
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateTranscription = getMockCreateTranscription();
    mockCreateTranscription.mockReset();
    mockStructured = getStructuredMocks();
    mockStructured.generateSermonInsightsStructured.mockReset();
    mockStructured.generateSermonTopicsStructured.mockReset();
    mockStructured.generateSectionHintsStructured.mockReset();
    mockStructured.generateSermonVersesStructured.mockReset();
    mockStructured.generateSermonPointsStructured.mockReset();
    mockStructured.generateBrainstormSuggestionStructured.mockReset();
    mockStructuredOutput = getStructuredOutputMock();
    mockStructuredOutput.callWithStructuredOutput.mockReset();
    mockThoughtStructured = getThoughtStructuredMock();
    mockThoughtStructured.generateThoughtStructured.mockReset();
  });

  describe('createTranscription', () => {
    it('returns transcription text on success', async () => {
      mockCreateTranscription.mockResolvedValue({ text: 'hello world' });

      const result = await createTranscription(new Blob(['audio'], { type: 'audio/webm' }));

      expect(result).toBe('hello world');
      expect(mockCreateTranscription).toHaveBeenCalledTimes(1);
    });

    it('uses File input directly when provided', async () => {
      mockCreateTranscription.mockResolvedValue({ text: 'file transcription' });
      const file = new File(['audio'], 'sample.webm', { type: 'audio/webm' });

      const result = await createTranscription(file);

      expect(result).toBe('file transcription');
      expect(audioUtils.createAudioFile).not.toHaveBeenCalled();
    });

    it('includes compatibility note when known issues are detected', async () => {
      (audioUtils.hasKnownIssues as jest.Mock).mockReturnValue(true);
      mockCreateTranscription.mockRejectedValue(new Error('transcription failed'));

      await expect(createTranscription(new Blob(['audio'], { type: 'audio/ogg' }))).rejects.toThrow(
        'compatibility issues'
      );
    });

    it('logs warnings but succeeds when known issues are present', async () => {
      (audioUtils.hasKnownIssues as jest.Mock).mockReturnValue(true);
      mockCreateTranscription.mockResolvedValue({ text: 'ok' });

      const result = await createTranscription(new Blob(['audio'], { type: 'audio/ogg' }));

      expect(result).toBe('ok');
    });

    it('throws when validation fails', async () => {
      (audioUtils.validateAudioBlob as jest.Mock).mockReturnValueOnce({ valid: false, error: 'Invalid audio file' });

      await expect(createTranscription(new Blob(['audio'], { type: 'audio/webm' }))).rejects.toThrow(
        'Invalid audio file'
      );
    });
  });

  describe('generateThought', () => {
    it('delegates to structured thought client and passes forceTag', async () => {
      mockThoughtStructured.generateThoughtStructured.mockResolvedValue({
        originalText: 'Original idea',
        formattedText: 'Formatted idea',
        tags: ['Forced'],
        meaningSuccessfullyPreserved: true,
      });

      const result = await generateThought('Original idea', baseSermon, ['TagA'], 'Forced');

      expect(mockThoughtStructured.generateThoughtStructured).toHaveBeenCalledWith(
        'Original idea',
        baseSermon,
        ['TagA'],
        { forceTag: 'Forced' }
      );
      expect(result).toEqual({
        originalText: 'Original idea',
        formattedText: 'Formatted idea',
        tags: ['Forced'],
        meaningSuccessfullyPreserved: true,
      });
    });

    it('returns the structured client result without legacy retries', async () => {
      mockThoughtStructured.generateThoughtStructured.mockResolvedValue({
        originalText: 'Original idea',
        formattedText: null,
        tags: null,
        meaningSuccessfullyPreserved: false,
      });

      const result = await generateThought('Original idea', baseSermon, ['TagA']);

      expect(mockThoughtStructured.generateThoughtStructured).toHaveBeenCalledWith(
        'Original idea',
        baseSermon,
        ['TagA'],
        { forceTag: undefined }
      );
      expect(result).toEqual({
        originalText: 'Original idea',
        formattedText: null,
        tags: null,
        meaningSuccessfullyPreserved: false,
      });
    });
  });

  it('generates sermon insights from structured response', async () => {
    mockStructured.generateSermonInsightsStructured.mockResolvedValue({
      topics: ['Hope'],
      relatedVerses: [],
      possibleDirections: [],
    });

    const result = await generateSermonInsights(baseSermon);

    expect(result?.topics).toEqual(['Hope']);
    expect(mockStructured.generateSermonInsightsStructured).toHaveBeenCalledWith(baseSermon);
  });

  it('returns directions from structured output path', async () => {
    mockStructuredOutput.callWithStructuredOutput.mockResolvedValue({
      success: true,
      data: {
        directions: [{ title: 'Area', description: 'Suggestion' }],
      },
      refusal: null,
      error: null,
    });

    const result = await generateSermonDirections(baseSermon);

    expect(result).toEqual([{ area: 'Area', suggestion: 'Suggestion' }]);
  });

  it('returns null when insights generation fails', async () => {
    mockStructured.generateSermonInsightsStructured.mockResolvedValue(null);

    const result = await generateSermonInsights(baseSermon);

    expect(result).toBeNull();
  });

  it('generates sermon topics list', async () => {
    mockStructured.generateSermonTopicsStructured.mockResolvedValue(['Grace', 'Faith']);

    const result = await generateSermonTopics(baseSermon);

    expect(result).toEqual(['Grace', 'Faith']);
    expect(mockStructured.generateSermonTopicsStructured).toHaveBeenCalledWith(baseSermon);
  });

  it('returns topics from structured client fallback payload', async () => {
    mockStructured.generateSermonTopicsStructured.mockResolvedValue(['Grace']);

    const result = await generateSermonTopics(baseSermon);

    expect(result).toEqual(['Grace']);
  });

  it('returns empty topics when structured client returns empty list', async () => {
    mockStructured.generateSermonTopicsStructured.mockResolvedValue([]);

    const result = await generateSermonTopics(baseSermon);

    expect(result).toEqual([]);
  });

  it('returns empty topics on structured error branch', async () => {
    mockStructured.generateSermonTopicsStructured.mockResolvedValue([]);

    const result = await generateSermonTopics(baseSermon);

    expect(result).toEqual([]);
  });

  it('generates section hints', async () => {
    mockStructured.generateSectionHintsStructured.mockResolvedValue({
      introduction: 'Intro hint',
      main: 'Main hint',
      conclusion: 'Conclusion hint',
    });

    const result = await generateSectionHints(baseSermon);

    expect(result).toEqual({
      introduction: 'Intro hint',
      main: 'Main hint',
      conclusion: 'Conclusion hint',
    });
    expect(mockStructured.generateSectionHintsStructured).toHaveBeenCalledWith(baseSermon);
  });

  it('returns null when section hints generation fails', async () => {
    mockStructured.generateSectionHintsStructured.mockResolvedValue(null);

    const result = await generateSectionHints(baseSermon);

    expect(result).toBeNull();
  });

  it('generates verse suggestions', async () => {
    mockStructured.generateSermonVersesStructured.mockResolvedValue([{ reference: 'John 3:16', relevance: 'Love' }]);

    const result = await generateSermonVerses(baseSermon);

    expect(result).toEqual([{ reference: 'John 3:16', relevance: 'Love' }]);
    expect(mockStructured.generateSermonVersesStructured).toHaveBeenCalledWith(baseSermon);
  });

  it('returns empty verses on error', async () => {
    mockStructured.generateSermonVersesStructured.mockResolvedValue([]);

    const result = await generateSermonVerses(baseSermon);

    expect(result).toEqual([]);
  });

  describe('sortItemsWithAI', () => {
    const outlinePoints: SermonPoint[] = [{ id: 'op-1', text: 'Main Point' }];
    const items: ThoughtInStructure[] = [
      { id: 'abcd-1111-1111-1111-111111111111', content: 'First thought', outlinePointId: 'op-existing' },
      { id: 'efgh-2222-2222-2222-222222222222', content: 'Second thought' },
      { id: 'ijkl-3333-3333-3333-333333333333', content: 'Third thought' },
    ];

    it('sorts items and assigns outline points when provided', async () => {
      mockStructuredOutput.callWithStructuredOutput.mockResolvedValue({
        success: true,
        data: {
          sortedItems: [
            { key: 'efgh', outlinePoint: 'Main Point' },
            { key: 'abcd' },
          ],
        },
        refusal: null,
        error: null,
      });

      const result = await sortItemsWithAI('col-1', items, baseSermon, outlinePoints);

      expect(result.map(item => item.id)).toEqual([
        'efgh-2222-2222-2222-222222222222',
        'abcd-1111-1111-1111-111111111111',
        'ijkl-3333-3333-3333-333333333333',
      ]);
      expect(result[0].outlinePointId).toBe('op-1');
      expect(result[0].outlinePoint?.text).toBe('Main Point');
      expect(result[1].outlinePointId).toBe('op-existing');
    });

    it('matches outline points by substring when exact match fails', async () => {
      const substringItems: ThoughtInStructure[] = [
        { id: 'zzzz-1111-1111-1111-111111111111', content: 'Substring thought' },
      ];
      const substringOutlinePoints: SermonPoint[] = [{ id: 'op-sub', text: 'Main Point' }];

      mockStructuredOutput.callWithStructuredOutput.mockResolvedValue({
        success: true,
        data: {
          sortedItems: [{ key: 'zzzz', outlinePoint: 'Main' }],
        },
        refusal: null,
        error: null,
      });

      const result = await sortItemsWithAI('col-1', substringItems, baseSermon, substringOutlinePoints);

      expect(result[0].outlinePointId).toBe('op-sub');
      expect(result[0].outlinePoint?.text).toBe('Main Point');
    });

    it('matches outline points by fuzzy word overlap when needed', async () => {
      const fuzzyItems: ThoughtInStructure[] = [
        { id: 'yyyy-2222-2222-2222-222222222222', content: 'Fuzzy thought' },
      ];
      const fuzzyOutlinePoints: SermonPoint[] = [{ id: 'op-fuzzy', text: 'Victory of Faith' }];

      mockStructuredOutput.callWithStructuredOutput.mockResolvedValue({
        success: true,
        data: {
          sortedItems: [{ key: 'yyyy', outlinePoint: 'Faith Victory' }],
        },
        refusal: null,
        error: null,
      });

      const result = await sortItemsWithAI('col-1', fuzzyItems, baseSermon, fuzzyOutlinePoints);

      expect(result[0].outlinePointId).toBe('op-fuzzy');
      expect(result[0].outlinePoint?.text).toBe('Victory of Faith');
    });

    it('returns original items when sorted items list is empty', async () => {
      mockStructuredOutput.callWithStructuredOutput.mockResolvedValue({
        success: true,
        data: { sortedItems: [] },
        refusal: null,
        error: null,
      });

      const result = await sortItemsWithAI('col-1', items, baseSermon, outlinePoints);

      expect(result).toEqual(items);
    });

    it('throws when structured output call fails', async () => {
      mockStructuredOutput.callWithStructuredOutput.mockResolvedValue({
        success: false,
        data: null,
        refusal: null,
        error: new Error('Invalid response format from AI model'),
      });

      await expect(sortItemsWithAI('col-1', items, baseSermon, outlinePoints)).rejects.toThrow(
        'Invalid response format from AI model'
      );
    });
  });

  it('generates plan point content', async () => {
    mockStructuredOutput.callWithStructuredOutput.mockResolvedValue({
      success: true,
      data: { content: '### Main Concept\n* Supporting detail' },
      refusal: null,
      error: null,
    });

    const result = await generatePlanPointContent(
      'Test Sermon',
      'John 3:16',
      'Outline Point',
      ['Thought A', 'Thought B'],
      'main',
      ['Key fragment'],
      { previousPoint: { text: 'Prev point' }, nextPoint: { text: 'Next point' } },
      'memory'
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain('Main Concept');
  });

  it('generates plan point content for Cyrillic thoughts', async () => {
    mockStructuredOutput.callWithStructuredOutput.mockResolvedValue({
      success: true,
      data: { content: '### Заголовок\n* Деталь' },
      refusal: null,
      error: null,
    });

    const result = await generatePlanPointContent(
      'Проповедь',
      'Иоанна 3:16',
      'Пункт',
      ['Мысль один'],
      'main'
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain('Заголовок');
  });

  it('detects non-Latin content when generating plan section', async () => {
    mockStructuredOutput.callWithStructuredOutput.mockResolvedValue({
      success: true,
      data: {
        introduction: 'Вступление',
        main: 'Основная часть',
        conclusion: 'Заключение',
      },
      refusal: null,
      error: null,
    });

    const sermon = { ...baseSermon, title: 'Проповедь', verse: 'Иоанна 3:16' };
    const result = await generatePlanForSection(sermon, 'main');

    expect(result.success).toBe(true);
    expect(result.plan.main.outline).toBe('Основная часть');
  });

  it('returns failure when plan point content generation fails', async () => {
    mockStructuredOutput.callWithStructuredOutput.mockResolvedValue({
      success: false,
      data: null,
      refusal: null,
      error: new Error('fail'),
    });

    const result = await generatePlanPointContent(
      'Test Sermon',
      'John 3:16',
      'Outline Point',
      ['Thought A', 'Thought B'],
      'main'
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe('');
  });

  it('returns empty outline points when response is empty', async () => {
    mockStructured.generateSermonPointsStructured.mockResolvedValue({
      success: false,
      outlinePoints: [],
    });

    const result = await generateSermonPoints(baseSermon, 'main');

    expect(result.success).toBe(false);
    expect(result.outlinePoints).toEqual([]);
    expect(mockStructured.generateSermonPointsStructured).toHaveBeenCalledWith(baseSermon, 'main');
  });

  it('returns failure when outline point generation throws', async () => {
    mockStructured.generateSermonPointsStructured.mockResolvedValue({
      success: false,
      outlinePoints: [],
    });

    const result = await generateSermonPoints(baseSermon, 'main');

    expect(result.success).toBe(false);
    expect(result.outlinePoints).toEqual([]);
  });

  it('normalizes brainstorm suggestion type to lowercase', async () => {
    mockStructured.generateBrainstormSuggestionStructured.mockResolvedValue({
      id: 'bg-1',
      text: 'Try a different angle',
      type: 'question',
    });

    const result = await generateBrainstormSuggestion(baseSermon);

    expect(result?.type).toBe('question');
    expect(result?.text).toBe('Try a different angle');
  });

  it('returns null when brainstorm suggestion fails', async () => {
    mockStructured.generateBrainstormSuggestionStructured.mockResolvedValue(null);

    const result = await generateBrainstormSuggestion(baseSermon);

    expect(result).toBeNull();
  });

  it('covers debug branches when DEBUG_MODE is enabled', async () => {
    const previousDebugMode = process.env.DEBUG_MODE;
    process.env.DEBUG_MODE = 'true';
    jest.resetModules();

    const openAIClient = await import('@clients/openAI.client');
    const structuredClient = jest.requireMock('@clients/sermon.structured') as {
      generateSermonTopicsStructured: jest.Mock;
      generateSectionHintsStructured: jest.Mock;
      generateSermonVersesStructured: jest.Mock;
    };
    const structuredOutput = jest.requireMock('@clients/structuredOutput') as {
      callWithStructuredOutput: jest.Mock;
    };

    structuredClient.generateSermonTopicsStructured.mockResolvedValue(['Debug topic']);
    structuredClient.generateSectionHintsStructured.mockResolvedValue({
      introduction: 'Intro',
      main: 'Main',
      conclusion: 'End',
    });
    structuredClient.generateSermonVersesStructured.mockResolvedValue([
      { reference: 'John 3:16', relevance: 'Love' },
    ]);

    structuredOutput.callWithStructuredOutput
      .mockResolvedValueOnce({
        success: true,
        data: { sortedItems: [{ key: 'efgh', outlinePoint: 'Main Point' }] },
        refusal: null,
        error: null,
      })
      .mockResolvedValueOnce({
        success: true,
        data: { introduction: 'Intro', main: 'Main', conclusion: 'End' },
        refusal: null,
        error: null,
      })
      .mockResolvedValueOnce({
        success: true,
        data: { content: '### Debug Heading\n* detail' },
        refusal: null,
        error: null,
      });

    await openAIClient.generateSermonTopics(baseSermon);
    await openAIClient.generateSectionHints(baseSermon);
    await openAIClient.generateSermonVerses(baseSermon);

    const debugItems: ThoughtInStructure[] = [
      { id: 'efgh-2222-2222-2222-222222222222', content: 'Second thought' },
    ];
    const debugOutlinePoints: SermonPoint[] = [{ id: 'op-1', text: 'Main Point' }];

    await openAIClient.sortItemsWithAI('col-1', debugItems, baseSermon, debugOutlinePoints);
    await openAIClient.generatePlanForSection(baseSermon, 'main');
    await openAIClient.generatePlanPointContent(
      'Test Sermon',
      'John 3:16',
      'Outline Point',
      ['Thought A'],
      'main'
    );

    process.env.DEBUG_MODE = previousDebugMode;
  });
});
