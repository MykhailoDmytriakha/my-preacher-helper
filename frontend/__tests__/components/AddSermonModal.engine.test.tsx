import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import AddSermonModal from '@/components/AddSermonModal';
import { DataCollectionStatus } from '@/data-engine/DataCollectionStatus';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { useDashboardSermons } from '@/hooks/useDashboardSermons';
import { useCalendarSermons } from '@/hooks/useCalendarSermons';
import { getSermons } from '@/services/sermon.service';
import { settleEngine } from '../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/services/firebaseAuth.service', () => ({ auth: { currentUser: { uid: 'owner' } } }));
jest.mock('@/services/sermon.service', () => ({ getSermons: jest.fn() }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/church/ChurchField', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/DatePickerField', () => ({ __esModule: true, default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
  <input aria-label="Planned date" value={value} onChange={event => onChange(event.target.value)} /> }));

beforeEach(() => { jest.clearAllMocks(); process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons,series'; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

it('creates through the real entry point, keeps submitted input in list/calendar across restart and follows remote edits/deletion', async () => {
  const harness = membershipEngineHarness([]), legacyCreate = jest.fn(), legacyCreated = jest.fn();
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const send = jest.mocked(harness.transport.send), originalSend = send.getMockImplementation()!;
  send.mockRejectedValue(new Error('offline'));
  function Workspace() {
    const list = useDashboardSermons(), calendar = useCalendarSermons(new Date('2026-10-01'), new Date('2026-10-31'));
    return <><AddSermonModal allowPlannedDate onCreateRequest={legacyCreate} onNewSermonCreated={legacyCreated} />
      <DataCollectionStatus state={list.state} />
      <div data-testid="rows">{list.sermons.map(sermon => <p key={sermon.id}>{sermon.title}</p>)}</div>
      <div data-testid="calendar">{calendar.sermons.map(sermon => <p key={sermon.id}>{sermon.title}</p>)}</div>
      <button onClick={() => { void list.refresh(); }}>Refresh</button></>;
  }
  const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
    <DataEngineProvider><Workspace /></DataEngineProvider></QueryClientProvider>);
  const view = mount();
  fireEvent.click(screen.getByRole('button', { name: 'addSermon.newSermon' }));
  const title = await screen.findByLabelText('addSermon.titleLabel'); await waitFor(() => expect(title).toBeEnabled());
  fireEvent.change(title, { target: { value: 'Queued sermon' } });
  fireEvent.change(screen.getByLabelText('addSermon.verseLabel'), { target: { value: 'Romans 1' } });
  fireEvent.change(screen.getByLabelText('Planned date'), { target: { value: '2026-10-04' } });
  await act(async () => { await settleEngine(); });
  expect(screen.getByTestId('rows')).not.toHaveTextContent('Queued sermon');
  fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('Queued sermon'));
  expect(screen.getByTestId('calendar')).toHaveTextContent('Queued sermon');
  expect(screen.getByRole('status')).toHaveTextContent('dataSync.phase.queued');
  expect(legacyCreate).not.toHaveBeenCalled(); expect(legacyCreated).not.toHaveBeenCalled(); expect(getSermons).not.toHaveBeenCalled();
  const request = (await harness.commits.list('owner'))[0], resource = request.baseline.resource;
  view.unmount(); const restored = mount();
  await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('Queued sermon'));
  send.mockImplementation(originalSend);
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  const saved = harness.read(resource);
  harness.replace({ ...saved, value: { ...saved.value!, title: 'From another device' }, metadata: { ...saved.metadata!, revision: 2 } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('From another device'));
  expect(screen.getByTestId('calendar')).toHaveTextContent('From another device');
  harness.replace({ resource, value: null, metadata: { ...saved.metadata!, revision: 3, deleted: true } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(screen.getByTestId('rows')).toBeEmptyDOMElement());
  expect(screen.getByTestId('calendar')).toBeEmptyDOMElement(); restored.unmount();
});
