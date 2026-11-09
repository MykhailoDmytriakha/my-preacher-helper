import { act, renderHook, waitFor } from '@testing-library/react';

import { useEngineStructureWriter } from '@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';

import { settleEngine } from '../../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../../test-utils/membershipEngineHarness';

import type { ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'sermons', id: 'sermon' };
const first = { id: 'a', text: 'First thought', tags: ['main'], date: '2026-11-08', outlinePointId: 'point', subPointId: 'opening' };
const second = { ...first, id: 'b', text: 'Second thought' };
const structure = { introduction: [], main: [first.id, second.id], conclusion: [], ambiguous: [] };
const initial: ResourceSnapshot = { resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false }, value: {
  userId: 'owner', title: 'Sermon', verse: 'John 1:1', date: '2026-11-08', thoughts: [first, second], structure, thoughtsBySection: structure,
  outline: { introduction: [], main: [{ id: 'point', text: 'Point', subPoints: [
    { id: 'opening', text: 'Opening', position: 0 }, { id: 'proposal', text: 'Proposal', position: 1 },
    { id: 'new-place', text: 'New place', position: 2 },
  ] }], conclusion: [] },
} };

async function setup() {
  const harness = membershipEngineHarness([initial]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const hook = renderHook(() => useEngineStructureWriter(resource.id, 'owner'), {
    wrapper: ({ children }) => <DataEngineProvider>{children}</DataEngineProvider>,
  });
  await waitFor(() => expect(hook.result.current.document.state?.durable).toBe(true));
  const accept = () => hook.result.current.writer.updateStructure(resource.id, structure, structure, {
    captureReview: true, thoughtIds: [first.id, second.id],
    thoughtUpdates: [first, second].map(thought => ({ thought: { ...thought, subPointId: 'proposal' }, baseThought: thought })),
  });
  const deliver = async () => { await act(async () => { await harness.engine.retry(); await settleEngine(); }); };
  return { ...hook, accept, deliver, harness };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons';
});
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

it('keeps a refused AI acceptance out of the document and the next ordinary Save', async () => {
  const { accept, deliver, harness, result } = await setup();
  let refused = false;
  harness.disk.writeFailureFor = (key, value) => {
    if (refused || !Array.isArray(key) || key[0] !== 'request' || !JSON.stringify(value)?.includes('proposal')) return false;
    refused = true;
    return true;
  };
  await act(async () => { await expect(accept()).rejects.toThrow(); });
  expect(refused).toBe(true);
  expect(result.current.document.data?.thoughts).toEqual([first, second]);
  await deliver();
  expect(harness.transport.send).not.toHaveBeenCalled();

  await act(async () => {
    await result.current.writer.updateThought(resource.id, { ...second, text: 'New words after refusal' }, second);
    await result.current.document.save();
  });
  await deliver();
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(harness.read(resource).value?.thoughts).toEqual([first, { ...second, text: 'New words after refusal' }]);
});

it('captures both accepted assignments in one operation and keeps the authored words', async () => {
  const { accept, deliver, harness } = await setup();
  await act(async () => { await accept(); });
  await deliver();
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(harness.transport.send).toHaveBeenCalledWith(expect.objectContaining({
    thoughtPlacementActions: [first, second].map(thought => expect.objectContaining({
      rowId: thought.id, before: { outlinePointId: 'point', subPointId: 'opening' },
      after: { outlinePointId: 'point', subPointId: 'proposal' },
    })),
  }));
  expect(harness.read(resource).value?.thoughts).toEqual([first, second].map(thought => ({ ...thought, subPointId: 'proposal' })));
});


it.each(['editor projection', 'form checkpoint'])('keeps a durable acceptance after failure writing the %s', async write => {
  const { accept, deliver, harness } = await setup();
  let refused = false;
  harness.disk.writeFailureFor = (key, value) => {
    if (refused || !Array.isArray(key) || !JSON.stringify(value)?.includes('proposal')) return false;
    const record = value as { checkpoint?: { pending?: Record<string, unknown> }; record?: { savedGeneration?: number | null } };
    const afterCapture = write === 'editor projection'
      ? key[0] === 'checkpoint' && Object.keys(record.checkpoint?.pending ?? {}).length > 0
      : key[0] === 'manual' && record.record?.savedGeneration != null;
    if (afterCapture) refused = true;
    return afterCapture;
  };
  await act(async () => { await accept(); });
  expect(refused).toBe(true);
  await deliver();
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(harness.read(resource).value?.thoughts).toEqual([first, second].map(thought => ({ ...thought, subPointId: 'proposal' })));
});

it('refuses an old preview whose opening thought already moved in the editor', async () => {
  const { accept, deliver, harness, result } = await setup();
  await act(async () => {
    await result.current.writer.updateThought(resource.id, { ...first, subPointId: 'new-place' }, first);
    await result.current.document.save();
  });
  await deliver();
  await act(async () => { await expect(accept()).rejects.toMatchObject({ code: 'decision-changed' }); });
  await deliver();
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(harness.read(resource).value?.thoughts).toEqual([{ ...first, subPointId: 'new-place' }, second]);
});
