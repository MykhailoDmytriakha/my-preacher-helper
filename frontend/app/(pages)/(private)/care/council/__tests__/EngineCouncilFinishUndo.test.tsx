import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { toast, type Action } from 'sonner';

import CouncilDetailPage from '../[id]/page';
import CouncilConductPage from '../[id]/conduct/page';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import type { DocumentData } from '@/data-engine/types';

let mockOwner: string | null = 'owner';
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: mockOwner ? { uid: mockOwner } : null }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const mockNavigate = jest.fn();
let mockPathname = '/care/council/council-undo';
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockNavigate }),
  useParams: () => ({ id: 'council-undo' }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), message: jest.fn() } }));
jest.mock('@/data-engine/DataSyncStatus', () => ({ DataSyncStatus: () => null }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({ RichMarkdownEditor: () => null }));
jest.mock('@/components/FloatingTextScaleControls', () => ({ __esModule: true, default: () => null }));
jest.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: { firstDayOfWeek: 'monday' } }) }));
jest.mock('@/hooks/useCouncilsRead', () => ({ useCouncilsRead: () => ({ councils: [], loading: false, error: null, refresh: jest.fn() }) }));

const resource = { collection: 'councils', id: 'council-undo' };
const words = [{ id: 'topic-1', title: 'Retained decision words', questions: [], options: [], discussed: true }];
const value: DocumentData = {
  userId: 'owner', title: 'Council before finishing', status: 'preparing', topics: words,
  createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z',
};

