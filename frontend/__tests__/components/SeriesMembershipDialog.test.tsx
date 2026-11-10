import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { SeriesMembershipDialog } from '@/components/series/SeriesMembershipDialog';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { requestOwnerJson } from '@/services/ownerHttpTransport.client';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';
import { settleEngine } from '../../test-utils/documentEngineHarness';
import type { ResourceSnapshot } from '@/data-engine/types';

// Edit history is hidden in the app since 2026-11-09 (utils/editHistory.ts); this file keeps its restore path tested
// for the day history gets its designed place back.
jest.mock('@/utils/editHistory', () => ({ editHistoryShown: () => true }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/services/ownerHttpTransport.client', () => ({ requestOwnerJson: jest.fn() }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/hooks/useGroupsRead', () => ({ useGroupsRead: () => ({ groups: [{ id: 'g', title: 'Meeting' }], loading: false, error: null }) }));
const mockSermons = jest.fn((): unknown[] => []);
jest.mock('@/hooks/useDashboardSermons', () => ({ useDashboardSermons: () => ({ sermons: mockSermons(), loading: false, error: null }) }));
const member = { id: 'group-g', type: 'group', refId: 'g', position: 1 };
const series = (id: string, occupied = false): ResourceSnapshot => ({ resource: { collection: 'series', id },
  metadata: { protocol: 1, generation: `g-${id}`, revision: 1, deleted: false },
  value: { userId: 'owner', title: id, theme: id, bookOrTopic: 'Romans', status: 'draft', createdAt: 'now', updatedAt: 'now',
    items: occupied ? [member] : [], sermonIds: [], seriesKind: occupied ? 'group' : 'sermon' } });
function setup() {
  const harness = membershipEngineHarness([series('a', true), series('b'), { resource: { collection: 'groups', id: 'g' }, metadata: null, value: { userId: 'owner', title: 'Meeting' } }]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const onClose = jest.fn();
  function Workspace({ recoveryId }: { recoveryId?: string }) {
    return <DataEngineProvider><SeriesMembershipDialog seriesId="b" mode={recoveryId ? 'recover' : 'group'} recoveryId={recoveryId} onClose={onClose} /></DataEngineProvider>;
  }
  return { harness, Workspace, onClose, view: render(<Workspace />) };
}
beforeEach(() => jest.clearAllMocks());
it('recovers an unsent selection after restart and atomically submits it only on Save', async () => {
  const { harness, Workspace, view, onClose } = setup();
  const choice = await screen.findByRole('checkbox', { name: 'Meeting' }); fireEvent.click(choice);
  await act(async () => { await settleEngine(); }); expect(harness.transport.send).not.toHaveBeenCalled();
  const saved = await harness.engine.listMembershipRecovery(); expect(saved).toHaveLength(1);
  view.unmount(); const restored = render(<Workspace recoveryId={saved[0].scopeId} />);
  const recovered = await screen.findByRole('checkbox', { name: 'Meeting' }); expect(recovered).toBeChecked();
  expect(harness.transport.send).not.toHaveBeenCalled(); act(() => harness.engine.setOnline(false));
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(await harness.commits.list('owner')).toHaveLength(2); expect(harness.read(series('a').resource).value!.items).toEqual([member]);
  await act(async () => { harness.engine.setOnline(true); await harness.engine.retry(); await settleEngine(); });
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(harness.read(series('a').resource).value!.items).toEqual([]);
  expect(harness.read(series('b').resource).value!.items).toEqual([member]); restored.unmount();
});
it('retains the original source when the destination is deleted after selection opens', async () => {
  const { harness, view, onClose } = setup();
  const choice = await screen.findByRole('checkbox', { name: 'Meeting' });
  harness.replace({ ...series('b'), value: null, metadata: { ...series('b').metadata!, deleted: true, revision: 2 } });
  fireEvent.click(choice); await act(async () => { await settleEngine(); });
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.read(series('a').resource).value!.items).toEqual([member]);
  const recovery = await harness.engine.listMembershipRecovery(); expect(recovery).toHaveLength(1);
  expect(await harness.engine.membershipDelivery(recovery[0].scopeId)).toMatchObject({ phase: 'refused', canDiscard: true }); view.unmount();
});
it('pins reorder before the gesture and preserves a remote insertion', async () => {
  const extra = { ...member, id: 'group-h', refId: 'h', position: 2 };
  const inserted = { ...member, id: 'group-i', refId: 'i', position: 3 };
  const start = series('a', true); start.value!.items = [member, extra];
  const harness = membershipEngineHarness([start, ...['g', 'h', 'i'].map(id => ({ resource: { collection: 'groups', id }, metadata: null, value: { userId: 'owner', title: id } }))]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const onClose = jest.fn();
  const view = render(<DataEngineProvider><SeriesMembershipDialog seriesId="a" mode="reorder" onClose={onClose} /></DataEngineProvider>);
  const down = await screen.findByRole('button', { name: 'common.moveDown: Meeting' });
  harness.replace({ ...start, metadata: { ...start.metadata!, revision: 2 }, value: { ...start.value, items: [member, extra, inserted] } });
  fireEvent.click(down); await act(async () => { await settleEngine(); });
  expect(harness.transport.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'common.save' })); await waitFor(() => expect(onClose).toHaveBeenCalled());
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.read(start.resource).value!.items).toEqual([{ ...extra, position: 1 }, { ...member, position: 2 }, inserted]);
  expect(harness.transport.send).toHaveBeenCalledTimes(1); view.unmount();
});
it.each(['keep', 'review', 'stale'])('shows both saved orders and resolves only the chosen reorder (%s)', async scenario => {
  const review = scenario !== 'keep';
  const words = ['Opening', 'Middle', 'Closing', 'New item'];
  const items = words.map((title, index) => ({ id: 'sermon-' + index, type: 'sermon', refId: 's' + index, position: index + 1, title }));
  mockSermons.mockReturnValue(items.map(({ title, refId }) => ({ id: refId, title })));
  const start = series('a');
  const value = (order: number[]) => ({ ...start.value!, items: order.map((index, position) => ({ ...items[index], position: position + 1 })),
    sermonIds: order.map(index => items[index].refId) });
  start.value = value([0, 1, 2]);
  const remote = { ...start, metadata: { ...start.metadata!, revision: 2 }, value: value([1, 0, 2, 3]) };
  const harness = membershipEngineHarness([start, ...items.map(({ refId, title }) => ({
    resource: { collection: 'sermons', id: refId }, metadata: null, value: { userId: 'owner', title },
  }))]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  jest.mocked(harness.transport.send).mockImplementationOnce(async command => ({
    kind: 'conflict', operationId: command.operationId, snapshot: remote,
    conflicts: [{ path: ['items'], base: { exists: true, value: start.value!.items }, mine: { exists: true, value: value([0, 2, 1]).items },
      theirs: { exists: true, value: remote.value.items } }],
  }));
  const onClose = jest.fn();
  function Workspace({ recoveryId }: { recoveryId?: string }) {
    return <DataEngineProvider><SeriesMembershipDialog key={recoveryId ?? 'new'}
      seriesId="a" mode={recoveryId ? 'recover' : 'reorder'} recoveryId={recoveryId} onClose={onClose} /></DataEngineProvider>;
  }
  const view = render(<Workspace />);
  fireEvent.click(await screen.findByRole('button', { name: 'common.moveDown: Middle' }));
  const save = screen.getByRole('button', { name: 'common.save' });
  await waitFor(() => expect(save).toBeEnabled());
  harness.replace(remote);
  fireEvent.click(save);
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(harness.transport.send).toHaveBeenCalledTimes(1));
  const previous = (await harness.engine.listMembershipRecovery()).find(record => record.phase === 'submitted')!;
  expect(previous).toBeDefined();
  view.rerender(<Workspace recoveryId={previous.scopeId} />);
  const comparison = await screen.findByRole('region', { name: 'workspaces.series.reorderRecovery.heading' });
  const titles = (label: string) => within(within(comparison).getByRole('list', { name: label })).getAllByRole('listitem').map(row => row.textContent);
  expect(titles('dataSync.yourVersion')).toEqual(['Opening', 'Closing', 'Middle']);
  expect(titles('dataSync.storedVersion')).toEqual(['Middle', 'Opening', 'Closing', 'New item']);
  const button = within(comparison).getByRole('button', { name: review ? 'workspaces.series.reorderRecovery.review' : 'dataSync.useStoredVersion' });
  if (scenario === 'stale') {
    // Closing is removed and re-added in the same place while this comparison is open.
    harness.replace({ ...remote, metadata: { ...remote.metadata, revision: 3 }, value: value([1, 0, 3]) });
    harness.replace({ ...remote, metadata: { ...remote.metadata, revision: 4 } });
    fireEvent.click(button);
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'dataSync.retry' })).not.toBeInTheDocument();
    expect(await harness.scopes.completion('owner', previous.scopeId)).toBeNull();
    expect(await harness.engine.listMembershipRecovery()).toEqual([expect.objectContaining({ scopeId: previous.scopeId, phase: 'submitted' })]);
    expect(harness.transport.send).toHaveBeenCalledTimes(1);
    expect(harness.read(start.resource).value?.sermonIds).toEqual(['s1', 's0', 's2', 's3']);
    view.unmount();
    return;
  }
  if (review) {
    const runReview = harness.engine.reviewSeriesReorder.bind(harness.engine);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const waiting = jest.spyOn(harness.engine, 'reviewSeriesReorder').mockImplementationOnce(async (...args) => {
      await gate;
      return runReview(...args);
    });
    fireEvent.click(button);
    try {
      expect(waiting).toHaveBeenCalledTimes(1);
      const close = screen.getByRole('button', { name: 'common.close' });
      expect(close).toBeDisabled();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally { release(); }
  } else fireEvent.click(button);
  await waitFor(async () => expect(await harness.scopes.completion('owner', previous.scopeId)).toBe('cancelled'));
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  if (review) {
    const next = screen.getByRole('button', { name: 'common.save' });
    await waitFor(() => expect(next).toBeEnabled());
    expect(await harness.engine.listMembershipRecovery()).toEqual([expect.objectContaining({
      phase: 'editing', action: { kind: 'reorder', seriesId: 'a', itemIds: ['sermon-0', 'sermon-2', 'sermon-1', 'sermon-3'],
        reorder: [{ itemId: 'sermon-1', index: 2 }] },
    })]);
    fireEvent.click(next);
    await waitFor(() => expect(harness.transport.send).toHaveBeenCalledTimes(2));
    expect(harness.read(start.resource).value?.sermonIds).toEqual(['s0', 's2', 's1', 's3']);
  } else {
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
    expect(harness.read(start.resource).value?.sermonIds).toEqual(['s1', 's0', 's2', 's3']);
  }
  view.unmount();
});

