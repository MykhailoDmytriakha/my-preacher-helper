import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React, { useCallback } from 'react';

import { collectionRecordPresence } from '@/data-engine/recordPresence';
import { useDataCollection } from '@/data-engine/react.client';
import { useStudyNoteShareLinks } from '@/hooks/useStudyNoteShareLinks';
import { getStudyNoteShareLinks } from '@/services/studyNoteShareLinks.service';
import { shareLinksKey } from '@/utils/studyNoteShareLinkWrites';

import type { CollectionState } from '@/data-engine/collections';
import type { ResourceSnapshot } from '@/data-engine/types';
import type { StudyNoteShareLink } from '@/models/models';

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataCollection: jest.fn(),
}));
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: mockOwner }, loading: false, isAuthenticated: true }),
}));
jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
jest.mock('@/services/studyNoteShareLinks.service', () => ({
  getStudyNoteShareLinks: jest.fn(),
  createStudyNoteShareLink: jest.fn(),
  deleteStudyNoteShareLink: jest.fn(),
}));

let mockOwner = 'owner';
let mockState: CollectionState | null;
const snapshot = (deleted = false, revision = 1): ResourceSnapshot => ({
  resource: { collection: 'studyNotes', id: 'note' },
  value: deleted ? null : { userId: mockOwner, content: 'Saved comment' },
  metadata: { protocol: 1, generation: 'generation', revision, deleted },
});
const state = (snapshots: ResourceSnapshot[] = [snapshot()]): CollectionState => ({
  snapshots, documents: [], complete: true, freshness: 'server', checking: false, version: 1, error: null,
});
const links = (ownerId = mockOwner): StudyNoteShareLink[] => ['note', 'other-note'].map((noteId) => ({
  id: 'link-' + noteId, noteId, ownerId, token: 'token-' + noteId,
  createdAt: '2026-10-29T00:00:00Z', viewCount: 0,
}));

function useMockCollection(collection: string | null) {
  const answer = collection ? mockState : null;
  const presence = useCallback((id: string) => collectionRecordPresence({ collection: collection ?? '', id }, answer), [collection, answer]);
  return { state: answer, presence, loading: false, readOnly: false, error: null,
    refresh: jest.fn(async () => answer ?? state([])), refreshPresence: jest.fn(async (id: string) => presence(id)) };
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(shareLinksKey(mockOwner), links());
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useStudyNoteShareLinks(), { wrapper });
  return { ...hook, client };
}

beforeEach(() => {
  jest.clearAllMocks(); mockOwner = 'owner'; mockState = state();
  jest.mocked(useDataCollection).mockImplementation(useMockCollection);
  jest.mocked(getStudyNoteShareLinks).mockResolvedValue(links());
});
afterEach(() => window.localStorage.clear());

describe('share links after canonical note retirement', () => {
  it('removes only the retired note link from a fresh cached list without another request', () => {
    const { result, rerender } = setup();
    expect(result.current.shareLinks).toEqual(links());
    mockState = state([snapshot(true, 2)]); rerender();
    expect(result.current.shareLinks).toEqual([links()[1]]);
    expect(getStudyNoteShareLinks).not.toHaveBeenCalled();
  });

  it('keeps an accepted retirement visible to the reader before the collection feed catches up', () => {
    mockState = state();
    mockState.documents = [{ resource: snapshot().resource, value: null, pending: false, deleting: false, needsAttention: false, acknowledged: snapshot(true, 2) }];
    const { result } = setup();
    expect(result.current.shareLinks).toEqual([links()[1]]);
  });

  it('does not restore an old cached link when an accepted tombstone is read offline after reload', () => {
    mockState = { ...state([snapshot(true, 2)]), freshness: 'cache', complete: false, error: 'offline' };
    expect(collectionRecordPresence(snapshot().resource, mockState).kind).toBe('unknown');
    const { result } = setup();
    expect(result.current.shareLinks).toEqual([links()[1]]);
  });

  it.each(['unknown', 'incomplete', 'complete-missing', 'failed'] as const)('does not infer retirement from a %s note list', (kind) => {
    mockState = kind === 'unknown' ? null : { ...state([]), complete: kind === 'complete-missing', freshness: kind === 'incomplete' ? 'cache' : 'server', error: kind === 'failed' ? 'offline' : null };
    const { result } = setup();
    expect(result.current.shareLinks).toEqual(links());
  });

  it('does not claim a live link is retired while the local delete still awaits acknowledgement', () => {
    mockState = state();
    mockState.documents = [{ resource: snapshot().resource, value: snapshot().value, pending: true, deleting: true, needsAttention: false }];
    expect(collectionRecordPresence(snapshot().resource, mockState).kind).toBe('deleting');
    const { result } = setup();
    expect(result.current.shareLinks).toEqual(links());
  });

  it('does not revive a retired generation from an invalid later live acknowledgement', () => {
    mockState = state([snapshot(true, 2)]);
    mockState.documents = [{ resource: snapshot().resource, value: snapshot().value, pending: false, deleting: false, needsAttention: false, acknowledged: snapshot(false, 3) }];
    const { result } = setup();
    expect(result.current.shareLinks).toEqual([links()[1]]);
  });

  it('does not apply the previous owner collection to the next owner link cache', () => {
    mockState = state([snapshot(true, 2)]);
    const { result, rerender, client } = setup();
    mockOwner = 'next-owner'; mockState = null;
    client.setQueryData(shareLinksKey(mockOwner), links()); rerender();
    expect(result.current.uid).toBe('next-owner');
    expect(result.current.shareLinks).toEqual(links());
  });

  it('keeps an older in-flight list response from resurrecting a retired link', async () => {
    const { result, rerender, client } = setup();
    let release!: (value: StudyNoteShareLink[]) => void;
    jest.mocked(getStudyNoteShareLinks).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    let request!: Promise<void>;
    act(() => { request = client.refetchQueries({ queryKey: shareLinksKey(mockOwner) }); });
    await waitFor(() => expect(getStudyNoteShareLinks).toHaveBeenCalledTimes(1));
    mockState = state([snapshot(true, 2)]); rerender();
    await act(async () => { release(links()); await request; });
    expect(result.current.shareLinks).toEqual([links()[1]]);
  });

  it('retains the filtered array identity when neither canonical presence nor links changed', () => {
    mockState = state([snapshot(true, 2)]);
    const { result, rerender } = setup();
    const first = result.current.shareLinks; rerender();
    expect(result.current.shareLinks).toBe(first);
  });
});
