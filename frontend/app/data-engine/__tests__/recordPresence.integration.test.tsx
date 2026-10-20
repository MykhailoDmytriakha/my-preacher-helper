import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider, useDataDocument } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import type { ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'sermons', id: 's1' };
const snapshot: ResourceSnapshot = {
  resource,
  metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
  value: { userId: 'owner', title: 'Grace' },
};
const wrapper = ({ children }: { children: React.ReactNode }) => <DataEngineProvider>{children}</DataEngineProvider>;

type Harness = ReturnType<typeof documentEngineHarness>;

function openDocument(prepare: (harness: Harness) => void = () => undefined, options: { create?: boolean; cached?: boolean } = {}) {
  const initial = options.create ? { resource, value: null, metadata: null } : snapshot;
  const harness = documentEngineHarness(initial, { cached: options.cached });
  jest.mocked(createBrowserDataEngine).mockImplementation(engineOptions => {
    const browser = harness.createBrowser(engineOptions);
    prepare(harness);
    return browser;
  });
  const view = renderHook(() => useDataDocument(resource, { autoSave: false, create: options.create }), { wrapper });
  return { harness, view };
}

afterEach(() => { jest.mocked(createBrowserDataEngine).mockReset(); });

it('keeps presence unknown when the server read fails and there is no cached copy', async () => {
  const { view } = openDocument(harness => {
    jest.mocked(harness.transport.read).mockRejectedValueOnce(new Error('Server unavailable'));
  }, { cached: false });

  await waitFor(() => expect(view.result.current.error).not.toBeNull());
  expect(view.result.current.presence.kind).toBe('unknown');
  expect(view.result.current.data).toBeNull();
});

it('reports the server deletion and retains locally typed words in the editor', async () => {
  const { harness, view } = openDocument();
  await waitFor(() => expect(view.result.current.data).toMatchObject({ title: 'Grace' }));

  await act(async () => { await view.result.current.edit({ userId: 'owner', title: 'My unsent words' }); });
  harness.silentRemoteDelete();
  await act(async () => { await harness.engine.retry(resource); await settleEngine(); });

  await waitFor(() => expect(view.result.current.presence).toMatchObject({ kind: 'absent', source: 'server' }));
  expect(view.result.current.data).toMatchObject({ title: 'My unsent words' });
  expect(view.result.current.confirmed).toMatchObject({ value: { userId: 'owner', title: 'Grace' } });
  expect(view.result.current.remote?.metadata).toMatchObject({ deleted: true });
});

it('keeps an unacknowledged local creation classified as creating', async () => {
  const acknowledgement = new Promise<never>(() => undefined);
  const { view } = openDocument(harness => {
    jest.mocked(harness.transport.send).mockReturnValue(acknowledgement);
  }, { create: true, cached: false });

  await waitFor(() => expect(view.result.current.loading).toBe(false));
  await act(async () => { await view.result.current.edit({ userId: 'owner', title: 'New sermon' }); });
  await act(async () => { await view.result.current.save(); await settleEngine(); });

  expect(view.result.current.presence).toMatchObject({ kind: 'creating', source: 'local' });
});

it('keeps an unacknowledged user deletion classified as deleting', async () => {
  const acknowledgement = new Promise<never>(() => undefined);
  const { view } = openDocument(harness => {
    jest.mocked(harness.transport.send).mockReturnValue(acknowledgement);
  });
  await waitFor(() => expect(view.result.current.data).toMatchObject({ title: 'Grace' }));

  await act(async () => { await view.result.current.edit(null); });
  await act(async () => { await view.result.current.save(); await settleEngine(); });

  expect(view.result.current.presence).toMatchObject({ kind: 'deleting', source: 'local' });
});


it('publishes a live server observation without mistaking the controller earlier empty copy for absence', async () => {
  const harness = documentEngineHarness({ resource, value: null, metadata: null });
  const browser = harness.createBrowser();
  browser.engine.setOwner('owner');
  const editor = await browser.engine.openEditor(resource, 'presence-observation-before-apply');
  await settleEngine();
  const transitions: { confirmed: ResourceSnapshot; observation: ResourceSnapshot | null; kind: string }[] = [];
  const stop = editor.subscribe(() => {
    transitions.push({ confirmed: editor.getState().checkpoint.confirmed,
      observation: editor.getObservation().snapshot, kind: editor.getPresence().kind });
  });
  jest.mocked(harness.transport.read).mockResolvedValue(snapshot);
  try {
    await browser.engine.retry(resource);
    await settleEngine();
    const beforeApply = transitions.filter(value => value.observation?.value?.title === 'Grace' && value.confirmed.value === null);
    expect(beforeApply.length).toBeGreaterThan(0);
    expect(beforeApply.map(value => value.kind)).toEqual(expect.arrayContaining(['present']));
    expect(beforeApply.every(value => value.kind === 'present')).toBe(true);
  } finally { stop(); editor.close(); browser.dispose(); }
});
