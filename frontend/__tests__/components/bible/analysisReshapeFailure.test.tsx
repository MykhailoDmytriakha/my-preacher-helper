import { act, renderHook } from '@testing-library/react';

import { useAnalysisReshape } from '@/components/bible/analysis/useAnalysisReshape';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';

import type { StudyNote } from '@/models/models';
import type { BookText } from '@/utils/bibleText';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/hooks/useStudyNotesEngine', () => ({ useStudyNotesEngine: jest.fn() }));

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const text: BookText = { id: 'Ephesians', chapters: [['Alpha beta gamma delta', 'epsilon zeta eta theta', 'iota kappa lambda mu']] };
const makeNote = (id: string, fromVerse: number, toVerse: number): StudyNote => ({
  id, userId: 'owner', title: id, content: id,
  scriptureRefs: [{ id: id + '-ref', bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse, toVerse }],
  tags: [], type: 'analysis', isDraft: false, createdAt: '2026-10-31T07:00:00.000Z', updatedAt: '2026-10-31T07:00:00.000Z',
  analysis: { bible: 'rst', words: (toVerse - fromVerse + 1) * 4, cuts: [], links: {}, relations: {} },
});

it.each(['existing', 'new'] as const)('retains the original authored analysis if the %s destination refuses its removed verses', async destination => {
  const source = makeNote('source', 1, 2);
  source.analysis = { bible: 'rst', words: 8, cuts: [5], links: { '5': 4 }, relations: { '4-5': { dir: 'fwd', color: 'amber' } } };
  const target = makeNote('destination', 3, 3);
  const saved = new Map([['source', copy(source)], ...(destination === 'existing' ? [['destination', copy(target)] as const] : [])]);
  const refusal = Object.assign(new Error('Destination cannot accept this transfer'), { code: 'decision-required' });
  const engine = {
    uid: 'owner', notes: [source, ...(destination === 'existing' ? [target] : [])],
    updateNote: ({ id, updates }: { id: string; updates: Partial<StudyNote> }) => {
      if (id === 'destination') return { result: Promise.reject(refusal) };
      saved.set(id, { ...saved.get(id)!, ...updates });
      return { result: Promise.resolve(saved.get(id)) };
    },
    createNote: () => ({ acceptance: Promise.reject(refusal) }),
    reshapeNotes: async () => { throw refusal; },
  };
  jest.mocked(useStudyNotesEngine).mockReturnValue(engine as unknown as ReturnType<typeof useStudyNotesEngine>);
  const { result } = renderHook(() => useAnalysisReshape({ text, bookId: 'Ephesians', bible: 'rst', locale: 'en' }));
  let outcome: unknown, error: unknown;
  await act(async () => {
    try { outcome = await result.current('source', { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 1 }); }
    catch (failure) { error = failure; }
  });

  // A refusal may leave a recoverable request, but cannot remove the original's words or positions.
  expect(saved.get('source')).toEqual(source);
  expect(saved.get('destination')).toEqual(destination === 'existing' ? target : undefined);
  expect(outcome).toBeUndefined();
  expect(error).toMatchObject({ code: 'decision-required' });
});
