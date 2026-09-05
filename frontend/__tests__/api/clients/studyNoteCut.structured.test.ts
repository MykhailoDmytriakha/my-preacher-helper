import * as structuredOutput from '@clients/structuredOutput';
import {
  buildCutNoteSystemPrompt,
  buildCutNoteUserMessage,
  cutStudyNoteIntoScratch,
  normalizeCutSections,
} from '@clients/studyNoteCut.structured';
import { UsageCapReachedError } from '@/services/usageLimits';

jest.mock('@clients/structuredOutput', () => ({
  callWithStructuredOutput: jest.fn(),
}));

jest.mock('@clients/openAIHelpers', () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const mockCall = structuredOutput.callWithStructuredOutput as jest.Mock;

const NOTE = '## Девять глав\n\nПервая мысль. *«стих»* (1 Пар 1:10)\n\n## Вторая\n\nВторая мысль.';

describe('cutStudyNoteIntoScratch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refuses an empty note without calling the model', async () => {
    const result = await cutStudyNoteIntoScratch({ content: '   ' });
    expect(result.success).toBe(false);
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('hands the model the contract, the corridor and the author\'s own material', async () => {
    mockCall.mockResolvedValue({ data: { keyPassage: '', sections: [] } });
    await cutStudyNoteIntoScratch({
      content: NOTE,
      title: 'Молитва Иависа',
      scriptureRefs: ['1 Chronicles 4:9-10'],
      userId: 'owner-1',
    });

    expect(mockCall).toHaveBeenCalledTimes(1);
    const [systemPrompt, userMessage, , options] = mockCall.mock.calls[0];
    expect(systemPrompt).toContain('One scratch note = one cornerstone claim');
    expect(systemPrompt).toContain('never pad');
    expect(systemPrompt).toContain('Russian');
    expect(systemPrompt).toMatch(/expect roughly 1–2/);
    expect(userMessage).toContain('Title: Молитва Иависа');
    expect(userMessage).toContain('1 Chronicles 4:9-10');
    expect(userMessage).toContain(NOTE);
    expect(options).toEqual(expect.objectContaining({ formatName: 'cutNote', userId: 'owner-1' }));
    // Under the 60s serverless wall: our own deadline, and the SDK's hidden retries off
    // because the retry has to know how much of the wall is left.
    expect(options.requestOptions).toEqual({ timeout: 30_000, maxRetries: 0 });
  });

  it('returns trimmed sections and drops empty claims the model invented', async () => {
    mockCall.mockResolvedValue({
      data: {
        keyPassage: ' 1 Пар 4:9-10 ',
        sections: [
          { heading: ' Девять глав ', claims: [{ text: ' Мысль ', scripture: ' 1 Пар 1:10 ' }, { text: '  ', scripture: '' }] },
          { heading: 'Вторая', claims: [] },
        ],
      },
    });
    const result = await cutStudyNoteIntoScratch({ content: NOTE });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      keyPassage: '1 Пар 4:9-10',
      sections: [
        { heading: 'Девять глав', claims: [{ text: 'Мысль', scripture: '1 Пар 1:10' }] },
        { heading: 'Вторая', claims: [] },
      ],
    });
  });

  it('reports a refusal and a missing answer as failures, not as empty cuts', async () => {
    mockCall.mockResolvedValue({ refusal: 'no' });
    await expect(cutStudyNoteIntoScratch({ content: NOTE })).resolves.toMatchObject({ success: false });
    mockCall.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(cutStudyNoteIntoScratch({ content: NOTE })).resolves.toMatchObject({ success: false, error: 'boom' });
  });

  it('lets a usage cap through untouched so the route can answer 429', async () => {
    mockCall.mockRejectedValue(new UsageCapReachedError('ai', 10, 10, 10, '2026-09-06T00:00:00.000Z'));
    await expect(cutStudyNoteIntoScratch({ content: NOTE })).rejects.toBeInstanceOf(UsageCapReachedError);
  });

  it('retries the same call when the provider blinks, and pays for nothing terminal', async () => {
    // The failure that started this: one `503 (no body)` from the provider used to throw
    // away the whole cut, because nothing above retries a target — the shared chain only
    // moves to the NEXT model, and an ordinary tier has exactly one.
    mockCall
      .mockResolvedValueOnce({ data: null, error: new Error('503 status code (no body)') })
      .mockResolvedValueOnce({ data: { keyPassage: '', sections: [{ heading: 'a', claims: [{ text: 'x', scripture: '' }] }] } });

    const result = await cutStudyNoteIntoScratch({ content: NOTE });

    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
  });

  it('does not retry a failure the note itself caused', async () => {
    mockCall.mockResolvedValue({ data: null, error: new Error('Invalid schema: expected object') });
    const result = await cutStudyNoteIntoScratch({ content: NOTE });
    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
  });

  it('does not start an attempt the budget cannot pay for', async () => {
    mockCall.mockResolvedValue({ data: null, error: new Error('503 status code (no body)') });
    const result = await cutStudyNoteIntoScratch({ content: NOTE, budgetMs: 1_000 });
    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
  });

  it('tells the model when it is reading only part of the note', async () => {
    mockCall.mockResolvedValue({ data: { keyPassage: '', sections: [] } });
    await cutStudyNoteIntoScratch({ content: NOTE, slice: { from: 4, to: 6, total: 13 } });
    const [systemPrompt, userMessage] = mockCall.mock.calls[0];
    expect(systemPrompt).toContain('sections 4-6 of 13');
    expect(userMessage).toContain('This is part of the note: sections 4-6 of 13.');
  });
});

describe('prompt pieces', () => {
  it('the system prompt names the corridor it was given', () => {
    const prompt = buildCutNoteSystemPrompt('Russian', { min: 15, max: 25 });
    expect(prompt).toContain('expect roughly 15–25');
    expect(prompt).toContain('Write in Russian');
  });

  it('says nothing about excerpts when the whole note is being cut', () => {
    expect(buildCutNoteSystemPrompt('Russian', { min: 1, max: 2 })).not.toContain('EXCERPT');
    expect(buildCutNoteSystemPrompt('Russian', { min: 1, max: 2 }, { from: 1, to: 3, total: 3 })).not.toContain('EXCERPT');
  });

  it('the user message counts headed sections and states the suggested count', () => {
    const message = buildCutNoteUserMessage({ content: NOTE, title: 'T' }, { min: 1, max: 2 });
    expect(message).toContain('2 headed sections');
    expect(message).toContain('Suggested count for this text: 1–2');
  });

  it('normalizeCutSections keeps document order', () => {
    const sections = normalizeCutSections([
      { heading: 'b', claims: [{ text: 'x', scripture: '' }] },
      { heading: 'a', claims: [] },
    ]);
    expect(sections.map((section) => section.heading)).toEqual(['b', 'a']);
  });
});