it('retries a locally failed cancellation without restoring or sending the discarded selection', async () => {
  const { harness, view } = setup();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Meeting' }));
  await act(async () => { await settleEngine(); });
  harness.disk.writeFailure = true;
  fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
  fireEvent.click(await screen.findByRole('button', { name: 'common.discardChanges.confirm' }));
  await screen.findByRole('alert');
  harness.disk.writeFailure = false;
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.retry' }));
  await act(async () => { await settleEngine(); });
  expect(await harness.engine.listMembershipRecovery()).toHaveLength(0);
  expect(harness.transport.send).not.toHaveBeenCalled(); view.unmount();
});

// Choosing a series for a sermon or group searched its title, theme and book or topic before the
// dialog replaced SeriesSelector; a series is often remembered by its book, not its title.
it('finds a series to move into by its theme or its book, not only its title', async () => {
  const named = (id: string, title: string, theme: string, bookOrTopic: string): ResourceSnapshot => ({ ...series(id),
    value: { ...series(id).value!, title, theme, bookOrTopic } });
  const harness = membershipEngineHarness([named('a', 'Autumn', 'Grace and law', 'Romans'), named('b', 'Winter', 'Hope', 'Psalms'),
    { resource: { collection: 'groups', id: 'g' }, metadata: null, value: { userId: 'owner', title: 'Meeting' } }]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  render(<DataEngineProvider><SeriesMembershipDialog seriesId="a" mode="target" member={{ type: 'group', refId: 'g' }} onClose={jest.fn()} /></DataEngineProvider>);
  const search = await screen.findByRole('textbox', { name: 'common.search' });
  await screen.findByRole('radio', { name: 'Winter' });
  fireEvent.change(search, { target: { value: 'psalms' } });
  expect(screen.getByRole('radio', { name: 'Winter' })).toBeInTheDocument();
  expect(screen.queryByRole('radio', { name: 'Autumn' })).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'grace' } });
  expect(screen.getByRole('radio', { name: 'Autumn' })).toBeInTheDocument();
  expect(screen.queryByRole('radio', { name: 'Winter' })).not.toBeInTheDocument();
});

