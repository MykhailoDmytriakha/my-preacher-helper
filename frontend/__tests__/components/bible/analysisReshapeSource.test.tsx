import { act, renderHook } from '@testing-library/react';

import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { useAnalysisReshape } from '@/components/bible/analysis/useAnalysisReshape';

import type { StudyNote } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';
import type { BibleId } from '@/utils/bibles';
import type { BookText } from '@/utils/bibleText';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/hooks/useStudyNotesEngine', () => ({ useStudyNotesEngine: jest.fn() }));

const passage = { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 2 };
const note = (patch: Partial<StudyNote> = {}): StudyNote => ({
  id: 'analysis-1', userId: 'owner', title: 'Ephesians 1:1–2', content: '- Alpha beta gamma\n- Delta epsilon zeta eta',
  scriptureRefs: [{ id: 'ref-1', bible: 'rst', book: 'Ephesians', ...passage }], tags: [], type: 'analysis', isDraft: true,
  createdAt: '2026-10-30T10:00:00.000Z', updatedAt: '2026-10-30T10:00:00.000Z',
  analysis: { bible: 'rst', words: 8, cuts: [3], links: {}, relations: {} }, ...patch,
});
const text: BookText = { id: 'Ephesians', chapters: [['Alpha beta gamma delta', 'epsilon zeta eta theta']] };
const next = { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 1 };
const locale: AppLocale = 'en';

describe('Analysis reshape keeps its original word source', () => {
  let engine: {
    notes: StudyNote[];
    uid: string;
    updateNote: jest.Mock< { result: Promise<void>; capture: Promise<void> }, [ { id: string; updates: Partial<StudyNote> } ]>;
    createNote: jest.Mock< { acceptance: Promise<void> }, [Partial<StudyNote>]>;
  };

  beforeEach(() => {
    engine = {
      notes: [note()], uid: 'owner',
      updateNote: jest.fn<{ result: Promise<void>; capture: Promise<void> }, [{ id: string; updates: Partial<StudyNote> }]>(() => ({ result: Promise.resolve(), capture: Promise.resolve() })),
      createNote: jest.fn<{ acceptance: Promise<void> }, [Partial<StudyNote>]>(() => ({ acceptance: Promise.resolve() })),
    };
    (useStudyNotesEngine as jest.Mock).mockReturnValue(engine);
  });

  it.each([
    ['word Bible', 'Ephesians', 'kjv', text],
    ['canonical reference book', 'Galatians', 'rst', { ...text, id: 'Galatians' }],
    ['loaded text identity', 'Ephesians', 'rst', { ...text, id: 'Galatians' }],
  ] as [string, string, BibleId, BookText][])('does not reshape from a different %s', async (_label, bookId, bible, loadedText) => {
    const { result } = renderHook(() => useAnalysisReshape({ text: loadedText, bookId, bible, locale }));
    let response: string | null = 'not-called';
    await act(async () => { response = await result.current('analysis-1', next); });

    expect(response).toBeNull();
    expect(engine.updateNote).not.toHaveBeenCalled();
    expect(engine.createNote).not.toHaveBeenCalled();
  });

  it('still saves a same-source passage reshape when retained analysis work remains', async () => {
    const { result } = renderHook(() => useAnalysisReshape({ text, bookId: 'Ephesians', bible: 'rst', locale }));
    await act(async () => { await result.current('analysis-1', next); });

    expect(engine.updateNote).toHaveBeenCalledTimes(1);
    expect(engine.updateNote).toHaveBeenCalledWith(expect.objectContaining({
      id: 'analysis-1', updates: expect.objectContaining({
        analysis: expect.objectContaining({ bible: 'rst', cuts: [3] }),
        scriptureRefs: [expect.objectContaining({ bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse: 1, toVerse: 1 })],
      }),
    }));
    expect(engine.createNote).not.toHaveBeenCalled();
  });

  it('writes newly chosen source-Bible verses with their numbering when the old reference uses another Bible', async () => {
    const chapters = Array.from({ length: 22 }, () => [] as string[]);
    chapters[21] = ['Alpha beta gamma delta', 'epsilon zeta eta theta'];
    const psalm: BookText = { id: 'Psalms', chapters };
    engine.notes = [note({ scriptureRefs: [{ id: 'psalm', bible: 'kjv', book: 'Psalms', chapter: 23, fromVerse: 1, toVerse: 2 }] })];
    const { result } = renderHook(() => useAnalysisReshape({ text: psalm, bookId: 'Psalms', bible: 'rst', locale }));
    await act(async () => { await result.current('analysis-1', { chapter: 22, fromVerse: 1, toChapter: 22, toVerse: 1 }); });
    expect(engine.updateNote).toHaveBeenCalledTimes(1);
    expect(engine.updateNote).toHaveBeenCalledWith(expect.objectContaining({
      id: 'analysis-1', updates: expect.objectContaining({
        analysis: expect.objectContaining({ bible: 'rst', words: 4, cuts: [3] }),
        scriptureRefs: [expect.objectContaining({ id: 'psalm', bible: 'rst', book: 'Psalms', chapter: 22, fromVerse: 1, toVerse: 1 })],
      }),
    }));
    expect(engine.createNote).not.toHaveBeenCalled();
  });

});