function setup(initialView: 'conduct' | 'detail' = 'conduct') {
  const harness = documentEngineHarness({ resource, value, metadata: { protocol: 1, generation: 'council-generation', revision: 1, deleted: false } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  let leave: () => void = () => undefined;
  function Host() {
    const [view, setView] = useState<'conduct' | 'detail' | 'away'>(initialView);
    mockPathname = view === 'away' ? '/outside-council' : `/care/council/council-undo${view === 'conduct' ? '/conduct' : ''}`;
    mockNavigate.mockImplementation(() => setView('detail'));
    leave = () => setView('away');
    return <DataEngineProvider>{view === 'conduct' ? <CouncilConductPage /> : view === 'detail' ? <CouncilDetailPage /> : <p>Another screen</p>}</DataEngineProvider>;
  }
  const rendered = render(<Host />);
  return { harness, leave: () => leave(), changeOwner: (owner: string | null) => { mockOwner = owner; rendered.rerender(<Host />); } };
}

async function finish(harness: ReturnType<typeof documentEngineHarness>, mode: 'conduct' | 'detail') {
  fireEvent.click(await screen.findByTestId(mode === 'conduct' ? 'council-finish' : 'council-finish-here'));
  await waitFor(async () => { await settleEngine(); expect(harness.server.value?.status).toBe('held'); });
  await waitFor(() => expect(toast.message).toHaveBeenCalled());
}

function clickUndo(repeated = false) {
  const notice = jest.mocked(toast.message).mock.calls.find(([message]) => message === 'council.detail.finishUndoAvailable')?.[1];
  expect(notice?.action).toBeDefined();
  render(<button onClick={(notice!.action as Action).onClick}>Undo this finish</button>);
  const button = screen.getByRole('button', { name: 'Undo this finish' });
  fireEvent.click(button);
  if (repeated) fireEvent.click(button);
}

beforeEach(() => { jest.clearAllMocks(); mockOwner = 'owner'; });

describe('council finish Undo across editor lifetimes', () => {
  it('reopens after leaving conduct and preserves later saved words', async () => {
    const { harness } = setup();
    await finish(harness, 'conduct');
    await screen.findByTestId('council-topic-topic-1');
    await act(async () => { await harness.remote({ title: 'Later saved words' }); });
    clickUndo();
    await waitFor(async () => { await settleEngine(); expect(harness.server.value).toMatchObject({ status: 'preparing', title: 'Later saved words', topics: words }); });
    expect(harness.server.value).not.toHaveProperty('heldAt');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('reopens the original council after its detail screen was left', async () => {
    const { harness, leave } = setup('detail');
    await finish(harness, 'detail');
    act(() => leave());
    clickUndo();
    await waitFor(async () => { await settleEngine(); expect(harness.server.value).toMatchObject({ status: 'preparing', topics: words }); });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('keeps same-screen detail Undo working', async () => {
    const { harness } = setup('detail');
    await finish(harness, 'detail');
    clickUndo();
    await waitFor(async () => { await settleEngine(); expect(harness.server.value).toMatchObject({ status: 'preparing', topics: words }); });
    expect(toast.error).not.toHaveBeenCalled();
  });
});


describe('council Finish command boundaries', () => {
  it('queues Finish and one Undo in order offline, then reconnects with all words retained', async () => {
    const { harness } = setup();
    const button = await screen.findByTestId('council-finish');
    act(() => { harness.engine.setOnline(false); });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(toast.message).toHaveBeenCalledTimes(1));
    await screen.findByTestId('council-topic-topic-1');
    expect(harness.server.value?.status).toBe('preparing');
    const captured = await harness.commits.list('owner');
    expect(captured).toHaveLength(1);
    expect(captured[0].value?.status).toBe('held');
    clickUndo(true);
    let chain = captured;
    await waitFor(async () => { await settleEngine(); chain = await harness.commits.list('owner'); expect(chain).toHaveLength(2); });
    const undo = chain.find(request => request.id !== captured[0].id)!;
    expect(undo.predecessor).toBe(captured[0].id);
    expect(undo.value).toMatchObject({ status: 'preparing', topics: words });
    expect(undo.value).not.toHaveProperty('heldAt');
    // The person sees the locally saved reversal before the network returns.
    await waitFor(() => expect(screen.getByTestId('council-title')).toHaveValue('Council before finishing'));
    await act(async () => { harness.engine.setOnline(true); await harness.engine.retry(); await settleEngine(); });
    await waitFor(async () => { await settleEngine(); expect(harness.server.value).toMatchObject({ status: 'preparing', topics: words }); });
    expect(harness.server.value).not.toHaveProperty('heldAt');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('stays in conduct without Undo on failed local capture and allows an explicit retry', async () => {
    const { harness } = setup();
    const button = await screen.findByTestId('council-finish');
    harness.storage.writeFailure = true;
    fireEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(toast.message).not.toHaveBeenCalled();
    expect(harness.server.value?.status).toBe('preparing');
    expect(await harness.commits.list('owner')).toHaveLength(0);
    harness.storage.writeFailure = false;
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(async () => { await settleEngine(); expect(harness.server.value?.status).toBe('held'); });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
    expect(toast.message).toHaveBeenCalledTimes(1);
  });

  it("preserves another active editor's unsent words without using them as the Undo baseline", async () => {
    const { harness } = setup();
    await finish(harness, 'conduct');
    const other = await harness.engine.openEditor(resource, 'unsent-word-editor');
    await act(async () => { await other.edit({ ...harness.server.value!, title: 'Unsent words stay here' }); });
    clickUndo();
    await waitFor(async () => { await settleEngine(); expect(harness.server.value?.status).toBe('preparing'); });
    expect(harness.server.value?.title).toBe(value.title);
    await act(async () => { await harness.engine.retry(resource); await settleEngine(); });
    expect(other.getState().checkpoint.draft?.title).toBe('Unsent words stay here');
    expect(other.getState().checkpoint.conflicts).toHaveLength(0);
    await act(async () => { await other.save(); await settleEngine(); });
    await waitFor(async () => { await settleEngine(); expect(harness.server.value).toMatchObject({ status: 'preparing', title: 'Unsent words stay here', topics: words }); });
    other.close({ flush: false });
  });

  it('does not recreate a council deleted after Finish', async () => {
    const { harness, leave } = setup();
    await finish(harness, 'conduct');
    harness.silentRemoteDelete();
    await act(async () => { await harness.engine.retry(resource); await settleEngine(); });
    act(() => leave());
    clickUndo();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(harness.server.value).toBeNull();
    expect(harness.server.metadata?.deleted).toBe(true);
  });

  it('refuses the old Undo after signing out', async () => {
    const { harness, leave, changeOwner } = setup();
    await finish(harness, 'conduct');
    act(() => { leave(); changeOwner(null); });
    clickUndo();
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(harness.server.value).toMatchObject({ status: 'held', topics: words });
  });
});


it('keeps an unseen remote deletion deleted and retains the deleted Undo for a decision', async () => {
  const { harness, leave } = setup();
  await finish(harness, 'conduct');
  act(() => leave());
  harness.silentRemoteDelete();
  clickUndo();
  await waitFor(async () => {
    await settleEngine();
    const records = await harness.engine.listRecoverable(resource);
    expect(records.some(record => record.answer === 'conflict')).toBe(true);
  });
  expect(harness.server.value).toBeNull();
  expect(harness.server.metadata?.deleted).toBe(true);
  const commands = jest.mocked(harness.transport.send).mock.calls.map(([command]) => command);
  expect(commands).toHaveLength(2);
  expect(commands.every(command => command.kind === 'update')).toBe(true);
});

it('keeps a deleted Finish for a decision instead of silently undoing its held draft', async () => {
  const { harness } = setup();
  const button = await screen.findByTestId('council-finish');
  harness.silentRemoteDelete();
  fireEvent.click(button);
  await waitFor(() => expect(toast.message).toHaveBeenCalled());
  await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
  await waitFor(async () => {
    await settleEngine();
    const records = await harness.engine.listRecoverable(resource);
    expect(records.some(record => record.answer === 'conflict')).toBe(true);
  });
  clickUndo();
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(jest.mocked(harness.transport.send)).toHaveBeenCalledTimes(1);
  expect(harness.server.value).toBeNull();
  const records = await harness.engine.listRecoverable(resource);
  expect(records.some(record => record.record.checkpoint.draft?.status === 'held')).toBe(true);
});

it('retains a captured Finish refused after navigation and blocks Undo behind its decision', async () => {
  const { harness } = setup();
  const button = await screen.findByTestId('council-finish');
  act(() => { harness.engine.setOnline(false); });
  fireEvent.click(button);
  await waitFor(() => expect(toast.message).toHaveBeenCalledTimes(1));
  await screen.findByTestId('council-topic-topic-1');
  jest.mocked(harness.transport.send).mockImplementationOnce(async command => ({
    kind: 'refused', operationId: command.operationId, code: 'generation-mismatch', message: 'The document was replaced',
  }));
  await act(async () => { harness.engine.setOnline(true); await harness.engine.retry(); await settleEngine(); });
  await waitFor(async () => expect((await harness.commits.list('owner'))[0].state).toBe('refused'));
  clickUndo();
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(await harness.commits.list('owner')).toHaveLength(1);
  expect(harness.server.value).toMatchObject({ status: 'preparing', topics: words });
  const held = await harness.engine.listRecoverable(resource);
  expect(held.some(({ record }) => record.checkpoint.draft?.status === 'held')).toBe(true);
});
