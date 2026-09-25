import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SeriesMembershipDialog } from '@/components/series/SeriesMembershipDialog';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';
import { settleEngine } from '../../test-utils/documentEngineHarness';
import type { ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/hooks/useGroupsRead', () => ({ useGroupsRead: () => ({ groups: [{ id: 'g', title: 'Meeting' }], loading: false, error: null }) }));
jest.mock('@/hooks/useDashboardSermons', () => ({ useDashboardSermons: () => ({ sermons: [], loading: false, error: null }) }));
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
it('retries a locally failed cancellation without restoring or sending the discarded selection', async () => {
  const { harness, view } = setup();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Meeting' }));
  await act(async () => { await settleEngine(); });
  harness.disk.writeFailure = true;
  fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
  await screen.findByRole('alert');
  harness.disk.writeFailure = false;
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.retry' }));
  await act(async () => { await settleEngine(); });
  expect(await harness.engine.listMembershipRecovery()).toHaveLength(0);
  expect(harness.transport.send).not.toHaveBeenCalled(); view.unmount();
});
