import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import EditSermonModal from '@/components/EditSermonModal';
import { SeriesMembershipRecovery } from '@/components/series/SeriesMembershipRecovery';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { persistedWrite } from '@/utils/recoverableWrite';
import { settleEngine } from '../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';

import type { Sermon } from '@/models/models';
import type { ResourceSnapshot } from '@/data-engine/types';

const mockLegacyAdd = jest.fn(), mockLegacyRemove = jest.fn();
jest.mock('@/hooks/useSeriesMembership', () => ({ useSeriesMembership: () => ({ addToSeries: mockLegacyAdd, removeFromAllSeries: mockLegacyRemove }) }));
jest.mock('@/hooks/useSeries', () => ({ useSeries: () => ({ series: [], loading: false }) }));
jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/church/ChurchField', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/DatePickerField', () => ({ __esModule: true, default: () => null }));
jest.mock('@/services/sermon.service', () => ({ updateSermon: jest.fn() }));
jest.mock('@/services/preachDates.service', () => ({ addPreachDate: jest.fn(), updatePreachDate: jest.fn(), deletePreachDate: jest.fn() }));

const sermon: Sermon = { id: 's', userId: 'owner', title: 'Title', verse: 'Romans 1', date: 'now', thoughts: [] };
const member = { id: 'sermon-s', type: 'sermon', refId: 's', position: 1 };
const series = (id: string, occupied = false): ResourceSnapshot => ({ resource: { collection: 'series', id }, metadata: null,
  value: { userId: 'owner', title: id, theme: id, bookOrTopic: '', status: 'draft', items: occupied ? [member] : [], sermonIds: occupied ? ['s'] : [], seriesKind: 'sermon' } });

function setup(rows = [series('Source', true), series('Target')]) {
  const harness = membershipEngineHarness([...rows, { resource: { collection: 'sermons', id: 's' }, metadata: null,
    value: { userId: 'owner', title: 'Title', verse: 'Romans 1', date: 'now', thoughts: [] } }]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const onClose = jest.fn(), onSaveRequest = jest.fn(() => persistedWrite(Promise.resolve(sermon)));
  const view = render(<DataEngineProvider><SeriesMembershipRecovery /><EditSermonModal sermon={sermon}
    onClose={onClose} onUpdate={jest.fn()} onSaveRequest={onSaveRequest} /></DataEngineProvider>);
  return { harness, onClose, onSaveRequest, view };
}
beforeEach(() => { jest.clearAllMocks(); process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'series'; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

it('pins the series field when the editor opens and captures one move only after Save', async () => {
  const { harness, onClose, view } = setup();
  const field = await screen.findByLabelText('addSermon.seriesLabel');
  expect(field).toHaveValue('Source');
  fireEvent.change(field, { target: { value: 'Target' } }); await act(async () => { await settleEngine(); });
  expect(field).toHaveValue('Target'); expect(harness.transport.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' })); await waitFor(() => expect(onClose).toHaveBeenCalled());
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(harness.read({ collection: 'series', id: 'Source' }).value?.items).toEqual([]);
  expect(harness.read({ collection: 'series', id: 'Target' }).value?.items).toEqual([expect.objectContaining({ type: 'sermon', refId: 's' })]);
  expect(mockLegacyAdd).not.toHaveBeenCalled(); expect(mockLegacyRemove).not.toHaveBeenCalled(); view.unmount();
});

it('keeps the pinned target when a remote deletion arrives, and refuses the complete move', async () => {
  const { harness, onClose, view } = setup();
  const field = await screen.findByLabelText('addSermon.seriesLabel');
  harness.replace({ resource: { collection: 'series', id: 'Target' }, value: null,
    metadata: { protocol: 1, generation: 'deleted', revision: 1, deleted: true } });
  await act(async () => { await harness.engine.refreshCollection('series'); await settleEngine(); });
  expect(screen.getByRole('option', { name: 'Target' })).toBeInTheDocument();
  fireEvent.change(field, { target: { value: 'Target' } }); await act(async () => { await settleEngine(); });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' })); await waitFor(() => expect(onClose).toHaveBeenCalled());
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.read({ collection: 'series', id: 'Source' }).value?.items).toEqual([member]);
  expect((await harness.commits.list('owner')).every(request => request.state === 'refused')).toBe(true); view.unmount();
});

it('cancels staged membership without sending and supports an empty complete series list', async () => {
  const first = setup();
  fireEvent.change(await screen.findByLabelText('addSermon.seriesLabel'), { target: { value: 'Target' } });
  await act(async () => { await settleEngine(); });
  fireEvent.click(screen.getByRole('button', { name: 'addSermon.cancel' }));
  await waitFor(() => expect(first.onClose).toHaveBeenCalled());
  expect(await first.harness.engine.listMembershipRecovery()).toEqual([]);
  expect(first.harness.transport.send).not.toHaveBeenCalled(); first.view.unmount();
  const empty = setup([]);
  expect(await screen.findByLabelText('addSermon.seriesLabel')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('addSermon.titleLabel'), { target: { value: 'New title' } });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(empty.onClose).toHaveBeenCalled());
  expect(empty.harness.transport.send).not.toHaveBeenCalled(); empty.view.unmount();
});

it('can retry sermon metadata after a failure without recapturing the already saved membership', async () => {
  const { harness, onSaveRequest, onClose, view } = setup();
  onSaveRequest.mockImplementationOnce(() => persistedWrite(Promise.reject(new Error('Metadata refused'))));
  fireEvent.change(await screen.findByLabelText('addSermon.seriesLabel'), { target: { value: 'Target' } });
  await act(async () => { await settleEngine(); });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled());
  expect(onClose).not.toHaveBeenCalled();
  const captured = (await harness.commits.list('owner')).map(request => request.id);
  expect(captured).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect((await harness.commits.list('owner')).map(request => request.id)).toEqual(captured);
  expect(mockLegacyAdd).not.toHaveBeenCalled(); view.unmount();
});
