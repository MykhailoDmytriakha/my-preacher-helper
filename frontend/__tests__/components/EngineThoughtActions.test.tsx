import { act, renderHook, waitFor } from '@testing-library/react';

import { useScratchDataDocument } from '@/(pages)/(private)/sermons/[id]/hooks/useScratchDataDocument';
import { useSermonThoughtsDataDocument } from '@/(pages)/(private)/sermons/[id]/hooks/useSermonThoughtsDataDocument';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataDocumentProvider, DataEngineProvider } from '@/data-engine/react.client';
import { settleEngine } from '../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';

import type { ResourceSnapshot } from '@/data-engine/types';
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const resource = { collection: 'sermons', id: 'sermon' };
const a = { id: 'a', text: 'A', tags: [], date: 'today' }, b = { id: 'b', text: 'B', tags: [], date: 'today' };
const original: ResourceSnapshot = { resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
  value: { userId: 'owner', title: 'Sermon', verse: 'Romans 1', date: 'today', thoughts: [a, b],
    structure: { introduction: [], main: [], conclusion: [], ambiguous: ['a', 'b'] },
    outline: { introduction: [], main: [{ id: 'main', text: 'Main' }], conclusion: [] } } };

it('moves then removes one thought with both placement aliases while retaining a remote sibling', async () => {
  process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons';
  const harness = membershipEngineHarness([original]); jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const hook = renderHook(() => useSermonThoughtsDataDocument('sermon'), { wrapper: ({ children }) =>
    <DataEngineProvider><DataDocumentProvider resource={resource}>{children}</DataDocumentProvider></DataEngineProvider> });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await act(async () => { await hook.result.current.patchThought('a', { outlinePointId: 'main' }); await harness.engine.retry(); await settleEngine(); });
  expect(harness.read(resource).value).toMatchObject({ thoughts: [{ ...a, outlinePointId: 'main', subPointId: null }, b],
    structure: { main: ['a'], ambiguous: ['b'] }, thoughtsBySection: { main: ['a'], ambiguous: ['b'] } });
  const moved = harness.read(resource);
  harness.replace({ ...moved, metadata: { ...moved.metadata!, revision: moved.metadata!.revision + 1 }, value: { ...moved.value!,
    thoughts: [{ ...a, outlinePointId: 'main', subPointId: null }, { ...b, text: 'Remote B' }] } });
  await act(async () => { await hook.result.current.deleteThought('a'); await harness.engine.retry(); await settleEngine(); });
  expect(harness.read(resource).value).toMatchObject({ thoughts: [{ ...b, text: 'Remote B' }],
    structure: { main: [], ambiguous: ['b'] }, thoughtsBySection: { main: [], ambiguous: ['b'] } });
  expect(harness.transport.send).toHaveBeenCalledTimes(2); hook.unmount(); delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
});

it('replaces a scratch outline and detaches affected thoughts in the same acknowledged command', async () => {
  process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons';
  const source = { ...original, value: { ...original.value!, thoughts: [{ ...a, outlinePointId: 'main' }, b],
    scratch: [{ id: 'note', text: 'Consumed material', createdAt: 'today' }] } };
  const harness = membershipEngineHarness([source]); jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const hook = renderHook(() => useScratchDataDocument('sermon'), { wrapper: ({ children }) =>
    <DataEngineProvider><DataDocumentProvider resource={resource}>{children}</DataDocumentProvider></DataEngineProvider> });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await act(async () => { await hook.result.current.applyOutlineAndConsume({ introduction: [], main: [], conclusion: [] }, ['note']);
    await harness.engine.retry(); await settleEngine(); });
  expect(harness.read(resource).value).toMatchObject({ thoughts: [{ ...a, outlinePointId: null, subPointId: null }, b], scratch: [],
    outline: { main: [] } });
  expect(harness.transport.send).toHaveBeenCalledTimes(1); hook.unmount(); delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
});
