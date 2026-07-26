import {
  generateBrainstormSuggestionStructured,
  generatePlanPointContentStructured,
  composePlanFromScratchStructured,
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

  it('passes the sermon owner to every TEXT structured-output caller', async () => {
    mockStructuredCall.mockResolvedValue({
      success: false,
      data: null,
      refusal: null,
      error: new Error('stop after routing'),
    });
    const sermonWithScratch: Sermon = {
      ...baseSermon,
      scratch: [{ id: 'scratch-1', text: 'Scratch', createdAt: '2026-07-12T00:00:00.000Z' }],
    };

    await generateSermonInsightsStructured(baseSermon);
    await generateSermonTopicsStructured(baseSermon);
    await generateSermonVersesStructured(baseSermon);
    await generateSectionHintsStructured(baseSermon);
    await generateSermonPointsStructured(baseSermon, 'main');
    await composePlanFromScratchStructured(sermonWithScratch);
    await generateBrainstormSuggestionStructured(baseSermon);

    expect(mockStructuredCall).toHaveBeenCalledTimes(7);
    for (const call of mockStructuredCall.mock.calls) {
      expect(call[3]).toEqual(expect.objectContaining({ userId: baseSermon.userId }));
    }
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

  it('pins manually placed scratch notes to their selected sections when composing hybrid plans', async () => {
    // n1/n2 follow createdAt order; the model puts both in main, the pin must still win.
    mockStructuredCall.mockResolvedValue({
      success: true,
      data: {
        placements: [
          { noteKey: 'n1', text: 'Model tried to move manual intro', section: 'main', targetKind: 'new_point', targetKey: '' },
          { noteKey: 'n2', text: 'AI main point', section: 'main', targetKind: 'new_point', targetKey: '' },
        ],
        unplaced: [],
      },
      refusal: null,
      error: null,
    });

    const result = await composePlanFromScratchStructured({
      ...baseSermon,
      scratch: [
        {
          id: 'manual-intro',
          text: 'Manual note belongs in the intro',
          createdAt: '2026-07-04T00:00:00.000Z',
          section: 'introduction',
        },
        { id: 'ai-main', text: 'Explain the text', createdAt: '2026-07-04T00:01:00.000Z' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.outline.introduction).toEqual([
      expect.objectContaining({
        scratchNoteId: 'manual-intro',
        text: 'Model tried to move manual intro',
        source: 'manual',
      }),
    ]);
    expect(result.outline.main).toEqual([
      expect.objectContaining({
        scratchNoteId: 'ai-main',
        text: 'AI main point',
        source: 'ai',
      }),
    ]);
  });

  it('augments matching existing outline points with scratch-derived sub-points without changing existing ids', async () => {
    const existingOutline = {
      introduction: [],
      main: [
        {
          id: 'existing-main',
          text: 'Existing main point',
          note: 'Existing point note',
          isReviewed: true,
          subPoints: [{ id: 'existing-sub', text: 'Existing sub-point', position: 1000 }],
        },
      ],
      conclusion: [],
    };
    // The existing point is addressed by its short key p1, never by its real id.
    mockStructuredCall.mockResolvedValue({
      success: true,
      data: {
        placements: [
          {
            noteKey: 'n1',
            text: 'Application under existing point',
            section: 'main',
            targetKind: 'existing_point',
            targetKey: 'p1',
          },
        ],
        unplaced: [],
      },
      refusal: null,
      error: null,
    });

    const result = await composePlanFromScratchStructured(
      {
        ...baseSermon,
        scratch: [{ id: 'ai-main', text: 'Apply this existing point', createdAt: '2026-07-04T00:01:00.000Z' }],
      },
      existingOutline
    );

    expect(result.success).toBe(true);
    expect(result.outline.main[0]).toEqual(
      expect.objectContaining({
        id: 'existing-main',
        text: 'Existing main point',
        note: 'Existing point note',
        isReviewed: true,
      })
    );
    expect(result.outline.main[0].subPoints).toEqual([
      { id: 'existing-sub', text: 'Existing sub-point', position: 1000 },
      expect.objectContaining({
        scratchNoteId: 'ai-main',
        text: 'Application under existing point',
        // The raw phrase now comes from OUR copy of the note, not from the model echo.
        note: 'Apply this existing point',
        source: 'ai',
        position: 2000,
      }),
    ]);
    expect(result.outline.main[0].subPoints?.[1].id).toMatch(/^sp-/);
    expect(mockStructuredCall.mock.calls[0][1]).toContain('Existing main point');
  });

  it('enforces explicit intro and conclusion cues for all-AI unplaced scratch notes before accepting model sections', async () => {
    mockStructuredCall.mockResolvedValue({
      success: true,
      data: {
        placements: [
          { noteKey: 'n1', text: 'в начале — start with the question', section: 'main', targetKind: 'new_point', targetKey: '' },
          { noteKey: 'n2', text: 'в конце — call them to respond', section: 'main', targetKind: 'new_point', targetKey: '' },
        ],
        unplaced: [],
      },
      refusal: null,
      error: null,
    });

    const result = await composePlanFromScratchStructured({
      ...baseSermon,
      scratch: [
        { id: 'cue-intro', text: 'в начале — start with the question', createdAt: '2026-07-04T00:00:00.000Z' },
        { id: 'cue-conclusion', text: 'в конце — call them to respond', createdAt: '2026-07-04T00:01:00.000Z' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.outline.introduction).toEqual([
      expect.objectContaining({
        scratchNoteId: 'cue-intro',
        text: 'start with the question',
        source: 'ai',
      }),
    ]);
    expect(result.outline.main).toEqual([]);
    expect(result.outline.conclusion).toEqual([
      expect.objectContaining({
        scratchNoteId: 'cue-conclusion',
        text: 'call them to respond',
        source: 'ai',
      }),
    ]);
  });

  it('keeps a leading conclusion cue when the same scratch note later mentions the beginning', async () => {
    mockStructuredCall.mockResolvedValue({
      success: true,
      data: {
        placements: [
          {
            noteKey: 'n1',
            text: 'Model tried to make this an intro point',
            section: 'introduction',
            targetKind: 'new_point',
            targetKey: '',
          },
        ],
        unplaced: [],
      },
      refusal: null,
      error: null,
    });

    const result = await composePlanFromScratchStructured({
      ...baseSermon,
      scratch: [
        {
          id: 'mixed-cue',
          text: 'В конце вернуться к вопросу, который я задал в начале: кому ты доверяешь?',
          createdAt: '2026-07-04T00:02:00.000Z',
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.outline.introduction).toEqual([]);
    expect(result.outline.main).toEqual([]);
    expect(result.outline.conclusion).toEqual([
      expect.objectContaining({
        scratchNoteId: 'mixed-cue',
        text: 'Model tried to make this an intro point',
        source: 'ai',
      }),
    ]);
  });

  it('drops only the invented key and keeps the rest of the composition', async () => {
    // The old path discarded the ENTIRE response when a single id looked wrong, and the
    // model got ids wrong in 4 of 5 measured runs. One bad key must now cost only itself.
    mockStructuredCall.mockResolvedValue({
      success: true,
      data: {
        placements: [
          { noteKey: 'n1', text: 'Real placement', section: 'main', targetKind: 'new_point', targetKey: '' },
          { noteKey: 'n99', text: 'Invented key', section: 'main', targetKind: 'new_point', targetKey: '' },
        ],
        unplaced: [],
      },
      refusal: null,
      error: null,
    });

    const result = await composePlanFromScratchStructured({
      ...baseSermon,
      scratch: [{ id: 'note-a', text: 'First note', createdAt: '2026-07-04T00:00:00.000Z' }],
    });

    expect(result.success).toBe(true);
    expect(result.outline.main).toEqual([
      expect.objectContaining({ scratchNoteId: 'note-a', text: 'Real placement' }),
    ]);
    expect(result.unplacedScratchNoteIds).toEqual([]);
  });

  it('falls back to a new point when the model targets an outline point that does not exist', async () => {
    // Seen live: with an EMPTY outline the model still answered targetKind="existing_point"
    // for 19 of 25 notes. An unresolvable target must degrade to a new point, never drop
    // the note and never throw.
    mockStructuredCall.mockResolvedValue({
      success: true,
      data: {
        placements: [
          { noteKey: 'n1', text: 'Points at nothing', section: 'main', targetKind: 'existing_point', targetKey: 'p7' },
        ],
        unplaced: [],
      },
      refusal: null,
      error: null,
    });

    const result = await composePlanFromScratchStructured({
      ...baseSermon,
      scratch: [{ id: 'note-a', text: 'Lonely note', createdAt: '2026-07-04T00:00:00.000Z' }],
    });

    expect(result.success).toBe(true);
    expect(result.unplacedScratchNoteIds).toEqual([]);
    expect(result.outline.main).toEqual([
      expect.objectContaining({ scratchNoteId: 'note-a', text: 'Points at nothing' }),
    ]);
  });

  it('reports notes the model skipped instead of hiding them as orphan points', async () => {
    // One measured run returned 17 objects for 25 notes; the eight missing ones were
    // silently appended. They still land in the outline, but the caller is now told.
    mockStructuredCall.mockResolvedValue({
      success: true,
      data: {
        placements: [
          { noteKey: 'n1', text: 'Placed one', section: 'main', targetKind: 'new_point', targetKey: '' },
        ],
        unplaced: [{ noteKey: 'n2', reasonCode: 'ambiguous' }],
      },
      refusal: null,
      error: null,
    });

    const result = await composePlanFromScratchStructured({
      ...baseSermon,
      scratch: [
        { id: 'note-a', text: 'First note', createdAt: '2026-07-04T00:00:00.000Z' },
        { id: 'note-b', text: 'Second note', createdAt: '2026-07-04T00:01:00.000Z' },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.unplacedScratchNoteIds).toEqual(['note-b']);
    expect(result.outline.main.map((point) => point.scratchNoteId)).toEqual(['note-a', 'note-b']);
  });

  it('applies a repeated note key once, so completeness cannot be faked by duplication', async () => {
    mockStructuredCall.mockResolvedValue({
      success: true,
      data: {
        placements: [
          { noteKey: 'n1', text: 'First mention', section: 'main', targetKind: 'new_point', targetKey: '' },
          { noteKey: 'n1', text: 'Second mention', section: 'conclusion', targetKind: 'new_point', targetKey: '' },
        ],
        unplaced: [],
      },
      refusal: null,
      error: null,
    });

    const result = await composePlanFromScratchStructured({
      ...baseSermon,
      scratch: [{ id: 'note-a', text: 'Only note', createdAt: '2026-07-04T00:00:00.000Z' }],
    });

    expect(result.outline.main).toEqual([
      expect.objectContaining({ scratchNoteId: 'note-a', text: 'First mention' }),
    ]);
    expect(result.outline.conclusion).toEqual([]);
  });

  it('numbers note keys by capture time, not by the newest-first storage order', async () => {
    // Scratch is stored newest-first, so the dictated sequence used to reach the model
    // reversed. n1 must be the note the preacher recorded FIRST.
    mockStructuredCall.mockResolvedValue({
      success: true,
      data: { placements: [], unplaced: [] },
      refusal: null,
      error: null,
    });

    await composePlanFromScratchStructured({
      ...baseSermon,
      scratch: [
        { id: 'newest', text: 'Recorded last', createdAt: '2026-07-04T10:00:00.000Z' },
        { id: 'oldest', text: 'Recorded first', createdAt: '2026-07-04T09:00:00.000Z' },
      ],
    });

    const userMessage = mockStructuredCall.mock.calls[0][1] as string;
    expect(userMessage).toContain('n1: Recorded first');
    expect(userMessage).toContain('n2: Recorded last');
  });

  it('gives the AI call a deadline under the serverless wall and forbids hidden SDK retries', async () => {
    mockStructuredCall.mockResolvedValue({
      success: true,
      data: { placements: [], unplaced: [] },
      refusal: null,
      error: null,
    });

    await composePlanFromScratchStructured({
      ...baseSermon,
      scratch: [{ id: 'note-a', text: 'Note', createdAt: '2026-07-04T00:00:00.000Z' }],
    });

    const options = mockStructuredCall.mock.calls[0][3] as { requestOptions?: { timeout?: number; maxRetries?: number } };
    expect(options.requestOptions?.maxRetries).toBe(0);
    expect(options.requestOptions?.timeout).toBeLessThan(60_000);
  });
});
