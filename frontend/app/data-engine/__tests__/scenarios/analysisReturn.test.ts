/** @jest-environment node */
import { DeviceWorld, noteRef, noteValue } from '@test-utils/deviceWorld';
import { request } from '@test-utils/checkpointFixtures';

import { analysisMarkdown, cutAt, EMPTY_ANALYSIS, passageWords, storedAnalysis } from '@/utils/passageAnalysis';
import { ANALYSIS_RESHAPE_FRAME } from '../../analysisReshapeFields';
import { initializeCommit } from '../../atomicCommits';
import { readField } from '../../fieldValues';
import { processCommand } from '../../server';

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

  it.each([
    { label: 'earlier', offset: 1000, kind: 'acknowledged', offlineLater: false },
    { label: 'later', offset: 9000, kind: 'acknowledged', offlineLater: true },
    { label: 'overlapping time', offset: 8001, kind: 'conflict', offlineLater: false },
  ])('orders a returned frame with $label action evidence', async ({ offset, kind, offlineLater }) => {
    world = new DeviceWorld();
    await world.seed(noteRef, opening);
    const seeded = await world.snapshot(noteRef);
    const phone = { ...opening, ...stored(withCut(5)) };
    const desktop = { ...opening, ...stored(withCut(8)) };
    const send = (operationId: string, before: DocumentData, after: DocumentData, observedRevision: number, at: number) => {
      const command = { protocol: 1, kind: 'update', owner: 'owner', operationId, resource: noteRef,
        generation: seeded.metadata!.generation, dependsOn: [],
        changes: ANALYSIS_RESHAPE_FRAME.map(field => ({ path: [field], before: readField(before, [field]), after: readField(after, [field]) })),
        analysisFrameObservedRevision: observedRevision, analysisFrameActionTime: { earliestMs: at, latestMs: at + 3 },
      };
      return processCommand('owner', command);
    };
    const first = world.now;
    await world.advance(10_000);
    expect((await send('desktop-edit', opening, desktop, 1, first + 5000)).kind).toBe('acknowledged');
    expect((await send('desktop-return', desktop, opening, 2, first + 8000)).kind).toBe('acknowledged');
    const reply = await send('offline-first-delivery', opening, phone, 1, first + offset);
    expect(reply.kind).toBe(kind);
    expect((await world.snapshot(noteRef)).value).toMatchObject(offlineLater ? stored(withCut(5)) : stored(EMPTY_ANALYSIS));
    const archived = world.history(noteRef).filter(item => item.path.includes('/_analysisFrameHistory/'));
    if (kind === 'conflict') {
      expect(reply).toMatchObject({ conflicts: ANALYSIS_RESHAPE_FRAME.map(field => expect.objectContaining({ path: [field] })) });
      expect(archived).toHaveLength(0);
      return;
    }
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ fields: expect.arrayContaining([
      { field: 'analysis', value: { exists: true, value: offlineLater ? opening.analysis : phone.analysis },
        winnerDigest: expect.any(String), time: expect.any(Object), winnerTime: expect.any(Object) },
      { field: 'content', value: { exists: true, value: offlineLater ? opening.content : phone.content },
        winnerDigest: expect.any(String), time: expect.any(Object), winnerTime: expect.any(Object) },
    ]) });
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
