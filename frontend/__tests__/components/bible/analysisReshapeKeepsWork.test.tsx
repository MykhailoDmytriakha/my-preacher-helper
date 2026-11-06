import { act, renderHook } from '@testing-library/react';

import { useAnalysisReshape } from '@/components/bible/analysis/useAnalysisReshape';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { passageWords } from '@/utils/passageAnalysis';

import type { StudyNote } from '@/models/models';
import type { BookText } from '@/utils/bibleText';

/*
 * A passage reshape must keep the removed work together with the shortened source. The UI waits for one complete local
 * capture and propagates a refusal. Canonical engine tests cover atomic storage, stale frames, restart and server delivery.
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

const reshapeOf = () => renderHook(() => useAnalysisReshape({ text: TEXT, bookId: 'Ephesians', bible: 'rst', locale: 'ru' })).result.current;

describe('removed analysis work and its shortened source share one capture', () => {
  it('propagates a refused complete capture without a separate source or recipient write', async () => {
    const refusal = new Error('decision-required');
    const updateNote = jest.fn(), createNote = jest.fn();
    const reshapeNotes = jest.fn(async (_edits: unknown[]) => { throw refusal; });
    (useStudyNotesEngine as jest.Mock).mockReturnValue({ uid: 'u', notes: [A, B], updateNote, createNote, reshapeNotes });
    const reshape = reshapeOf();
    let failure: unknown;
    await act(async () => { try { await reshape('a', { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 1 }); } catch (error) { failure = error; } });
    expect(failure).toBe(refusal);
    expect(reshapeNotes).toHaveBeenCalledTimes(1);
    expect((reshapeNotes.mock.calls[0][0] as { id: string }[]).map(edit => edit.id)).toEqual(['a', 'b']);
    expect(updateNote).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });

  it('reports the result only after the complete local capture keeps both analyses', async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const reshapeNotes = jest.fn((_edits: unknown[]) => held);
    const updateNote = jest.fn(), createNote = jest.fn();
    (useStudyNotesEngine as jest.Mock).mockReturnValue({ uid: 'u', notes: [A, B], updateNote, createNote, reshapeNotes });
    const reshape = reshapeOf();
    let settled = false;
    let outcome: string | null = null;
    let pending!: Promise<void>;
    act(() => { pending = reshape('a', { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 1 }).then(value => { outcome = value; settled = true; }); });
    expect(settled).toBe(false);
    const edits = reshapeNotes.mock.calls[0][0] as { id: string; fields: Partial<StudyNote>; expected: StudyNote }[];
    expect(edits.map(edit => edit.id)).toEqual(['a', 'b']);
    expect(edits[0].expected).toBe(A);
    expect(edits[1].expected).toBe(B);
    expect(edits[0].fields.scriptureRefs?.[0].toVerse).toBe(1);
    expect(edits[1].fields.scriptureRefs?.[0].fromVerse).toBe(2);
    expect(edits[1].fields.analysis?.cuts?.length).toBeGreaterThan(0);
    await act(async () => { release(); await pending; });
    expect(outcome).toContain('analysis.reshape');
    expect(settled).toBe(true);
    expect(updateNote).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });
});
