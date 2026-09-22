import { act, render, screen } from '@testing-library/react';

import { EngineOutlineModal } from '@/components/sermon/EngineOutlineModal';
import ScratchPanel from '@/components/sermon/ScratchPanel';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataEngine } from '@/data-engine/react.client';

import { useScratchDataDocument } from '../../hooks/useScratchDataDocument';
import { EngineScratchWorkspace } from '../EngineScratchWorkspace';

import type { RecoveryCheckpoint } from '@/data-engine/controller';
import type { Json, ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/components/sermon/EngineOutlineModal', () => ({ EngineOutlineModal: jest.fn(() => <div data-testid="proposal" />) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/data-engine/react.client', () => ({ useDataEngine: jest.fn() }));
jest.mock('../../hooks/useScratchDataDocument', () => ({ useScratchDataDocument: jest.fn() }));
jest.mock('@/data-engine/DataSyncStatus', () => ({ DataSyncStatus: jest.fn(() => <div data-testid="sync-status" />) }));
jest.mock('@/components/sermon/ScratchPanel', () => ({ __esModule: true, default: jest.fn(() => <div data-testid="scratch-panel" />) }));

const snapshot = (revision = 1, title = 'Confirmed'): ResourceSnapshot => ({
  resource: { collection: 'sermons', id: 'sermon' },
  value: { userId: 'owner', title, scratch: [{ id: 'note', text: 'Confirmed note', createdAt: '2026-09-12' }] },
  metadata: { protocol: 1, generation: 'generation', revision, deleted: false },
});
function setup(overrides: Partial<ReturnType<typeof useScratchDataDocument>> = {}) {
  const confirmed = snapshot();
  const scratch = {
    confirmed, remote: null, data: confirmed.value, state: null,
    status: null, error: null, loading: false, notes: [{ id: 'note', text: 'Local note', createdAt: '2026-09-12' }],
    outline: { introduction: [], main: [], conclusion: [] }, scratchRevision: 3, isWritePending: true,
    addScratchNote: jest.fn(), restoreScratchNote: jest.fn(), updateScratchNote: jest.fn(), deleteScratchNote: jest.fn(), moveScratchNote: jest.fn(),
    applyOutlineAndConsume: jest.fn(async () => ({ delivery: 'queued' as const })), onOutlineChange: jest.fn(async () => ({ delivery: 'queued' as const })),
    keepLocal: jest.fn(async () => undefined), acceptRemote: jest.fn(async () => undefined), retry: jest.fn(async () => undefined),
    listRecoverable: jest.fn(async (): Promise<RecoveryCheckpoint[]> => []), recover: jest.fn(async () => undefined),
    ...overrides,
  } as ReturnType<typeof useScratchDataDocument>;
  jest.mocked(useDataEngine).mockReturnValue({ owner: 'owner', browser: null, error: null });
  jest.mocked(useScratchDataDocument).mockImplementation(() => scratch);
  return scratch;
}
const statusProps = () => jest.mocked(DataSyncStatus).mock.calls.at(-1)![0];
const panelProps = () => jest.mocked(ScratchPanel).mock.calls.at(-1)![0];
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const recovered = (id: string, title: unknown = 'Recovery', scratch: unknown = [{ text: 'Unsaved text' }]): RecoveryCheckpoint => ({
  id,
  record: { owner: 'owner', editorId: id, prepared: null, unfinalized: [], checkpoint: {
    draft: { title: title as Json, scratch: scratch as Json }, confirmed: snapshot(), dirty: true,
    editGeneration: 1, remoteCandidate: null, conflicts: [], pending: {},
  } },
});

