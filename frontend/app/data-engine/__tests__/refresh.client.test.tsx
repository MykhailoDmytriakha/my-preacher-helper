import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createBrowserDataEngine, type BrowserDataEngine } from '../browser.client';
import { DataEngineProvider, useDataRefresh } from '../react.client';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('../browser.client', () => ({ createBrowserDataEngine: jest.fn() }));

describe('Displayed data refresh', () => {
  const original = process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
    else process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = original;
  });

  it('refreshes active readers only and leaves engine-owned legacy projections and inactive queries alone', async () => {
    process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons';
    const refreshActive = jest.fn(async () => undefined), retry = jest.fn();
    jest.mocked(createBrowserDataEngine).mockReturnValue({ engine: { setOwner: jest.fn(), refreshActive, retry }, dispose: jest.fn() } as unknown as BrowserDataEngine);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const activeRead = jest.fn(async () => 'active'), legacyRead = jest.fn(async () => 'legacy'), inactiveRead = jest.fn(async () => 'inactive');
    const active = new QueryObserver(client, { queryKey: ['settings', 'owner'], queryFn: activeRead });
    const legacy = new QueryObserver(client, { queryKey: ['sermons', 'owner'], queryFn: legacyRead });
    const stopActive = active.subscribe(() => undefined), stopLegacy = legacy.subscribe(() => undefined);
    await client.fetchQuery({ queryKey: ['unopened'], queryFn: inactiveRead });
    await waitFor(() => expect(active.getCurrentResult().isSuccess).toBe(true));
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><DataEngineProvider>{children}</DataEngineProvider></QueryClientProvider>;
    const hook = renderHook(useDataRefresh, { wrapper });
    await act(async () => hook.result.current());
    expect(refreshActive).toHaveBeenCalledTimes(1);
    expect(activeRead).toHaveBeenCalledTimes(2);
    expect(legacyRead).toHaveBeenCalledTimes(1);
    expect(inactiveRead).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    hook.unmount(); stopActive(); stopLegacy(); client.clear();
  });

  it('propagates an engine read failure so the gesture cannot show successful completion', async () => {
    process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons';
    jest.mocked(createBrowserDataEngine).mockReturnValue({ engine: { setOwner: jest.fn(), refreshActive: async () => { throw new Error('Read failed'); } }, dispose: jest.fn() } as unknown as BrowserDataEngine);
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><DataEngineProvider>{children}</DataEngineProvider></QueryClientProvider>;
    const hook = renderHook(useDataRefresh, { wrapper });
    await act(async () => { await expect(hook.result.current()).rejects.toThrow('Read failed'); });
    hook.unmount(); client.clear();
  });
});
