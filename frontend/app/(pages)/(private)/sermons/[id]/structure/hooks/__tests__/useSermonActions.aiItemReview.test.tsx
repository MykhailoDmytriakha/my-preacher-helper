import React, { useRef, useState } from 'react';
import { act, renderHook } from '@testing-library/react';

import { StructureWriterContext } from '@/components/sermon/structureWriter';
import { createEngineStructureWriter } from '@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter';
import type { DocumentData } from '@/data-engine/types';
import type { Item, Sermon, ThoughtsBySection } from '@/models/models';
import { awaitWriteOperation, type WriteOperation } from '@/utils/recoverableWrite';

import { useSermonActions } from '../useSermonActions';

jest.mock('sonner');
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'owner' }, loading: false }),
}));
jest.mock('@services/firebaseAuth.service', () => ({ auth: { currentUser: { uid: 'owner' } } }));

const originalIds = ['a', 'b', 'c', 'd'];
const reversedIds = [...originalIds].reverse();
const makeStructure = (main: string[], ambiguous: string[] = []): ThoughtsBySection => ({
  introduction: [], main, conclusion: [], ambiguous,
});
const initial: Sermon = {
  id: 'sermon', userId: 'owner', title: 'Review', verse: 'John 3:16', date: '2026-10-19',
  thoughts: originalIds.map(id => ({ id, text: `Authored ${id}`, tags: ['main'], date: '2026-10-19', outlinePointId: 'point' })),
  outline: { introduction: [], main: [{ id: 'point', text: 'Point' }], conclusion: [] },
  structure: makeStructure(originalIds), thoughtsBySection: makeStructure(originalIds),
};
const previewItems: Item[] = reversedIds.map(id => ({
  id, content: `Authored ${id}`, requiredTags: ['main'], customTagNames: [], outlinePointId: 'point',
}));

/** Exercises the real action hook and engine writer over a local document snapshot. */
function setup() {
  let stored = JSON.parse(JSON.stringify(initial)) as unknown as DocumentData;
  const writer = createEngineStructureWriter({
    update: async updater => { stored = updater(stored)!; },
  }, 'owner');
  const hook = renderHook(() => {
    const [sermon, setSermon] = useState<Sermon | null>(initial);
    const [containers, setContainers] = useState<Record<string, Item[]>>({
      introduction: [], main: previewItems, conclusion: [], ambiguous: [],
    });
    const containersRef = useRef(containers);
    const actions = useSermonActions({
      sermon,
      setSermon,
      containers,
      setContainers,
      containersRef,
    });
    return { ...actions, containers };
  }, {
    wrapper: ({ children }) => <StructureWriterContext.Provider value={writer}>{children}</StructureWriterContext.Provider>,
  });

  const saved = () => stored as unknown as Sermon;
  return { ...hook, saved };
}

describe('useSermonActions while an AI order is awaiting review', () => {
  it('deletes one thought without saving the unreviewed order of the remaining thoughts', async () => {
    const hook = setup();
    let submission!: WriteOperation;
    act(() => { submission = hook.result.current.handleDeleteThought('a'); });
    await act(async () => { await awaitWriteOperation(submission, () => undefined); });

    expect(hook.saved().structure?.main).toEqual(['b', 'c', 'd']);
  });

  it('moves one thought to ambiguous without saving the unreviewed order of the remaining thoughts', async () => {
    const hook = setup();
    let submission!: WriteOperation;
    act(() => { submission = hook.result.current.handleMoveToAmbiguous('a', 'main'); });
    await act(async () => { await awaitWriteOperation(submission, () => undefined); });

    expect(hook.saved().structure?.main).toEqual(['b', 'c', 'd']);
    expect(hook.saved().structure?.ambiguous).toEqual(['a']);
  });
});
