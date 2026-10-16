import { act, renderHook, waitFor } from '@testing-library/react';

import { useRecordingDrafts } from '@/hooks/useRecordingDrafts';
import { deleteRecordingDraft, listRecordingDrafts } from '@/utils/recordingDraftStore';

import type { RecordingDraft } from '@/utils/recordingDraftStore';

let mockOwner: string | null = 'alice';
const mockListeners = new Set<() => void>();
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: mockOwner ? { uid: mockOwner } : null }) }));
jest.mock('@/utils/recordingDraftStore', () => ({
  listRecordingDrafts: jest.fn(), deleteRecordingDraft: jest.fn(),
  saveRecordingDraft: jest.fn(), adoptLegacyRecordingDrafts: jest.fn().mockResolvedValue(0),
  subscribeRecordingDrafts: jest.fn((listener: () => void) => { mockListeners.add(listener); return () => { mockListeners.delete(listener); }; }),
}));
const list = jest.mocked(listRecordingDrafts);
const remove = jest.mocked(deleteRecordingDraft);
const makeDraft = (ownerId: string): RecordingDraft => ({
  id: ownerId + '-take', ownerId, context: 'thought', contextId: 'sermon-a',
  blob: new Blob(['voice']), mimeType: 'audio/webm', createdAt: 1000, sizeBytes: 5,
});
const ids = (drafts: RecordingDraft[]) => drafts.map(draft => draft.id);

beforeEach(() => {
  mockOwner = 'alice';
  mockListeners.clear();
  list.mockReset().mockImplementation(async filter => {
    const owner = filter?.ownerId ?? mockOwner;
    return owner ? [makeDraft(owner)] : [];
  });
  remove.mockReset().mockResolvedValue(undefined);
});

it('never renders the previous account source while loading the next account', async () => {
  const view = renderHook(() => useRecordingDrafts('thought', 'sermon-a'));
  await waitFor(() => expect(ids(view.result.current.drafts)).toEqual(['alice-take']));
  mockOwner = 'bob';
  view.rerender();
  expect(ids(view.result.current.drafts)).toEqual([]);
  await waitFor(() => expect(ids(view.result.current.drafts)).toEqual(['bob-take']));
});

it('removes the source from view as soon as its owner signs out', async () => {
  const view = renderHook(() => useRecordingDrafts('thought', 'sermon-a'));
  await waitFor(() => expect(ids(view.result.current.drafts)).toEqual(['alice-take']));
  mockOwner = null;
  view.rerender();
  expect(ids(view.result.current.drafts)).toEqual([]);
});

it('keeps the recoverable card when its persisted removal is refused', async () => {
  const view = renderHook(() => useRecordingDrafts('thought', 'sermon-a'));
  await waitFor(() => expect(ids(view.result.current.drafts)).toEqual(['alice-take']));
  remove.mockRejectedValueOnce(new Error('Device storage refused deletion'));
  await act(async () => {
    await expect(view.result.current.removeDraft('alice-take')).rejects.toThrow('Device storage refused deletion');
  });
  expect(ids(view.result.current.drafts)).toEqual(['alice-take']);
});


it('offers a source saved while its recovery list is already open', async () => {
  list.mockResolvedValueOnce([]);
  const view = renderHook(() => useRecordingDrafts('thought', 'sermon-a'));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  list.mockResolvedValueOnce([makeDraft('alice')]);
  act(() => { mockListeners.forEach(listener => listener()); });
  await waitFor(() => expect(ids(view.result.current.drafts)).toEqual(['alice-take']));
});

it('does not replace a newer draft list with an older read that finishes later', async () => {
  let finishOld!: (drafts: RecordingDraft[]) => void;
  list.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; })).mockResolvedValue([]);
  const view = renderHook(() => useRecordingDrafts('thought', 'sermon-a'));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  act(() => { for (const listener of mockListeners) listener(); });
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  await act(async () => { finishOld([makeDraft('alice')]); });
  expect(ids(view.result.current.drafts)).toEqual([]);
  view.unmount();
});
