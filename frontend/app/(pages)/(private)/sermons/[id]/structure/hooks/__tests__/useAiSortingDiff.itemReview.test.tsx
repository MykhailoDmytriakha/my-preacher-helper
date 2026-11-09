import React, { useState } from 'react';
import { act, renderHook } from '@testing-library/react';

import { StructureWriterContext } from '@/components/sermon/structureWriter';
import { createEngineStructureWriter } from '@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter';
import { sortItemsWithAI } from '@/services/sortAI.service';
import type { DocumentData } from '@/data-engine/types';
import type { Item, Sermon, ThoughtsBySection } from '@/models/models';

import { useAiSortingDiff } from '../useAiSortingDiff';

jest.mock('@/services/sortAI.service');
jest.mock('sonner');

const ids = ['a', 'b', 'c', 'd'];
const structure = (main: string[]): ThoughtsBySection => ({ introduction: [], main, conclusion: [], ambiguous: [] });
const items: Item[] = ids.map(id => ({ id, content: `Authored ${id}`, requiredTags: ['main'], customTagNames: [], outlinePointId: 'point' }));
const initial: Sermon = {
  id: 'sermon', userId: 'owner', title: 'Review', verse: 'John 3:16', date: '2026-10-19',
  thoughts: ids.map(id => ({ id, text: `Authored ${id}`, tags: ['main'], date: '2026-10-19', outlinePointId: 'point' })),
  outline: { introduction: [], main: [{ id: 'point', text: 'Point' }], conclusion: [] },
  structure: structure(ids), thoughtsBySection: structure(ids),
};

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Real domain writer, with a recording device-capture boundary instead of transport. */
function setup() {
  let stored = JSON.parse(JSON.stringify(initial)) as unknown as DocumentData;
  let draft = stored;
  let capture: Promise<void> | undefined;
  let writes = 0;
  const writer = createEngineStructureWriter({
    update: async updater => {
      writes += 1;
      draft = stored = updater(draft)!;
    },
    captureReview: async (_selected, updater) => {
      writes += 1;
      const privateStage = updater(draft)!;
      if (capture) await capture;
      draft = stored = privateStage;
    },
  }, 'owner');
  const hook = renderHook(() => {
    const [containers, setContainers] = useState<Record<string, Item[]>>({ introduction: [], main: items, conclusion: [], ambiguous: [] });
    const review = useAiSortingDiff({ containers, setContainers, outlinePoints: initial.outline!, sermon: initial, sermonId: initial.id,
      debouncedSaveStructure: (...args) => { void writer.updateStructure(...args).catch(() => undefined); },
      debouncedSaveThought: (...args) => { void writer.updateThought(...args).catch(() => undefined); },
    });
    return { ...review, containers };
  }, { wrapper: ({ children }) => <StructureWriterContext.Provider value={writer}>{children}</StructureWriterContext.Provider> });
  return { ...hook, order: () => (stored.structure as unknown as ThoughtsBySection).main,
    writes: () => writes,
    location: (id: string) => (stored.thoughts as unknown as Sermon['thoughts']).find(thought => thought.id === id)?.subPointId,
    receivePlacement: (id: string, subPointId: string) => {
      stored = { ...stored, thoughts: (stored.thoughts as DocumentData[]).map(row => row.id === id ? { ...row, subPointId } : row) };
      draft = stored;
    },
    hold: (promise: Promise<void>) => { capture = promise; }, words: () => (stored.thoughts as unknown as Sermon['thoughts']).map(t => t.text) };
}

async function propose(hook: ReturnType<typeof setup>) {
  jest.mocked(sortItemsWithAI).mockResolvedValue([...items].reverse());
  await act(async () => { await hook.result.current.handleAiSort({ columnId: 'main', outlinePointId: 'point' }); });
  expect(hook.order()).toEqual(ids);
  expect(Object.keys(hook.result.current.highlightedItems)).toHaveLength(4);
}

beforeEach(() => jest.clearAllMocks());

