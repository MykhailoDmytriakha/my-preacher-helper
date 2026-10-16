import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider, useDocumentActions } from '@/data-engine/react.client';
import { useSermonsBuiltOnNote } from '@/hooks/useSermonNoteLinks';
import { useSermonsDataCollection } from '@/hooks/useSermonsDataCollection';
import { getSermons } from '@/services/sermon.service';
import { settleEngine } from '../../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../../test-utils/membershipEngineHarness';

import type { ResourceSnapshot } from '@/data-engine/types';
import type { Sermon } from '@/models/models';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' }, loading: false }) }));
let mockOnline = true;
jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => mockOnline }));
jest.mock('@/services/sermon.service', () => ({ getSermons: jest.fn() }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'sermons', id: 'sermon' };
const snapshot: ResourceSnapshot = {
  resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
  value: { userId: 'owner', title: 'Opening title', verse: 'John 1:1', date: '2026-10-15', thoughts: [], sourceNoteIds: ['note'] },
};

function setup() {
  const engine = membershipEngineHarness([snapshot]);
  jest.mocked(createBrowserDataEngine).mockImplementation(engine.createBrowser);
  jest.mocked(getSermons).mockResolvedValue([{ ...snapshot.value, id: resource.id } as unknown as Sermon]);
  const wrapper = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={client}><DataEngineProvider>{children}</DataEngineProvider></QueryClientProvider>;
    };
  };
  return { engine, wrapper };
}

beforeEach(() => { jest.clearAllMocks(); mockOnline = true; });

it('shows an offline rename from the shared engine without waiting for the legacy list', async () => {
  const { engine, wrapper } = setup();
  const { result, unmount } = renderHook(() => ({ linked: useSermonsBuiltOnNote('note'), actions: useDocumentActions() }), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.linked.sermons[0]?.title).toBe('Opening title'));
  await act(async () => {
    engine.engine.setOnline(false);
    await result.current.actions.commit(resource, current => ({ ...current!, title: 'My offline rename' }));
    await settleEngine();
  });
  await waitFor(() => expect(result.current.linked.sermons[0]?.title).toBe('My offline rename'));
  expect(engine.transport.send).not.toHaveBeenCalled();
  unmount();
});

it('reopens the stored list without network and without a restored React Query cache', async () => {
  const { engine, wrapper } = setup();
  const warm = renderHook(() => useSermonsDataCollection(), { wrapper: wrapper() });
  await waitFor(() => expect(warm.result.current.sermons).toHaveLength(1));
  warm.unmount();
  mockOnline = false;
  const create = engine.createBrowser;
  jest.mocked(createBrowserDataEngine).mockImplementation(() => {
    const browser = create();
    browser.engine.setOnline(false);
    return browser;
  });
  jest.mocked(getSermons).mockRejectedValue(new Error('offline'));
  const reopened = renderHook(() => useSermonsBuiltOnNote('note'), { wrapper: wrapper() });
  await waitFor(() => expect(reopened.result.current.sermons[0]?.title).toBe('Opening title'));
  expect(reopened.result.current.loading).toBe(false);
  reopened.unmount();
});

it('shares one collection read across the note page consumers', async () => {
  const { engine, wrapper } = setup();
  const view = renderHook(() => ({ page: useSermonsDataCollection(), first: useSermonsBuiltOnNote('note'), second: useSermonsBuiltOnNote('note') }), { wrapper: wrapper() });
  await waitFor(() => expect(view.result.current.second.sermons).toHaveLength(1));
  expect(engine.collectionTransport.list).toHaveBeenCalledTimes(1);
  expect(getSermons).not.toHaveBeenCalled();
  view.unmount();
});
