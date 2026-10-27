import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { needsConnection } from '@/data-engine/engine';
import { DataEngineProvider, useDataDocument } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import type { ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'sermons', id: 'interrupted' };
const snapshot: ResourceSnapshot = { resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false }, value: { userId: 'owner', title: 'Grace' } };
const wrapper = ({ children }: { children: React.ReactNode }) => <DataEngineProvider>{children}</DataEngineProvider>;
const networkError = (code = 'unavailable') => Object.assign(new Error('The server could not be reached'), { code });
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function pendingRead() {
  const harness = documentEngineHarness(snapshot, { cached: false });
  const pending = deferred<ResourceSnapshot>();
  jest.mocked(harness.transport.read).mockImplementationOnce(() => pending.promise);
  return { harness, pending };
}
function openPending(beforeSnapshotWrite?: () => Promise<void>) {
  const opening = pendingRead();
  jest.mocked(createBrowserDataEngine).mockImplementation(options => opening.harness.createBrowser({ ...options, beforeSnapshotWrite }));
  return { ...opening, view: renderHook(() => useDataDocument(resource), { wrapper }) };
}
const reachable = (engine: ReturnType<typeof documentEngineHarness>['engine'], kind: 'hidden' | 'offline', on: boolean) => {
  if (kind === 'hidden') engine.setVisible(on); else engine.setOnline(on);
};
afterEach(() => { jest.mocked(createBrowserDataEngine).mockReset(); });

// BUG-20261027-cold-form-network-error-after-hidden: a read starts while reachable,
// but its transport fails after the tab can no longer read. Resume the opening, not a user action.
it.each([
  ['hidden', 'unavailable'], ['hidden', 'deadline-exceeded'],
  ['offline', 'firestore/unavailable'], ['offline', 'auth/network-request-failed'],
] as const)('continues an opening interrupted while %s by %s only after it becomes reachable', async (kind, code) => {
  const { harness, pending, view } = openPending();
  await waitFor(() => expect(harness.transport.read).toHaveBeenCalledTimes(1));
  act(() => { reachable(harness.engine, kind, false); });
  await act(async () => { pending.reject(networkError(code)); await settleEngine(); });
  await waitFor(() => expect(view.result.current.error).not.toBeNull());
  await act(async () => { await settleEngine(); });
  expect(harness.transport.read).toHaveBeenCalledTimes(1);
  expect(view.result.current.data).toBeNull();

  act(() => { reachable(harness.engine, kind, true); });

  await waitFor(() => expect(view.result.current.data).toMatchObject({ title: 'Grace' }));
  expect(view.result.current.error).toBeNull();
  expect(harness.transport.read).toHaveBeenCalledTimes(2);
  expect(harness.transport.send).not.toHaveBeenCalled();
  expect(harness.server).toEqual(snapshot);
});

it.each(['unavailable', 'deadline-exceeded'])('leaves a %s failure received while visible and online to explicit Retry', async code => {
  const { harness, pending, view } = openPending();
  await waitFor(() => expect(harness.transport.read).toHaveBeenCalledTimes(1));
  await act(async () => { pending.reject(networkError(code)); await settleEngine(); });
  await waitFor(() => expect(view.result.current.error).not.toBeNull());
  act(() => { harness.engine.setVisible(false); harness.engine.setVisible(true); });
  await act(async () => { await settleEngine(); });
  expect(harness.transport.read).toHaveBeenCalledTimes(1);
  await act(async () => { await view.result.current.retry(); });
  await waitFor(() => expect(view.result.current.data).toMatchObject({ title: 'Grace' }));
});

it.each(['permission-denied', 'unauthenticated', 'data-loss', 'internal'])('never turns a hidden %s refusal into an automatic retry', async code => {
  const { harness, pending, view } = openPending();
  await waitFor(() => expect(harness.transport.read).toHaveBeenCalledTimes(1));
  act(() => { harness.engine.setVisible(false); });
  await act(async () => { pending.reject(networkError(code)); await settleEngine(); });
  await waitFor(() => expect(view.result.current.error).not.toBeNull());
  act(() => { harness.engine.setVisible(true); });
  await act(async () => { await settleEngine(); });
  expect(harness.transport.read).toHaveBeenCalledTimes(1);
  expect(view.result.current.data).toBeNull();
});

