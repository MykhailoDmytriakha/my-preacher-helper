import { act, renderHook } from '@testing-library/react';

import { useAnalysisReshape } from '@/components/bible/analysis/useAnalysisReshape';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { passageWords } from '@/utils/passageAnalysis';

import type { StudyNote } from '@/models/models';
import type { BookText } from '@/utils/bibleText';

/*
 * BUG-20261030-analysis-reshape-loses-moved-work: verses taken off an analysis carry its work to the analysis touching them.
 * The shortened analysis was written first and the neighbour after, its refusal swallowed and «done» said at once — a
 * neighbour waiting on a choice refused, and the work was in neither. The work goes to its new home first; only once it is
 * kept there is the analysis shortened, and a refusal leaves it as it was and says so.
 */
jest.mock('@/hooks/useStudyNotesEngine', () => ({ ...jest.requireActual('@/hooks/useStudyNotesEngine'), useStudyNotesEngine: jest.fn() }));

const TEXT: BookText = { id: 'Ephesians', chapters: [['Павел волею Божиею Апостол', 'благодать вам и мир от Бога', 'Благословен Бог и Отец']] };
const ab = { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 2 };
const total = passageWords(TEXT, ab).length;
const firstOfVerseTwo = passageWords(TEXT, { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 1 }).length;
const note = (id: string, chapter: number, fromVerse: number, toVerse: number, cuts: number[], words: number): StudyNote => ({
  id, userId: 'u', type: 'analysis', title: id, content: '', tags: [], isDraft: false, createdAt: '', updatedAt: '',
  scriptureRefs: [{ id: `r-${id}`, bible: 'rst', book: 'Ephesians', chapter, fromVerse, toVerse } as StudyNote['scriptureRefs'][number]],
  analysis: { bible: 'rst', words, cuts, links: {}, relations: {} },
});
// A covers verses 1–2 with a part begun inside verse 2; B is the analysis of verse 3, right after it.
const A = note('a', 1, 1, 2, [firstOfVerseTwo + 1], total);
const B = note('b', 1, 3, 3, [], passageWords(TEXT, { chapter: 1, fromVerse: 3, toChapter: 1, toVerse: 3 }).length);

const engineWith = (updateNote: jest.Mock) => (useStudyNotesEngine as jest.Mock).mockImplementation(() => ({
  uid: 'u', notes: [A, B], loading: false, checking: false, updateNote, createNote: jest.fn(() => ({ acceptance: Promise.resolve() })),
}));
const reshapeOf = () => renderHook(() => useAnalysisReshape({ text: TEXT, bookId: 'Ephesians', bible: 'rst', locale: 'ru' })).result.current;

describe('verses taken off an analysis, their work moved to the analysis touching them', () => {
  it('leaves the analysis as it was and says so when its neighbour does not take the work', async () => {
    const updateNote = jest.fn(({ id }: { id: string }) => ({ result: id === 'b' ? Promise.reject(new Error('decision-required')) : Promise.resolve() }));
    engineWith(updateNote);
    const reshape = reshapeOf();
    let outcome: unknown;
    await act(async () => { outcome = await reshape('a', { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 1 }); });
    expect(updateNote.mock.calls.map(([call]) => call.id)).toEqual(['b']);
    expect(outcome).toEqual({ kind: 'refused' });
  });

  it('keeps the work in its new home first, then shortens the analysis', async () => {
    const updateNote = jest.fn((call: { id: string }) => ({ result: Promise.resolve(call) }));
    engineWith(updateNote);
    const reshape = reshapeOf();
    let outcome: unknown;
    await act(async () => { outcome = await reshape('a', { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 1 }); });
    expect(updateNote.mock.calls.map(([call]) => call.id)).toEqual(['b', 'a']);
    expect(outcome).toMatchObject({ kind: 'done' });
  });
});