describe('EngineScratchWorkspace', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('passes domain interactions, queued Apply and canonical status without listing recovery on startup', async () => {
    const scratch = setup(); render(<EngineScratchWorkspace sermonId="sermon" />);
    expect(useScratchDataDocument).toHaveBeenCalledWith('sermon');
    expect(screen.getByTestId('sync-status')).toBeInTheDocument();
    expect(panelProps()).toMatchObject({ sermonId: 'sermon', notes: scratch.notes, outline: scratch.outline, scratchRevision: 3, isScratchWritePending: true, isReadOnly: false });
    for (const key of ['addScratchNote', 'restoreScratchNote', 'updateScratchNote', 'deleteScratchNote', 'moveScratchNote'] as const) expect(panelProps()[key]).toBe(scratch[key]);
    expect(panelProps().onApplyOutline).toBeUndefined();
    expect(panelProps().onOutlineChange).toBeUndefined();
    expect(panelProps().onEditPlan).toEqual(expect.any(Function));
    expect(scratch.listRecoverable).not.toHaveBeenCalled();
    await statusProps().onKeepLocal?.(); await statusProps().onAcceptRemote?.(); await statusProps().onRetry?.();
    expect(scratch.keepLocal).toHaveBeenCalledTimes(1); expect(scratch.acceptRemote).toHaveBeenCalledTimes(1); expect(scratch.retry).toHaveBeenCalledTimes(1);
  });

  it('emits only distinct confirmed snapshots, never the dirty visible draft', () => {
    const scratch = setup(); const publish = jest.fn(); const view = render(<EngineScratchWorkspace sermonId="sermon" onConfirmed={publish} />);
    expect(publish).toHaveBeenCalledWith(scratch.confirmed);
    scratch.data = { ...scratch.data!, title: 'Unsaved local words' };
    scratch.confirmed = JSON.parse(JSON.stringify(scratch.confirmed));
    view.rerender(<EngineScratchWorkspace sermonId="sermon" onConfirmed={publish} />);
    expect(publish).toHaveBeenCalledTimes(1);
    scratch.confirmed = snapshot(2, 'Acknowledged');
    view.rerender(<EngineScratchWorkspace sermonId="sermon" onConfirmed={publish} />);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1][0].value.title).toBe('Acknowledged');
    scratch.confirmed = { ...snapshot(2, 'Legacy content change'), metadata: null };
    view.rerender(<EngineScratchWorkspace sermonId="sermon" onConfirmed={publish} />);
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it('shows loading and absence separately while keeping canonical error and recovery controls', () => {
    const scratch = setup({ loading: true, data: null, confirmed: null, error: 'Read failed' });
    const view = render(<EngineScratchWorkspace sermonId="sermon" />);
    expect(screen.getByText('common.loading')).toBeInTheDocument();
    expect(screen.queryByTestId('scratch-panel')).not.toBeInTheDocument();
    expect(statusProps().error).toBe('Read failed');
    scratch.loading = false; view.rerender(<EngineScratchWorkspace sermonId="sermon" />);
    expect(screen.getByText('common.noData')).toBeInTheDocument();
    expect(statusProps().onListRecovery).toEqual(expect.any(Function));
  });

  it('retains visible dirty notes while locking all editing after remote deletion', () => {
    const scratch = setup(); const view = render(<EngineScratchWorkspace sermonId="sermon" />);
    scratch.remote = { ...snapshot(2), value: null, metadata: { ...snapshot(2).metadata!, deleted: true } };
    view.rerender(<EngineScratchWorkspace sermonId="sermon" />);
    expect(panelProps().notes).toEqual(scratch.notes);
    expect(panelProps().isReadOnly).toBe(true);
    scratch.remote = null; scratch.confirmed = { ...snapshot(2), value: null };
    view.rerender(<EngineScratchWorkspace sermonId="sermon" />); expect(panelProps().isReadOnly).toBe(true);
    scratch.confirmed = { ...snapshot(3), metadata: { ...snapshot(3).metadata!, deleted: true } };
    view.rerender(<EngineScratchWorkspace sermonId="sermon" />); expect(panelProps().isReadOnly).toBe(true);
    scratch.confirmed = snapshot();
    view.rerender(<EngineScratchWorkspace sermonId="sermon" isReadOnly />); expect(panelProps().isReadOnly).toBe(true);
  });

  it('lists human recovery titles and previews only on request and recovers only the explicit selection', async () => {
    const scratch = setup();
    jest.mocked(scratch.listRecoverable).mockResolvedValue([
      recovered('source', 'My draft', [{ text: 'First' }, null, ['skip'], { text: 4 }, { text: 'Second' }]),
      recovered('fallback', ' ', null), recovered('confirmed', null, [{ text: 'x'.repeat(600) }]),
    ]);
    render(<EngineScratchWorkspace sermonId="sermon" />);
    await act(async () => { await statusProps().onListRecovery?.(); });
    expect(statusProps().recoveryChoices).toEqual([
      { id: 'source', title: 'My draft', preview: 'First\nSecond' },
      { id: 'fallback', title: 'freshness.entitySermon' },
      { id: 'confirmed', title: 'Confirmed', preview: 'x'.repeat(500) },
    ]);
    expect(scratch.recover).not.toHaveBeenCalled();
    await act(async () => { await statusProps().onRecover?.('source'); });
    expect(scratch.recover).toHaveBeenCalledWith('source');
    expect(statusProps().recoveryChoices).toEqual([]);
  });

  it('publishes recovery errors and preserves choices when explicit recovery fails', async () => {
    const scratch = setup(); render(<EngineScratchWorkspace sermonId="sermon" />);
    jest.mocked(scratch.listRecoverable).mockRejectedValueOnce(new Error('Storage failed'));
    await act(async () => { await statusProps().onListRecovery?.(); });
    expect(statusProps().recoveryError).toBe('Storage failed');
    jest.mocked(scratch.listRecoverable).mockRejectedValueOnce('unexpected');
    await act(async () => { await statusProps().onListRecovery?.(); });
    expect(statusProps().recoveryError).toBe('dataSync.actionFailed');
    jest.mocked(scratch.listRecoverable).mockResolvedValueOnce([recovered('source')]);
    await act(async () => { await statusProps().onListRecovery?.(); });
    jest.mocked(scratch.recover).mockRejectedValueOnce(new Error('Recovery failed'));
    await act(async () => { await statusProps().onRecover?.('source'); });
    expect(statusProps().recoveryError).toBe('Recovery failed');
    expect(statusProps().recoveryChoices).toHaveLength(1);
    jest.mocked(scratch.recover).mockRejectedValueOnce(null);
    await act(async () => { await statusProps().onRecover?.('source'); });
    expect(statusProps().recoveryError).toBe('dataSync.actionFailed');
  });

  it('fences late recovery lists across owner changes and prevents stale action callbacks', async () => {
    const scratch = setup(); const pending = deferred<RecoveryCheckpoint[]>();
    jest.mocked(scratch.listRecoverable).mockReturnValueOnce(pending.promise);
    const publish = jest.fn(); const view = render(<EngineScratchWorkspace sermonId="sermon" onConfirmed={publish} />);
    const oldActions = statusProps();
    let request!: Promise<void>;
    act(() => { request = oldActions.onListRecovery!() as Promise<void>; });
    expect(statusProps().recoveryLoading).toBe(true);
    jest.mocked(useDataEngine).mockReturnValue({ owner: null, browser: null, error: null });
    view.rerender(<EngineScratchWorkspace sermonId="sermon" onConfirmed={publish} />);
    await act(async () => { pending.resolve([recovered('old-account')]); await request; });
    expect(statusProps().recoveryChoices).toEqual([]);
    expect(panelProps().isReadOnly).toBe(true);
    await oldActions.onKeepLocal?.(); await oldActions.onAcceptRemote?.(); await oldActions.onRetry?.(); await oldActions.onRecover?.('old'); await oldActions.onListRecovery?.();
    expect(scratch.keepLocal).not.toHaveBeenCalled(); expect(scratch.acceptRemote).not.toHaveBeenCalled(); expect(scratch.retry).not.toHaveBeenCalled(); expect(scratch.recover).not.toHaveBeenCalled();
    expect(scratch.listRecoverable).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('fences late recovery completion across navigation and unmount without publishing a foreign snapshot', async () => {
    const scratch = setup(); const pending = deferred<void>(); jest.mocked(scratch.recover).mockReturnValueOnce(pending.promise);
    const publish = jest.fn(); const view = render(<EngineScratchWorkspace sermonId="sermon" onConfirmed={publish} />);
    let request!: Promise<void>; act(() => { request = statusProps().onRecover!('source') as Promise<void>; });
    view.rerender(<EngineScratchWorkspace sermonId="other" onConfirmed={publish} />);
    await act(async () => { pending.resolve(); await request; });
    expect(statusProps().recoveryChoices).toEqual([]);
    expect(publish).toHaveBeenCalledTimes(1);
    const listing = deferred<RecoveryCheckpoint[]>(); jest.mocked(scratch.listRecoverable).mockReturnValueOnce(listing.promise);
    const actions = statusProps(); act(() => { request = actions.onListRecovery!() as Promise<void>; });
    view.unmount(); await act(async () => { listing.reject(new Error('Late failure')); await request; });
    await actions.onRecover?.('source'); expect(scratch.recover).toHaveBeenCalledTimes(1);
  });

  it('lets the newest recovery request win over older success or failure', async () => {
    const scratch = setup(); const old = deferred<RecoveryCheckpoint[]>();
    jest.mocked(scratch.listRecoverable).mockReturnValueOnce(old.promise).mockResolvedValueOnce([recovered('new')]);
    render(<EngineScratchWorkspace sermonId="sermon" />);
    let first!: Promise<void>; act(() => { first = statusProps().onListRecovery!() as Promise<void>; });
    await act(async () => { await statusProps().onListRecovery?.(); });
    await act(async () => { old.resolve([recovered('stale')]); await first; });
    expect(statusProps().recoveryChoices?.[0].id).toBe('new');
  });
});

it('opens a pinned proposal form instead of using late outline callbacks', () => {
  setup(); const view = render(<EngineScratchWorkspace sermonId="sermon" />);
  act(() => { panelProps().onEditPlan!(); });
  expect(jest.mocked(EngineOutlineModal).mock.calls.at(-1)![0]).toMatchObject({ sermonId: 'sermon', withScratch: true });
  act(() => { jest.mocked(EngineOutlineModal).mock.calls.at(-1)![0].onClose(); });
  expect(screen.queryByTestId('proposal')).not.toBeInTheDocument(); view.unmount();
});