it('restores a group assignment through the ordinary form and fences a missing or replaced series', async () => {
  const harness = membershipEngineHarness([series('a', true), series('b'),
    { resource: { collection: 'groups', id: 'g' }, metadata: null, value: { userId: 'owner', title: 'Meeting' } }]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const current = { id: 'a', generation: 'g-a', label: 'Current A' };
  jest.mocked(requestOwnerJson).mockResolvedValue({ status: 200, value: {
    owner: 'owner', collection: 'groups', memberId: 'g', generation: null, nextCursor: null,
    entries: [
      { id: 'available', former: { id: 'b', generation: 'g-b', label: 'Former B' }, current },
      { id: 'replaced', former: { id: 'b', generation: 'old-b', label: 'Old B' }, current },
      { id: 'deleted', former: { id: 'gone', generation: 'gone', label: 'Gone C' }, current },
      { id: 'clear', former: null, current },
    ],
  } });
  render(<DataEngineProvider><SeriesMembershipDialog seriesId="a" mode="target" member={{ type: 'group', refId: 'g' }} onClose={jest.fn()} /></DataEngineProvider>);
  const heading = 'workspaces.series.membershipHistory.heading', restore = 'workspaces.series.membershipHistory.restore';
  fireEvent.click(await screen.findByRole('button', { name: heading }));
  const region = await screen.findByRole('region', { name: heading });
  const buttonFor = (label: string) => within(within(region).getByText(label).closest('li')!).getByRole('button', { name: restore });
  await within(region).findByText('Former B');
  expect(buttonFor('Old B')).toBeDisabled();
  expect(buttonFor('Gone C')).toBeDisabled();
  fireEvent.click(buttonFor('Former B'));
  await waitFor(() => expect(screen.getByRole('radio', { name: 'b' })).toBeChecked());
  expect(harness.transport.send).not.toHaveBeenCalled();
  await waitFor(() => expect(buttonFor('addSermon.noSeriesOption')).toBeEnabled());
  fireEvent.click(buttonFor('addSermon.noSeriesOption'));
  await waitFor(() => expect(screen.getByRole('radio', { name: 'addSermon.noSeriesOption' })).toBeChecked());
  expect(harness.transport.send).not.toHaveBeenCalled();
  await waitFor(() => expect(buttonFor('Former B')).toBeEnabled());
  fireEvent.click(buttonFor('Former B'));
  await waitFor(() => expect(screen.getByRole('radio', { name: 'b' })).toBeChecked());
  const save = screen.getByRole('button', { name: 'common.save' });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(harness.transport.send).toHaveBeenCalledTimes(1));
});

