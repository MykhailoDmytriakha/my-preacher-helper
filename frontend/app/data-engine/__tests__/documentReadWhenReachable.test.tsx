import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider, useDataDocument } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import type { ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

/**
 * A DOCUMENT NOT READ ONLY FOR WANT OF THE SERVER IS READ ONCE THE SERVER IS THERE
 * (BUG-20261006-hidden-tab-document-read-not-retried). With no copy on this device, the engine
 * refuses to open a document while the tab is hidden or offline. The screen kept that refusal after
 * the tab became visible and online, until the person pressed Retry. A refusal for any other reason
 * is still the person's to retry.
 */
const resource = { collection: 'sermons', id: 's1' };
const snapshot: ResourceSnapshot = { resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false }, value: { userId: 'owner', title: 'Grace' } };
const wrapper = ({ children }: { children: React.ReactNode }) => <DataEngineProvider>{children}</DataEngineProvider>;

type Harness = ReturnType<typeof documentEngineHarness>;

function openFirstTime(prepare: (engine: Harness['engine'], harness: Harness) => void = () => undefined) {
  const harness = documentEngineHarness(snapshot, { cached: false });
  jest.mocked(createBrowserDataEngine).mockImplementation(options => {
    const browser = harness.createBrowser(options);
    prepare(browser.engine, harness);
    return browser;
  });
  return { harness, view: renderHook(() => useDataDocument(resource), { wrapper }) };
}

afterEach(() => { jest.mocked(createBrowserDataEngine).mockReset(); });

it.each([
  ['hidden', (on: boolean) => (engine: { setVisible(value: boolean): void }) => engine.setVisible(on)],
  ['offline', (on: boolean) => (engine: { setOnline(value: boolean): void }) => engine.setOnline(on)],
] as const)('reads by itself a document refused while the tab was %s, once the server can be reached', async (_, reachable) => {
  const { harness, view } = openFirstTime(reachable(false));
  await waitFor(() => expect(view.result.current.error).not.toBeNull());
  expect(view.result.current.data).toBeNull();
  // While the server still cannot be reached, nothing asks again.
  await act(async () => { await settleEngine(); });
  expect(harness.transport.read).not.toHaveBeenCalled();

  act(() => { reachable(true)(harness.engine); });

  await waitFor(() => expect(view.result.current.data).toMatchObject({ title: 'Grace' }));
  expect(view.result.current.error).toBeNull();
  expect(harness.transport.read).toHaveBeenCalledTimes(1);
});

it('leaves a read the server failed while reachable to the person\'s Retry', async () => {
  const { harness, view } = openFirstTime((_, { transport }) => { jest.mocked(transport.read).mockRejectedValueOnce(new Error('Server unavailable')); });
  await waitFor(() => expect(view.result.current.error).not.toBeNull());
  act(() => { harness.engine.setVisible(false); harness.engine.setVisible(true); });
  await act(async () => { await settleEngine(); });
  expect(harness.transport.read).toHaveBeenCalledTimes(1);
  expect(view.result.current.data).toBeNull();

  await act(async () => { await view.result.current.retry(); });
  await waitFor(() => expect(view.result.current.data).toMatchObject({ title: 'Grace' }));
});