describe('one AI review decision at the actual structure writer', () => {
  it('keeps only A at its proposed place without accepting B/C/D', async () => {
    const hook = setup(); await propose(hook);
    await act(async () => { await hook.result.current.handleKeepItem('a', 'main'); });
    expect(hook.order()).toEqual(['b', 'c', 'd', 'a']);
    expect(Object.keys(hook.result.current.highlightedItems).sort()).toEqual(['b', 'c', 'd']);
    expect(hook.words()).toEqual(ids.map(id => `Authored ${id}`));
  });

  it('rejects A without saving any unreviewed proposal', async () => {
    const hook = setup(); await propose(hook);
    await act(async () => { await hook.result.current.handleRevertItem('a', 'main'); });
    expect(hook.order()).toEqual(ids);
    expect(Object.keys(hook.result.current.highlightedItems).sort()).toEqual(['b', 'c', 'd']);
  });

  it.each(['one suggestion', 'all suggestions'])('dismisses %s without writing over a separately saved placement', async mode => {
    const hook = setup();
    jest.mocked(sortItemsWithAI).mockResolvedValue(items.map(item => item.id === 'a' ? { ...item, subPointId: 'proposal' } : item));
    await act(async () => { await hook.result.current.handleAiSort({ columnId: 'main', outlinePointId: 'point' }); });
    expect(hook.result.current.highlightedItems.a?.type).toBe('assigned');
    hook.receivePlacement('a', 'manual');
    await act(async () => {
      if (mode === 'one suggestion') await hook.result.current.handleRevertItem('a', 'main');
      else await hook.result.current.handleRevertAll('main');
    });
    expect(hook.result.current.highlightedItems.a).toBeUndefined();
    expect({ writes: hook.writes(), savedSubpoint: hook.location('a') }).toEqual({ writes: 0, savedSubpoint: 'manual' });
  });

  it('keeps the chosen review available while device capture is held', async () => {
    const hook = setup(); await propose(hook); const gate = deferred(); hook.hold(gate.promise);
    let operation: unknown;
    await act(async () => { operation = hook.result.current.handleKeepItem('a', 'main'); });
    try {
      expect(hook.result.current.highlightedItems.a).toBeDefined();
      expect(hook.order()).toEqual(ids);
    } finally {
      await act(async () => { gate.resolve(); await Promise.resolve(operation); });
    }
  });

  it('restores no false acceptance after device capture refuses', async () => {
    const hook = setup(); await propose(hook); const gate = deferred(); hook.hold(gate.promise);
    let operation: Promise<unknown>;
    await act(async () => { operation = Promise.resolve(hook.result.current.handleKeepItem('a', 'main')).catch(() => undefined); });
    await act(async () => { gate.reject(new Error('Device capture refused')); await operation!; });
    expect(hook.result.current.highlightedItems.a).toBeDefined();
    expect(hook.result.current.isDiffModeActive).toBe(true);
    expect(hook.order()).toEqual(ids);
  });

  it('cancels remaining suggestions without undoing the accepted A placement', async () => {
    const hook = setup(); await propose(hook);
    await act(async () => { await hook.result.current.handleKeepItem('a', 'main'); });
    await act(async () => { await hook.result.current.handleRevertAll('main'); });
    expect(hook.result.current.containers.main.map(item => item.id)).toEqual(['b', 'c', 'd', 'a']);
    expect(hook.order()).toEqual(['b', 'c', 'd', 'a']);
    expect(hook.result.current.isDiffModeActive).toBe(false);
  });
  it('can reject a refused acceptance without later saving its abandoned draft', async () => {
    const hook = setup(); await propose(hook); const gate = deferred(); hook.hold(gate.promise);
    let operation!: Promise<unknown>;
    await act(async () => { operation = Promise.resolve(hook.result.current.handleKeepItem('a', 'main')).catch(() => undefined); });
    await act(async () => { gate.reject(new Error('Device capture refused')); await operation; });
    hook.hold(Promise.resolve());
    await act(async () => { await hook.result.current.handleRevertItem('a', 'main'); });
    expect(hook.order()).toEqual(ids);
    expect(hook.result.current.highlightedItems.a).toBeUndefined();
  });

});
