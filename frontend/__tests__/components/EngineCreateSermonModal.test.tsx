import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import { EngineCreateSermonModal } from '@/components/sermon/EngineCreateSermonModal';
import { SeriesMembershipRecovery } from '@/components/series/SeriesMembershipRecovery';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { settleEngine } from '../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/church/ChurchField', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/DatePickerField', () => ({ __esModule: true, default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
  <input aria-label="Planned date" value={value} onChange={event => onChange(event.target.value)} /> }));

function setup(open = true, preSelectedSeriesId?: string) {
  const harness = membershipEngineHarness([{ resource: { collection: 'series', id: 'target' }, metadata: null,
    value: { userId: 'owner', theme: 'Target', title: 'Target', bookOrTopic: '', status: 'draft', items: [], sermonIds: [], seriesKind: 'sermon' } }]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const queued = jest.fn();
  function Workspace({ initialOpen = open }: { initialOpen?: boolean }) {
    const [visible, setVisible] = useState(initialOpen);
    return <DataEngineProvider><SeriesMembershipRecovery />{visible && <EngineCreateSermonModal preSelectedSeriesId={preSelectedSeriesId} allowPlannedDate onClose={() => setVisible(false)}
      onQueued={id => { queued(id); setVisible(false); }} />}</DataEngineProvider>;
  }
  return { harness, queued, Workspace, view: render(<Workspace />) };
}
async function typeSermon() {
  const title = await screen.findByLabelText('addSermon.titleLabel'); await waitFor(() => expect(title).toBeEnabled());
  fireEvent.change(title, { target: { value: 'New sermon' } });
  fireEvent.change(screen.getByLabelText('addSermon.verseLabel'), { target: { value: 'Romans 1' } });
  await act(async () => { await settleEngine(); });
}
beforeEach(() => { jest.clearAllMocks(); process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'series,sermons'; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

it('stages typing and a planned date, then creates the sermon and selected series link in one command', async () => {
  const { harness, queued, view } = setup(); await typeSermon();
  fireEvent.change(screen.getByLabelText('Planned date'), { target: { value: '2026-10-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.selectSeries' }));
  fireEvent.change(await screen.findByLabelText('addSermon.seriesLabel'), { target: { value: 'target' } });
  await act(async () => { await settleEngine(); });
  expect(harness.transport.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' })); await waitFor(() => expect(queued).toHaveBeenCalledTimes(1));
  const id = queued.mock.calls[0][0];
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(harness.read({ collection: 'sermons', id }).value).toMatchObject({ title: 'New sermon', verse: 'Romans 1',
    preachDates: [{ date: '2026-10-01', status: 'planned', church: { id: 'church-unspecified' } }] });
  expect(harness.read({ collection: 'series', id: 'target' }).value?.sermonIds).toEqual([id]); view.unmount();
});

it('recovers the whole creation after closing and restarting without sending or allocating another ID', async () => {
  const { harness, Workspace, view } = setup(); await typeSermon();
  const first = (await harness.scopes.list('owner'))[0];
  fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
  await screen.findByRole('option', { name: 'New sermon' }); view.unmount();
  const restored = render(<Workspace initialOpen={false} />);
  const option = await screen.findByRole('option', { name: 'New sermon' });
  fireEvent.change(screen.getByLabelText('dataSync.recoveryLabel'), { target: { value: option.getAttribute('value') } });
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' }));
  await screen.findByRole('dialog');
  await waitFor(() => expect(screen.getByLabelText('addSermon.titleLabel')).toHaveValue('New sermon'));
  expect(screen.getByLabelText('addSermon.verseLabel')).toHaveValue('Romans 1');
  expect((await harness.scopes.list('owner'))[0].creation?.resource).toEqual(first.creation?.resource);
  expect(harness.transport.send).not.toHaveBeenCalled(); restored.unmount();
});

it('cancels unsent input without creating a resource or leaving a recovery choice', async () => {
  const { harness, view } = setup(); await typeSermon();
  fireEvent.click(screen.getByRole('button', { name: 'addSermon.cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await act(async () => { await settleEngine(); });
  expect(await harness.engine.listMembershipRecovery()).toEqual([]); expect(await harness.commits.list('owner')).toEqual([]);
  expect(harness.transport.send).not.toHaveBeenCalled(); view.unmount();
});

it('can create a standalone sermon after the optional catalog fails, without losing typed input', async () => {
  const { harness, queued, view } = setup(); await typeSermon();
  expect(harness.collectionTransport.list).not.toHaveBeenCalled();
  harness.collectionTransport.list.mockRejectedValue(new Error('catalog unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.selectSeries' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('addSermon.titleLabel')).toHaveValue('New sermon');
  fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' }));
  await waitFor(() => expect(queued).toHaveBeenCalledTimes(1));
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(jest.mocked(harness.transport.send).mock.calls[0][0].kind).toBe('create'); view.unmount();
});


it('pins a preset automatically and atomically creates in that series without a second selection', async () => {
  const { harness, queued, view } = setup(true, 'target'); await typeSermon();
  await waitFor(() => expect(screen.getByLabelText('addSermon.seriesLabel')).toHaveValue('target'));
  fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' }));
  await waitFor(() => expect(queued).toHaveBeenCalledTimes(1));
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(harness.read({ collection: 'series', id: 'target' }).value?.sermonIds).toEqual([queued.mock.calls[0][0]]);
  view.unmount();
});

it('restores an unavailable preset and requires an explicit choice before saving outside the series', async () => {
  const { harness, Workspace, queued, view } = setup(true, 'missing'); await typeSermon();
  await screen.findByText('addSermon.pendingSeries');
  expect(screen.getByRole('button', { name: 'addSermon.save' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
  await screen.findByRole('option', { name: 'New sermon' }); view.unmount();
  const restored = render(<Workspace initialOpen={false} />);
  const option = await screen.findByRole('option', { name: 'New sermon' });
  fireEvent.change(screen.getByLabelText('dataSync.recoveryLabel'), { target: { value: option.getAttribute('value') } });
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' }));
  await screen.findByText('addSermon.pendingSeries'); await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'addSermon.save' })).toBeDisabled();
  expect(harness.transport.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'addSermon.createWithoutSeries' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'addSermon.save' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(jest.mocked(harness.transport.send).mock.calls[0][0].kind).toBe('create');
  expect(queued).not.toHaveBeenCalled(); restored.unmount();
});
