import { renderHook, waitFor } from '@testing-library/react';

import { useDataCollection } from '@/data-engine/react.client';
import { useCouncilsDataCollection } from '@/hooks/useCouncilsDataCollection';

import type { CollectionState } from '@/data-engine/collections';
import type { DocumentData, ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/data-engine/react.client', () => ({ useDataCollection: jest.fn() }));

const snapshot = (id: string, value: DocumentData | null, deleted = false): ResourceSnapshot => ({
  resource: { collection: 'councils', id },
  value,
  metadata: { protocol: 1, generation: `gen-${id}`, revision: 3, deleted },
});

const council = (title: string, extra: DocumentData = {}): DocumentData => ({
  userId: 'owner', title, status: 'preparing', topics: [], createdAt: '2026-09-01', updatedAt: '2026-09-02', ...extra,
});

const state = (snapshots: ResourceSnapshot[], overrides: Partial<CollectionState> = {}): CollectionState => ({
  snapshots, complete: true, freshness: 'server', checking: false, version: 4, error: null, ...overrides,
});

function setup(value: CollectionState | null, extra: Partial<ReturnType<typeof useDataCollection>> = {}) {
  const refresh = jest.fn();
  jest.mocked(useDataCollection).mockReturnValue({ state: value, loading: false, error: null, refresh, ...extra } as ReturnType<typeof useDataCollection>);
  return { ...renderHook(() => useCouncilsDataCollection()), refresh };
}

beforeEach(() => jest.clearAllMocks());

describe('useCouncilsDataCollection', () => {
  it('uses the submitted presentation and reserves queued creation ids without claiming a server read', () => {
    const { result } = setup(state([], { complete: false, freshness: 'unknown', documents: [{
      resource: { collection: 'councils', id: 'queued' }, value: council('Queued'), pending: true, needsAttention: false, deleting: false,
    }] }));
    expect(result.current.councils[0]).toMatchObject({ id: 'queued', title: 'Queued' });
    expect(result.current.knownIds.has('queued')).toBe(true);
    expect(result.current.serverAnswered).toBe(false);
    expect(result.current.state?.snapshots).toEqual([]);
  });
  it('shapes engine snapshots into councils the screens already understand', () => {
    const { result } = setup(state([snapshot('b', council('Second', { rev: 7 })), snapshot('a', council('First'))]));
    expect(result.current.councils).toEqual([
      { id: 'a', userId: 'owner', title: 'First', status: 'preparing', topics: [], createdAt: '2026-09-01', updatedAt: '2026-09-02', rev: 0 },
      { id: 'b', userId: 'owner', title: 'Second', status: 'preparing', topics: [], createdAt: '2026-09-01', updatedAt: '2026-09-02', rev: 7 },
    ]);
  });

  // A tombstone is kept in the collection state on purpose; the list must not show it.
  it('hides deleted and absent documents without hiding the rest', () => {
    const { result } = setup(state([
      snapshot('gone', null, true), snapshot('missing', null), snapshot('kept', council('Kept')),
    ]));
    expect(result.current.councils.map(item => item.id)).toEqual(['kept']);
  });

  // hydrateCouncil does the same for the legacy road: a document written before these fields
  // existed must not reach a screen that expects an array and a number.
  it('repairs a legacy document that predates topics and rev', () => {
    const { result } = setup(state([snapshot('old', { userId: 'owner', title: 'Old', status: 'held', createdAt: 'x', updatedAt: 'y' })]));
    expect(result.current.councils[0]).toMatchObject({ id: 'old', topics: [], rev: 0 });
  });

  it('reports an incomplete offline cache instead of an authoritative empty list', () => {
    const { result } = setup(state([], { complete: false, freshness: 'cache' }));
    expect(result.current.councils).toEqual([]);
    expect(result.current.complete).toBe(false);
    expect(result.current.freshness).toBe('cache');
  });

  // The pre-database carry-over re-creates whatever the server "does not have". A cursor restored
  // from disk says `complete` offline too, and a tombstone is not in the list of councils.
  it('says the server answered only for a server read of THIS session, and knows ids it no longer shows', () => {
    const rows = [snapshot('gone', null, true), snapshot('kept', council('Kept'))];
    expect(setup(state(rows, { complete: true, freshness: 'cache' })).result.current.serverAnswered).toBe(false);
    const fresh = setup(state(rows)).result.current;
    expect(fresh.serverAnswered).toBe(true);
    expect([...fresh.knownIds].sort()).toEqual(['gone', 'kept']);
    expect(fresh.councils.map(item => item.id)).toEqual(['kept']);
  });

  it('asks for the collection by name and forwards loading, error and refresh', async () => {
    const { result, refresh } = setup(null, { loading: true, error: 'engine offline' });
    expect(jest.mocked(useDataCollection)).toHaveBeenCalledWith('councils');
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe('engine offline');
    await result.current.refresh();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});
