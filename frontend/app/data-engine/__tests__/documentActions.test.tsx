import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider, useDocumentActions } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'sermons', id: 'sermon-1' };
const stored = { userId: 'owner', title: 'Grace', verse: 'John 1:14', date: '2026-09-01', thoughts: [], sourceNoteIds: ['note-a'] };

function setup() {
  const harness = documentEngineHarness({ resource, value: stored, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const wrapper = ({ children }: { children: React.ReactNode }) => <DataEngineProvider>{children}</DataEngineProvider>;
  return { harness, ...renderHook(() => useDocumentActions(), { wrapper }) };
}

describe('one action on a document no screen has open', () => {
  it('captures exactly this change as one durable command on the stored baseline', async () => {
    const { harness, result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.commit(resource, current => ({ ...current!, sourceNoteIds: [...(current!.sourceNoteIds as string[]), 'note-b'] }));
    });
    await waitFor(async () => { await settleEngine(); expect(harness.server.value?.sourceNoteIds).toEqual(['note-a', 'note-b']); });
    expect(harness.server.value?.title).toBe('Grace');
  });

  it('deletes through the engine, leaving a tombstone rather than an absent document', async () => {
    const { harness, result } = setup();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { await result.current.remove(resource); });
    await waitFor(async () => { await settleEngine(); expect(harness.server.metadata?.deleted).toBe(true); });
    expect(harness.server.value).toBeNull();
  });
});