it.each([
  new TypeError('An unrelated local error'),
  Object.assign(new Error('Daily quota exhausted'), { code: 'resource-exhausted' }),
  new DOMException('Read was cancelled', 'AbortError'),
])('does not resume a hidden unclassified or cancelled failure: %s', async failure => {
  const { harness, pending, view } = openPending();
  await waitFor(() => expect(harness.transport.read).toHaveBeenCalledTimes(1));
  act(() => { harness.engine.setVisible(false); });
  await act(async () => { pending.reject(failure); await settleEngine(); });
  await waitFor(() => expect(view.result.current.error).not.toBeNull());
  act(() => { harness.engine.setVisible(true); });
  await act(async () => { await settleEngine(); });
  expect(harness.transport.read).toHaveBeenCalledTimes(1);
});

it('does not treat a storage failure with a network-shaped code as a paused transport read', async () => {
  const opened = openPending(async () => { throw networkError(); });
  const { harness } = opened;
  await waitFor(() => expect(harness.transport.read).toHaveBeenCalledTimes(1));
  act(() => { harness.engine.setVisible(false); });
  await act(async () => { opened.pending.resolve(snapshot); await settleEngine(); });
  await waitFor(() => expect(opened.view.result.current.error).not.toBeNull());
  act(() => { harness.engine.setVisible(true); });
  await act(async () => { await settleEngine(); });
  expect(harness.transport.read).toHaveBeenCalledTimes(1);
  expect(opened.view.result.current.data).toBeNull();
});

it('cancels a paused opening when its screen unmounts', async () => {
  const { harness, pending, view } = openPending();
  await waitFor(() => expect(harness.transport.read).toHaveBeenCalledTimes(1));
  act(() => { harness.engine.setVisible(false); });
  await act(async () => { pending.reject(networkError()); await settleEngine(); });
  await waitFor(() => expect(view.result.current.error).not.toBeNull());
  view.unmount();
  harness.engine.setVisible(true);
  await settleEngine();
  expect(harness.transport.read).toHaveBeenCalledTimes(1);
});

it.each(['unavailable', 'deadline-exceeded', 'auth/network-request-failed'])('preserves the original %s code and cause when a read pauses', async code => {
  const { harness, pending } = pendingRead();
  const browser = harness.createBrowser(); browser.engine.setOwner('owner');
  const attempt = browser.engine.read(resource).catch(error => error);
  await settleEngine(); expect(harness.transport.read).toHaveBeenCalledTimes(1);
  browser.engine.setVisible(false);
  const original = networkError(code); pending.reject(original);
  const failure = await attempt;
  expect(needsConnection(failure)).toBe(true);
  expect(failure).toMatchObject({ code, message: original.message, cause: original });
  expect(failure.cause).toBe(original);
  expect(original.code).toBe(code);
  expect(needsConnection(original)).toBe(false);
  browser.dispose();
});

it.each(['owner', 'dispose'] as const)('does not register an old paused read after %s retirement', async reason => {
  const { harness, pending } = pendingRead();
  const browser = harness.createBrowser(); browser.engine.setOwner('owner');
  const attempt = browser.engine.read(resource).catch(error => error);
  await settleEngine();
  browser.engine.setVisible(false);
  if (reason === 'owner') browser.engine.setOwner('other'); else browser.dispose();
  pending.reject(networkError());
  expect(needsConnection(await attempt)).toBe(false);
  expect(harness.transport.read).toHaveBeenCalledTimes(1);
  browser.dispose();
});

it('stops after one resumed read if the reachable server still refuses it', async () => {
  const { harness, pending, view } = openPending();
  jest.mocked(harness.transport.read).mockRejectedValueOnce(networkError('internal'));
  await waitFor(() => expect(harness.transport.read).toHaveBeenCalledTimes(1));
  act(() => { harness.engine.setVisible(false); });
  await act(async () => { pending.reject(networkError()); await settleEngine(); });
  await waitFor(() => expect(view.result.current.error).not.toBeNull());
  act(() => { harness.engine.setVisible(true); });
  await waitFor(() => expect(harness.transport.read).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.result.current.error).not.toBeNull());
  await act(async () => { await settleEngine(); });
  expect(harness.transport.read).toHaveBeenCalledTimes(2);
  expect(view.result.current.data).toBeNull();
  await act(async () => { await view.result.current.retry(); });
  await waitFor(() => expect(view.result.current.data).toMatchObject({ title: 'Grace' }));
});
