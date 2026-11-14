/** @jest-environment node */
import { DeviceWorld, noteRef, noteValue } from '@test-utils/deviceWorld';

import { analysisMarkdown, cutAt, EMPTY_ANALYSIS, passageWords, storedAnalysis } from '@/utils/passageAnalysis';
import { initializeCommit } from '../../atomicCommits';
import { request } from '@test-utils/checkpointFixtures';

import john from '../../../../public/bible-text/kjv/v1/john.json';

import type { BookText } from '@/utils/bibleText';
import type { DocumentData } from '../../types';
import type { CommitRequest } from '../../commits';

const words = passageWords(john as BookText, { chapter: 3, fromVerse: 16, toChapter: 3, toVerse: 16 });
const withCut = (position: number) => cutAt(EMPTY_ANALYSIS, position, words.length)!;
const stored = (state: typeof EMPTY_ANALYSIS) => ({
  analysis: storedAnalysis(state, 'kjv', words.length) as unknown as DocumentData, content: analysisMarkdown(words, state),
});
const opening = { ...noteValue(), type: 'analysis', title: 'John 3:16',
  scriptureRefs: [{ id: 'john-3-16', bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16, toVerse: 16 }], ...stored(EMPTY_ANALYSIS) };

describe('Delayed first delivery of an analysis after a deliberate return', () => {
  let world: DeviceWorld;
  afterEach(() => world?.dispose());

  it('keeps the later same-passage return and offers the earlier offline text and analysis together', async () => {
    world = new DeviceWorld();
    const earlier = stored(withCut(5)), later = stored(withCut(8));
    await world.seed(noteRef, opening);
    const tablet = await world.device('tablet'), desktop = await world.device('desktop');
    await tablet.open(noteRef);
    await desktop.open(noteRef);
    tablet.goOffline();
    await tablet.save(noteRef, value => ({ ...value, ...earlier }));
    await world.advance(60_000);
    await desktop.save(noteRef, value => ({ ...value, ...later }));
    expect((await world.snapshot(noteRef)).value).toMatchObject(later);
    await desktop.save(noteRef, value => ({ ...value, ...stored(EMPTY_ANALYSIS) }));
    expect((await world.snapshot(noteRef)).value).toMatchObject(stored(EMPTY_ANALYSIS));
    await tablet.goOnline();
    expect((await world.snapshot(noteRef)).value).toMatchObject(stored(EMPTY_ANALYSIS));
    expect(tablet.shown(noteRef).draft).toMatchObject(earlier);
    expect(await world.questions()).toEqual([expect.objectContaining({
      device: 'tablet', document: 'studyNotes/note-x', kind: 'conflict', fields: ['analysis', 'content', 'scriptureRefs'],
    })]);
  });

  it('allows an offline split after only the title changed, including a queued undo and a fresh split', async () => {
    world = new DeviceWorld();
    await world.seed(noteRef, opening);
    const tablet = await world.device('tablet'), desktop = await world.device('desktop');
    await tablet.open(noteRef);
    await desktop.open(noteRef);
    tablet.goOffline();
    await tablet.save(noteRef, value => ({ ...value, ...stored(withCut(5)) }));
    await tablet.save(noteRef, value => ({ ...value, ...stored(EMPTY_ANALYSIS) }));
    await desktop.save(noteRef, value => ({ ...value, title: 'My new analysis title' }));
    await tablet.goOnline();
    expect((await world.snapshot(noteRef)).value).toMatchObject({ title: 'My new analysis title', ...stored(EMPTY_ANALYSIS) });
    await tablet.save(noteRef, value => ({ ...value, ...stored(withCut(8)) }));
    expect((await world.snapshot(noteRef)).value).toMatchObject({ title: 'My new analysis title', ...stored(withCut(8)) });
    expect(await world.questions()).toEqual([]);
  });

  it.each([true, false])('keeps the earlier observation when a replay includes a newer returned frame (receipt proof: %s)', exact => {
    const value = { ...opening, ...stored(withCut(5)) };
    const metadata = { protocol: 1 as const, generation: 'analysis-generation', revision: 1, deleted: false };
    const initial = { resource: noteRef, value: opening, metadata };
    const accepted = { ...metadata, revision: 2, operationId: 'predecessor' };
    const replay = { ...initial, value, metadata: { ...metadata, revision: 4, operationId: 'other-return' } };
    const prior: CommitRequest = { ...request('predecessor'), baseline: initial, working: replay, value, intended: value, state: 'acknowledged',
      result: { kind: 'acknowledged', operationId: 'predecessor', ...(exact && { committed: accepted }), snapshot: replay } };
    const later = { ...opening, ...stored(withCut(8)) };
    const saved: CommitRequest = { ...request('successor'), baseline: initial, working: initial, value: later, intended: later,
      predecessor: prior.id, initialized: false };
    expect(initializeCommit(saved, [prior, saved])).toMatchObject({
      analysisFramePredecessorRevision: exact ? 2 : 1, working: replay,
    });
  });
});
