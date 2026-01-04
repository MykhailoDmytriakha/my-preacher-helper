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
import { BrainstormSuggestion, Sermon, SermonPoint, ThoughtInStructure } from '@/models/models';
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

const getMockCreateCompletion = () => (OpenAI as unknown as { mockCreateCompletion: jest.Mock }).mockCreateCompletion;
const getMockCreateTranscription = () => (OpenAI as unknown as { mockCreateTranscription: jest.Mock }).mockCreateTranscription;

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
  let mockCreateCompletion: jest.Mock;
  let mockCreateTranscription: jest.Mock;

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
    mockCreateCompletion = getMockCreateCompletion();
    mockCreateTranscription = getMockCreateTranscription();
    mockCreateCompletion.mockReset();
    mockCreateTranscription.mockReset();
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
    it('returns success and applies force tag when meaning is preserved', async () => {
      mockCreateCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                originalText: 'Original idea',
                formattedText: 'Formatted idea',
                tags: ['TagA', 'TagB'],
                meaningPreserved: true,
              }),
            },
          },
        ],
      });

      const result = await generateThought('Original idea', baseSermon, ['TagA'], 'Forced');

      expect(result).toEqual({
        originalText: 'Original idea',
        formattedText: 'Formatted idea',
        tags: ['Forced'],
        meaningSuccessfullyPreserved: true,
      });
    });

    it('returns failure when response structure is invalid', async () => {
      mockCreateCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                originalText: 'Original idea',
                formattedText: '',
                tags: ['TagA'],
                meaningPreserved: true,
              }),
            },
          },
        ],
      });

      const result = await generateThought('Original idea', baseSermon, ['TagA']);

      expect(result).toEqual({
        originalText: 'Original idea',
        formattedText: null,
        tags: null,
        meaningSuccessfullyPreserved: false,
      });
    });

    it('retries when meaning is not preserved and returns failure after max retries', async () => {
      jest.useFakeTimers();
      try {
        mockCreateCompletion.mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  originalText: 'Original idea',
                  formattedText: 'Formatted idea',
                  tags: ['TagA'],
                  meaningPreserved: false,
                }),
              },
            },
          ],
        });

        const promise = generateThought('Original idea', baseSermon, ['TagA']);
        await jest.runAllTimersAsync();
        const result = await promise;

        expect(mockCreateCompletion).toHaveBeenCalledTimes(3);
        expect(result).toEqual({
          originalText: 'Original idea',
          formattedText: null,
          tags: null,
          meaningSuccessfullyPreserved: false,
        });
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it('generates sermon insights from structured response', async () => {
    mockCreateCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              topics: ['Hope'],
              relatedVerses: [],
              possibleDirections: [],
            }),
          },
        },
      ],
    });

    const result = await generateSermonInsights(baseSermon);

    expect(result?.topics).toEqual(['Hope']);
  });

  it('handles function_call responses in logging path', async () => {
    mockCreateCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: '',
            function_call: {
              arguments: JSON.stringify({ directions: [] }),
            },
          },
        },
      ],
    });

    const result = await generateSermonDirections(baseSermon);

    expect(result).toEqual([]);
  });

  it('returns null when insights generation fails', async () => {
    mockCreateCompletion.mockRejectedValue(new Error('fail'));

    const result = await generateSermonInsights(baseSermon);

    expect(result).toBeNull();
  });

  it('generates sermon topics list', async () => {
    mockCreateCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ topics: ['Grace', 'Faith'] }),
          },
        },
      ],
    });

    const result = await generateSermonTopics(baseSermon);

    expect(result).toEqual(['Grace', 'Faith']);
  });

  it('parses topics from <arguments> tag responses', async () => {
    mockCreateCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: '<arguments>{"topics":["Grace"]}</arguments>',
          },
        },
      ],
    });

    const result = await generateSermonTopics(baseSermon);

    expect(result).toEqual(['Grace']);
  });

  it('falls back to code block JSON when <arguments> contains schema', async () => {
    mockCreateCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: '<arguments>{"type":"object","properties":{"topics":{"type":"array"}}}</arguments>\n```json\n{"topics":["Faith"]}\n```',
          },
        },
      ],
    });

    const result = await generateSermonTopics(baseSermon);

    expect(result).toEqual(['Faith']);
  });

  it('extracts embedded JSON when content includes surrounding text', async () => {
    mockCreateCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Here is the result: {"topics":["Hope"]} Thanks!',
          },
        },
      ],
    });

    const result = await generateSermonTopics(baseSermon);

    expect(result).toEqual(['Hope']);
  });

  it('returns empty topics on error', async () => {
    mockCreateCompletion.mockRejectedValue(new Error('fail'));

    const result = await generateSermonTopics(baseSermon);

    expect(result).toEqual([]);
  });

  it('generates section hints', async () => {
    mockCreateCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              introduction: 'Intro hint',
              main: 'Main hint',
              conclusion: 'Conclusion hint',
            }),
          },
        },
      ],
    });

    const result = await generateSectionHints(baseSermon);

    expect(result).toEqual({
      introduction: 'Intro hint',
      main: 'Main hint',
      conclusion: 'Conclusion hint',
    });
  });

  it('returns null when section hints generation fails', async () => {
    mockCreateCompletion.mockRejectedValue(new Error('fail'));

    const result = await generateSectionHints(baseSermon);

    expect(result).toBeNull();
  });

  it('generates verse suggestions', async () => {
    mockCreateCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              verses: [{ reference: 'John 3:16', relevance: 'Love' }],
            }),
          },
        },
      ],
    });

    const result = await generateSermonVerses(baseSermon);

    expect(result).toEqual([{ reference: 'John 3:16', relevance: 'Love' }]);
  });

  it('returns empty verses on error', async () => {
    mockCreateCompletion.mockRejectedValue(new Error('fail'));

    const result = await generateSermonVerses(baseSermon);

    expect(result).toEqual([]);
  });

  describe('sortItemsWithAI', () => {
    const outlinePoints: SermonPoint[] = [{ id: 'op-1', text: 'Main Point' }];
    const items: ThoughtInStructure[] = [
      { id: 'abcd-1111-1111-1111-111111111111', content: 'First thought', section: 'introduction', outlinePointId: 'op-existing' },
      { id: 'efgh-2222-2222-2222-222222222222', content: 'Second thought', section: 'main' },
      { id: 'ijkl-3333-3333-3333-333333333333', content: 'Third thought', section: 'main' },
    ];

    it('sorts items and assigns outline points when provided', async () => {
      mockCreateCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                sortedItems: [
                  { key: 'efgh', outlinePoint: 'Main Point' },
                  { key: 'abcd' },
                ],
              }),
            },
          },
        ],
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
        { id: 'zzzz-1111-1111-1111-111111111111', content: 'Substring thought', section: 'main' },
      ];
      const substringOutlinePoints: SermonPoint[] = [{ id: 'op-sub', text: 'Main Point' }];

      mockCreateCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                sortedItems: [{ key: 'zzzz', outlinePoint: 'Main' }],
              }),
            },
          },
        ],
      });

      const result = await sortItemsWithAI('col-1', substringItems, baseSermon, substringOutlinePoints);

      expect(result[0].outlinePointId).toBe('op-sub');
      expect(result[0].outlinePoint?.text).toBe('Main Point');
    });

    it('matches outline points by fuzzy word overlap when needed', async () => {
      const fuzzyItems: ThoughtInStructure[] = [
        { id: 'yyyy-2222-2222-2222-222222222222', content: 'Fuzzy thought', section: 'main' },
      ];
      const fuzzyOutlinePoints: SermonPoint[] = [{ id: 'op-fuzzy', text: 'Victory of Faith' }];

      mockCreateCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                sortedItems: [{ key: 'yyyy', outlinePoint: 'Faith Victory' }],
              }),
            },
          },
        ],
      });

      const result = await sortItemsWithAI('col-1', fuzzyItems, baseSermon, fuzzyOutlinePoints);

      expect(result[0].outlinePointId).toBe('op-fuzzy');
      expect(result[0].outlinePoint?.text).toBe('Victory of Faith');
    });

    it('returns original items when response is malformed', async () => {
      mockCreateCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({ sortedItems: 'invalid' }),
            },
          },
        ],
      });

      const result = await sortItemsWithAI('col-1', items, baseSermon, outlinePoints);

      expect(result).toEqual(items);
    });

    it('throws when response JSON is invalid', async () => {
      mockCreateCompletion.mockResolvedValue({
        choices: [
          {
            message: {
              content: 'not-json',
            },
          },
        ],
      });

      await expect(sortItemsWithAI('col-1', items, baseSermon, outlinePoints)).rejects.toThrow(
        'Invalid response format from AI model'
      );
    });
  });

  it('generates plan point content', async () => {
    mockCreateCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: '### Main Concept\n* Supporting detail',
          },
        },
      ],
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
    mockCreateCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: '### Заголовок\n* Деталь',
          },
        },
      ],
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
    mockCreateCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              introduction: 'Вступление',
              main: 'Основная часть',
              conclusion: 'Заключение',
            }),
          },
        },
      ],
    });

    const sermon = { ...baseSermon, title: 'Проповедь', verse: 'Иоанна 3:16' };
    const result = await generatePlanForSection(sermon, 'main');

    expect(result.success).toBe(true);
    expect(result.plan.main.outline).toBe('Основная часть');
  });

  it('returns failure when plan point content generation fails', async () => {
    mockCreateCompletion.mockRejectedValue(new Error('fail'));

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
    mockCreateCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: '',
          },
        },
      ],
    });

    const result = await generateSermonPoints(baseSermon, 'main');

    expect(result.success).toBe(false);
    expect(result.outlinePoints).toEqual([]);
  });

  it('returns failure when outline point generation throws', async () => {
    mockCreateCompletion.mockRejectedValue(new Error('fail'));

    const result = await generateSermonPoints(baseSermon, 'main');

    expect(result.success).toBe(false);
    expect(result.outlinePoints).toEqual([]);
  });

  it('normalizes brainstorm suggestion type to lowercase', async () => {
    mockCreateCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              suggestion: {
                text: 'Try a different angle',
                type: 'Question',
              } as Omit<BrainstormSuggestion, 'id'>,
            }),
          },
        },
      ],
    });

    const result = await generateBrainstormSuggestion(baseSermon);

    expect(result?.type).toBe('question');
    expect(result?.text).toBe('Try a different angle');
  });

  it('returns null when brainstorm suggestion fails', async () => {
    mockCreateCompletion.mockRejectedValue(new Error('fail'));

    const result = await generateBrainstormSuggestion(baseSermon);

    expect(result).toBeNull();
  });

  it('covers debug branches when DEBUG_MODE is enabled', async () => {
    const previousDebugMode = process.env.DEBUG_MODE;
    process.env.DEBUG_MODE = 'true';
    jest.resetModules();

    const openAIModule = await import('openai');
    const openAIClient = await import('@clients/openAI.client');
    mockCreateCompletion = (openAIModule as unknown as { mockCreateCompletion: jest.Mock }).mockCreateCompletion;
    mockCreateCompletion.mockReset();

    mockCreateCompletion
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({ topics: ['Debug topic'] }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                introduction: 'Intro',
                main: 'Main',
                conclusion: 'End',
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verses: [{ reference: 'John 3:16', relevance: 'Love' }],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                sortedItems: [{ key: 'efgh', outlinePoint: 'Main Point' }],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                introduction: 'Intro',
                main: 'Main',
                conclusion: 'End',
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '### Debug Heading\n* detail',
            },
          },
        ],
      });

    await openAIClient.generateSermonTopics(baseSermon);
    await openAIClient.generateSectionHints(baseSermon);
    await openAIClient.generateSermonVerses(baseSermon);

    const debugItems: ThoughtInStructure[] = [
      { id: 'efgh-2222-2222-2222-222222222222', content: 'Second thought', section: 'main' },
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
