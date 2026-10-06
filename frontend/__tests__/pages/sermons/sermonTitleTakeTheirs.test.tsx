import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { useSermonCoreDataDocument } from '@/(pages)/(private)/sermons/[id]/hooks/useSermonCoreDataDocument';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataDocumentProvider, DataEngineProvider } from '@/data-engine/react.client';

import { documentEngineHarness, settleEngine } from '../../../test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'sermons', id: 'sermon-1' };
const stored = { userId: 'owner', title: 'Original', verse: 'John 1', date: '2026-10-01', thoughts: [] };

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DataEngineProvider><DataDocumentProvider resource={resource}>{children}</DataDocumentProvider></DataEngineProvider>
);

async function openSermon() {
  const harness = documentEngineHarness({ resource, value: stored, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const view = renderHook(() => useSermonCoreDataDocument('sermon-1'), { wrapper });
  await waitFor(() => expect(view.result.current.titleBinding.value).toBe('Original'));
  return { harness, ...view };
}

async function saveTitle(view: Awaited<ReturnType<typeof openSermon>>, title: string) {
  await act(async () => { await view.result.current.titleBinding.begin(); });
  await act(async () => { await view.result.current.titleBinding.save(title); await settleEngine(); await settleEngine(); });
}

async function conflictOverTitle() {
  const view = await openSermon();
  const { harness } = view;
  // Another device renamed it to A2; this one, not knowing, renames it to B2.
  harness.silentRemote({ title: 'A2' });
  await saveTitle(view, 'B2');
  await waitFor(() => expect(view.result.current.status?.phase).toBe('conflict'));
  return view;
}

/** BUG-20261003-take-theirs-title-keeps-discarded-text: the banner's choice, as the page wires it. */
describe('the sermon header banner over a title saved on two devices', () => {
  beforeEach(() => { process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons'; });
  afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

  it('shows the other version\'s title once the person takes it', async () => {
    const { harness, result } = await conflictOverTitle();
    await act(async () => { await result.current.acceptRemote(); await settleEngine(); await settleEngine(); });
    expect(harness.server.value?.title).toBe('A2');
    await waitFor(() => expect(result.current.titleBinding.value).toBe('A2'));
    // Taking a version is not starting an edit, and the untouched verse stays as it was.
    expect(result.current.titleBinding.active).toBe(false);
    expect(result.current.verseBinding.active).toBe(false);
    expect(result.current.verseBinding.value).toBe('John 1');
  });

  it('delivers and shows this device\'s title once the person keeps it', async () => {
    const { harness, result } = await conflictOverTitle();
    await act(async () => { await result.current.keepLocal(); await settleEngine(); await settleEngine(); });
    await act(async () => { await harness.engine.retry(resource); await settleEngine(); await settleEngine(); });
    await waitFor(() => expect(harness.server.value?.title).toBe('B2'));
    expect(result.current.titleBinding.value).toBe('B2');
  });
});

/** The same rule from the other side: a closed form shows the document, not its last Save. */
describe('the sermon header title after it was saved', () => {
  beforeEach(() => { process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons'; });
  afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

  it('shows a later rename from another device', async () => {
    const view = await openSermon();
    await saveTitle(view, 'From this device');
    await waitFor(() => expect(view.harness.server.value?.title).toBe('From this device'));
    await act(async () => { await view.harness.remote({ title: 'From the phone' }); });
    await waitFor(() => expect(view.result.current.titleBinding.value).toBe('From the phone'));
  });

  it('keeps showing a title saved without network after the page is opened again', async () => {
    const view = await openSermon();
    jest.mocked(view.harness.transport.send).mockRejectedValue(new TypeError('Failed to fetch'));
    await saveTitle(view, 'Written offline');
    expect(view.result.current.titleBinding.value).toBe('Written offline');
    view.unmount();
    await act(async () => { await settleEngine(); });

    const reopened = renderHook(() => useSermonCoreDataDocument('sermon-1'), { wrapper });
    await waitFor(() => expect(reopened.result.current.titleBinding.value).toBe('Written offline'));
    expect(view.harness.server.value?.title).toBe('Original');
    reopened.unmount();
  });
});
