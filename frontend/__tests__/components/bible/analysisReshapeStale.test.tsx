import { act, renderHook } from '@testing-library/react';

import { storedAnalysis } from '@/components/bible/analysis/useAnalysisNote';
import { useAnalysisReshape } from '@/components/bible/analysis/useAnalysisReshape';
import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { captureAnalysisReshape } from '@/data-engine/analysisReshape';

import type { DocumentData, ResourceSnapshot } from '@/data-engine/types';
import { passageWords } from '@/utils/passageAnalysis';

import type { BookText } from '@/utils/bibleText';

/*
 * A reshape is planned from the displayed source and recipient. A newer source reaching the local engine while capture
 * waits must refuse the entire action; neither the source nor the recipient may be changed. The real note facade and
 * canonical capture preflight run here; the engine transaction/restart/delivery have their own integration suites.
 */
jest.mock('@/data-engine/react.client', () => ({ ...jest.requireActual('@/data-engine/react.client'), useDataCollection: jest.fn(), useDocumentActions: jest.fn() }));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: 'u', isAuthLoading: false }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));

type Row = Record<string, unknown> & { analysis: { relations: Record<string, unknown> } };
const TEXT: BookText = { id: 'Ephesians', chapters: [['Paul apostle of God', 'Grace and peace to you', 'Blessed be God our Father']] };
const row = (id: string, fromVerse: number, toVerse: number, cuts: number[]): Row => ({
  id, userId: 'u', type: 'analysis', title: id, content: '', tags: [], createdAt: '', updatedAt: '',
  scriptureRefs: [{ id: `r-${id}`, bible: 'rst', book: 'Ephesians', chapter: 1, fromVerse, toVerse }],
  analysis: storedAnalysis({ cuts, links: {}, relations: [] }, 'rst', passageWords(TEXT, { chapter: 1, fromVerse, toChapter: 1, toVerse }).length) as unknown as Row['analysis'],
});

it('refuses the whole reshape when its source changed while capture waited, retaining the newer link', async () => {
  const rows: Record<string, Row> = { a: row('a', 1, 2, [5]), b: row('b', 3, 3, []) };
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const writes: string[] = [];
  const snapshot = (id: string): ResourceSnapshot => ({ resource: { collection: 'studyNotes', id },
    metadata: { protocol: 1, generation: id, revision: 1, deleted: false }, value: rows[id] as DocumentData });
  (useDataCollection as jest.Mock).mockImplementation(() => ({
    loading: false, state: { documents: Object.entries(rows).map(([id, value]) => ({ resource: { collection: 'studyNotes', id }, value })) },
  }));
  const reshapeStudyAnalysis = jest.fn(async (edits: Parameters<typeof captureAnalysisReshape>[2]) => {
    await held;
    // The public facade passes the actual displayed baselines into the existing capture owner.
    captureAnalysisReshape('u', 'reshape-action', edits, Object.keys(rows).map(snapshot), []);
    for (const edit of edits) { writes.push(edit.resource.id); rows[edit.resource.id] = edit.value as Row; }
  });
  (useDocumentActions as jest.Mock).mockReturnValue({ reshapeStudyAnalysis });
  const { result } = renderHook(() => useAnalysisReshape({ text: TEXT, bookId: 'Ephesians', bible: 'rst', locale: 'en' }));
  let pending: Promise<unknown> = Promise.resolve(null);
  act(() => { pending = result.current('a', { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 1 }); });
  expect(reshapeStudyAnalysis).toHaveBeenCalledTimes(1);
  expect(writes).toEqual([]);
  const originalRecipient = rows.b;
  // The newer link reaches the local engine before the whole action is captured.
  rows.a = { ...rows.a, analysis: { ...rows.a.analysis, relations: { '0-2': { dir: 'fwd', color: 'teal' } } } };
  let failure: unknown;
  await act(async () => { release(); try { await pending; } catch (error) { failure = error; } });
  expect(rows.a.analysis.relations['0-2']).toEqual({ dir: 'fwd', color: 'teal' });
  expect(failure).toMatchObject({ message: 'resolve-version-first' });
  expect(rows.b).toBe(originalRecipient);
  expect(writes).toEqual([]);
});