it('opens the exact disputed assignment as a durable unsent choice before retiring the refused attempt', async () => {
  const harness = membershipEngineHarness([series('a', true), series('b'), series('c'),
    { resource: { collection: 'groups', id: 'g' }, metadata: null, value: { userId: 'owner', title: 'Meeting' } }]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const compared = [{ ref: { type: 'group' as const, refId: 'g' }, label: 'Meeting',
    proposed: { id: 'b', generation: 'g-b', label: 'Pending B' }, stored: { id: 'c', generation: 'g-c', label: 'Saved C' } }];
  jest.mocked(harness.transport.send).mockImplementationOnce(async command => ({
    kind: 'refused', operationId: command.operationId, code: 'membership-already-assigned', seriesMembershipComparisons: compared,
  }));
  const onClose = jest.fn();
  const memberRef = { type: 'group' as const, refId: 'g' };
  function Workspace({ recoveryId }: { recoveryId?: string }) {
    return <DataEngineProvider><SeriesMembershipDialog key={recoveryId ?? 'initial'}
      seriesId="a" mode={recoveryId ? 'recover' : 'target'} member={memberRef} recoveryId={recoveryId} onClose={onClose} /></DataEngineProvider>;
  }
  const view = render(<Workspace />);
  fireEvent.click(await screen.findByRole('radio', { name: 'b' }));
  const save = screen.getByRole('button', { name: 'common.save' });
  await waitFor(() => expect(save).toBeEnabled());
  harness.replace({ ...series('a'), metadata: { ...series('a').metadata!, revision: 2 } });
  harness.replace({ ...series('c', true), metadata: { ...series('c').metadata!, revision: 2 } });
  fireEvent.click(save);
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  await waitFor(() => expect(harness.transport.send).toHaveBeenCalledTimes(1));
  const previous = (await harness.engine.listMembershipRecovery()).find(record => record.phase === 'submitted')!;
  expect(previous).toBeDefined();
  view.rerender(<Workspace recoveryId={previous.scopeId} />);
  const review = await screen.findByRole('button', { name: 'workspaces.series.membershipHistory.review' });
  expect(screen.getByRole('region', { name: 'workspaces.series.membershipHistory.comparisonHeading' })).toBeInTheDocument();
  fireEvent.click(review);
  await waitFor(() => expect(screen.getByRole('radio', { name: 'b' })).toBeChecked());
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(await harness.scopes.completion('owner', previous.scopeId)).toBe('cancelled');
  const drafts = await harness.engine.listMembershipRecovery();
  expect(drafts).toEqual([expect.objectContaining({ phase: 'editing', action: { kind: 'assign', refs: [memberRef], targetId: 'b' } })]);
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await waitFor(() => expect(harness.transport.send).toHaveBeenCalledTimes(2));
  expect(harness.read(series('b').resource).value?.items).toEqual([member]);
  expect(harness.read(series('c').resource).value?.items).toEqual([]);
});

// The sermon picker searched title, verse, thought text and tags (matchesSermonQuery) before the
// dialog replaced AddSermonToSeriesModal; a preacher looks a sermon up by its verse or a phrase.
it('finds a sermon to add by its verse or a thought, through the shared sermon search', async () => {
  mockSermons.mockReturnValue([
    { id: 's1', title: 'Opening', verse: 'John 3:16', thoughts: [{ id: 't', text: 'Light in darkness', tags: [] }] },
    { id: 's2', title: 'Closing', verse: 'Psalm 23', thoughts: [] },
  ]);
  const harness = membershipEngineHarness([series('b')]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  render(<DataEngineProvider><SeriesMembershipDialog seriesId="b" mode="sermon" onClose={jest.fn()} /></DataEngineProvider>);
  const search = await screen.findByRole('textbox', { name: 'common.search' });
  await screen.findByRole('checkbox', { name: 'Opening' });
  fireEvent.change(search, { target: { value: 'john 3' } });
  expect(screen.getByRole('checkbox', { name: 'Opening' })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'Closing' })).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'darkness' } });
  expect(screen.getByRole('checkbox', { name: 'Opening' })).toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'psalm' } });
  expect(screen.getByRole('checkbox', { name: 'Closing' })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'Opening' })).not.toBeInTheDocument();
  mockSermons.mockReturnValue([]);
});
