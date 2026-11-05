import { act, renderHook } from '@testing-library/react';

import { storedAnalysis } from '@/components/bible/analysis/useAnalysisNote';
import { useAnalysisReshape, type ReshapeOutcome } from '@/components/bible/analysis/useAnalysisReshape';
import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { passageWords } from '@/utils/passageAnalysis';

import type { BookText } from '@/utils/bibleText';

/*
 * Codex, 05.11: verses taken off analysis A go to its neighbour B first; while B's write waits, the phone's newer link
 * reaches A — and A was then written from the copy read before, the link gone and «done» said. Each analysis is written
 * against the copy its new shape was made from: changed meanwhile, the change is refused and A stays as the phone left it.
 * Through the real notes facade (`useStudyNotesEngine`) on a controlled engine.
 */
jest.mock('@/data-engine/react.client', () => ({ useDataCollection: jest.fn(), useDocumentActions: jest.fn() }));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: 'u', isAuthLoading: false }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));

type Row = Record<string, unknown> & { analysis: { relations: Record<string, unknown> } };
const TEXT: BookText = { id: 'Ephesians', chapters: [['Paul apostle of God', 'Grace and peace to you', 'Blessed be God our Father']] };
const row = (id: string, fromVerse: number, toVerse: number, cuts: number[]): Row => ({
  id, userId: 'u', type: 'analysis', title: id, content: '', tags: [], createdAt: '', updatedAt: '',
  scriptureRefs: [{ id: `r-${id}`, bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse, toVerse }],
  analysis: storedAnalysis({ cuts, links: {}, relations: [] }, 'rst', passageWords(TEXT, { chapter: 1, fromVerse, toChapter: 1, toVerse }).length) as unknown as Row['analysis'],
});

it('refuses to shorten an analysis that changed while its moved work was being kept, and keeps that change', async () => {
  const rows: Record<string, Row> = { a: row('a', 1, 2, [5]), b: row('b', 3, 3, []) };
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const writes: string[] = [];
  (useDataCollection as jest.Mock).mockImplementation(() => ({
    loading: false, state: { documents: Object.entries(rows).map(([id, value]) => ({ resource: { collection: 'studyNotes', id }, value })) },
  }));
  (useDocumentActions as jest.Mock).mockReturnValue({
    commit: jest.fn(async ({ id }: { id: string }, updater: (current: Row) => Row) => {
      writes.push(id);
      rows[id] = updater(rows[id]);
      if (id === 'b') await held;
    }),
  });
  const { result } = renderHook(() => useAnalysisReshape({ text: TEXT, bookId: 'Ephesians', bible: 'rst', locale: 'en' }));
  let pending: Promise<ReshapeOutcome> = Promise.resolve(null);
  act(() => { pending = result.current('a', { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 1 }); });
  expect(writes).toEqual(['b']);
  // The phone's newer link reaches A before B's write is kept.
  rows.a = { ...rows.a, analysis: { ...rows.a.analysis, relations: { '0-2': { dir: 'fwd', color: 'teal' } } } };
  let outcome: ReshapeOutcome = null;
  await act(async () => { release(); outcome = await pending; });
  expect(rows.a.analysis.relations['0-2']).toEqual({ dir: 'fwd', color: 'teal' });
  expect(outcome).toEqual({ kind: 'refused' });
});
