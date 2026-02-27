import { SpeechOptimizationResponseSchema } from '@/config/schemas/zod';
import {
  filterTextBySections,
  getSystemPrompt,
  optimizeTextForSpeech,
} from '@/api/clients/speechOptimization.client';
import { buildSimplePromptBlueprint } from '@/api/clients/promptBuilder';
import { callWithStructuredOutput } from '@/api/clients/structuredOutput';

import type { Sermon } from '@/models/models';

jest.mock('@/api/clients/promptBuilder', () => ({
  buildSimplePromptBlueprint: jest.fn(),
}));

jest.mock('@/api/clients/structuredOutput', () => ({
  callWithStructuredOutput: jest.fn(),
}));

const sermon: Sermon = {
  id: 'sermon-1',
  title: 'Grace in Trials',
  verse: 'James 1:2-4',
  date: '2026-02-27',
  userId: 'user-1',
  thoughts: [],
};

describe('speechOptimization client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (buildSimplePromptBlueprint as jest.Mock).mockImplementation((input: Record<string, unknown>) => ({
      ...input,
      systemPrompt: 'SYSTEM_PROMPT',
      userMessage: 'USER_PROMPT',
    }));
  });

  it('builds the optimization prompt and returns structured output chunks', async () => {
    (callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        chunks: ['Начнем с надежды.', 'Далее посмотрим на терпение.'],
      },
      refusal: null,
      error: null,
    });

    const result = await optimizeTextForSpeech(
      '## Raw sermon markdown',
      sermon,
      {
        sermonTitle: sermon.title,
        scriptureVerse: sermon.verse,
        sections: 'introduction',
        previousContext: 'Earlier section ended in hope.',
      }
    );

    expect(buildSimplePromptBlueprint).toHaveBeenCalledWith(
      expect.objectContaining({
        promptName: 'speech_optimization',
        promptVersion: 'v1',
        context: expect.objectContaining({
          sermonTitle: sermon.title,
          scriptureVerse: sermon.verse,
          section: 'introduction',
          previousContextLength: 'Earlier section ended in hope.'.length,
          inputTextLength: '## Raw sermon markdown'.length,
        }),
      })
    );

    const blueprintArg = (buildSimplePromptBlueprint as jest.Mock).mock.calls[0][0];
    expect(blueprintArg.userMessage).toContain(`Sermon title: "${sermon.title}"`);
    expect(blueprintArg.userMessage).toContain(`Main scripture: ${sermon.verse}`);
    expect(blueprintArg.userMessage).toContain('Earlier section ended in hope.');
    expect(blueprintArg.userMessage).toContain('## Raw sermon markdown');

    expect(callWithStructuredOutput).toHaveBeenCalledWith(
      'SYSTEM_PROMPT',
      'USER_PROMPT',
      SpeechOptimizationResponseSchema,
      expect.objectContaining({
        formatName: 'speech_optimization',
        model: 'gpt-4o-mini',
        promptBlueprint: expect.objectContaining({
          promptName: 'speech_optimization',
        }),
        logContext: {
          sermonTitle: sermon.title,
          textLength: '## Raw sermon markdown'.length,
        },
      })
    );

    expect(result).toEqual({
      optimizedText: 'Начнем с надежды. Далее посмотрим на терпение.',
      chunks: ['Начнем с надежды.', 'Далее посмотрим на терпение.'],
      originalLength: '## Raw sermon markdown'.length,
      optimizedLength: 'Начнем с надежды. Далее посмотрим на терпение.'.length,
    });
  });

  it('throws the underlying error result when structured output fails with an error', async () => {
    (callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: false,
      data: null,
      refusal: null,
      error: new Error('OpenAI timeout'),
    });

    await expect(
      optimizeTextForSpeech('Plain text', sermon, {
        sermonTitle: sermon.title,
        sections: 'all',
      })
    ).rejects.toThrow('OpenAI timeout');

    const blueprintArg = (buildSimplePromptBlueprint as jest.Mock).mock.calls[0][0];
    expect(blueprintArg.userMessage).not.toContain('Main scripture:');
    expect(blueprintArg.userMessage).not.toContain('CONTEXT:');
  });

  it('throws a refusal fallback message when no explicit error is returned', async () => {
    (callWithStructuredOutput as jest.Mock).mockResolvedValue({
      success: false,
      data: null,
      refusal: 'Model refused',
      error: null,
    });

    await expect(
      optimizeTextForSpeech('Plain text', sermon, {
        sermonTitle: sermon.title,
        sections: 'conclusion',
      })
    ).rejects.toThrow('Model refused');
  });

  it('returns the full text unchanged when all sections are requested', () => {
    const rawText = 'Вступление:\nIntro\n\nОсновная часть:\nBody';

    expect(filterTextBySections(rawText, 'all')).toBe(rawText);
  });

  it('filters a target section using Russian markers and stops at the next section', () => {
    const rawText = [
      'Вступление:\nIntro text',
      'Основная часть:\nBody text',
      'Заключение:\nConclusion text',
    ].join('\n\n');

    expect(filterTextBySections(rawText, 'mainPart')).toBe('Основная часть:\nBody text');
    expect(filterTextBySections(rawText, 'conclusion')).toBe('Заключение:\nConclusion text');
  });

  it('returns an empty string when the requested section marker does not exist', () => {
    expect(filterTextBySections('No explicit markers here', 'introduction')).toBe('');
  });

  it('exposes the speech optimization system prompt', () => {
    const prompt = getSystemPrompt();

    expect(prompt).toContain('sermon speech optimizer');
    expect(prompt).toContain('under 4000 characters');
  });
});
