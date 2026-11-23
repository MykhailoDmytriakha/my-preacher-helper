import { act, renderHook } from '@testing-library/react';
import React from 'react';

import { useSermonActions } from '@/(pages)/(private)/sermons/[id]/structure/hooks/useSermonActions';
import { StructureWriterContext, type StructureWriter } from '@/components/sermon/structureWriter';
import { awaitWriteOperation, type WriteOperation } from '@/utils/recoverableWrite';

import type { Item, Sermon, Thought } from '@/models/models';

jest.mock('sonner');

const thought: Thought = { id: 'existing', text: 'Original words', tags: [], date: '2026-10-19' };
const item: Item = { id: 'existing', content: 'Original words', requiredTags: [], customTagNames: [] };
const initial: Sermon = { id: 'sermon', title: 'Grace', verse: 'John 1:14', date: '2026-10-19', userId: 'owner',
  thoughts: [thought], structure: { introduction: [], main: ['existing'], conclusion: [], ambiguous: [] } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
it('keeps the structural update scoped to the captured deletion', async () => {
  const captured = deferred<void>();
  const writer: StructureWriter = {
    createManualThought: jest.fn(), updateThought: jest.fn(),
    deleteThought: jest.fn(() => captured.promise), updateStructure: jest.fn().mockResolvedValue(undefined),
    updateSermonOutline: jest.fn(),
  };
  const setSermon = jest.fn();
  const containers = { introduction: [], main: [item], conclusion: [], ambiguous: [] };
  const { result } = renderHook(() => useSermonActions({
    sermon: initial, setSermon, containers, setContainers: jest.fn(), containersRef: { current: containers },
  }), { wrapper: ({ children }) => <StructureWriterContext.Provider value={writer}>{children}</StructureWriterContext.Provider> });
  let deletion!: WriteOperation;
  act(() => { deletion = result.current.handleDeleteThought(thought.id); });
  expect(writer.deleteThought).toHaveBeenCalledWith(initial.id, thought);
  expect(writer.updateStructure).not.toHaveBeenCalled();
  await act(async () => {
    captured.resolve();
    await awaitWriteOperation(deletion, () => undefined);
  });
  expect(writer.updateStructure).toHaveBeenCalledTimes(1);
  expect(setSermon.mock.calls[0][0](initial)?.thoughts).toEqual([]);
});
