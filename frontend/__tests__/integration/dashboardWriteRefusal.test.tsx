import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import SermonCard from '@/components/dashboard/SermonCard';
import { DataCollectionStatus } from '@/data-engine/DataCollectionStatus';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { useDashboardSermons } from '@/hooks/useDashboardSermons';
import type { ResourceSnapshot } from '@/data-engine/types';
import { QueryProvider } from '@/providers/QueryProvider';
import { getEffectiveIsPreached } from '@/utils/preachDateStatus';

import { settleEngine } from '../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';

// Sermons are engine-owned: edits and preach-date writes go through the REAL engine (only I/O is
// replaced). A refusal is the server's answer to a request that already closed its form, so the
// contract checked here is what the person keeps: the typed text in the stored request, the
// stored sermon untouched, and a verdict on the dashboard they are looking at.
jest.mock('@/data-engine/legacyQueryRecovery.client', () => ({
  ...jest.requireActual('@/data-engine/legacyQueryRecovery.client'),
  preserveLegacyQueryCache: jest.fn().mockResolvedValue(undefined),
  listLegacyQueryCopies: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/utils/queryPersister', () => ({
  createIDBPersister: () => ({
    persistClient: async () => undefined,
    restoreClient: async () => undefined,
    removeClient: async () => undefined,
  }),
}));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'user-1' } }) }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'user-1' } }) }));
jest.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: { firstDayOfWeek: 'sunday' } }) }));
jest.mock('react-day-picker/dist/style.css', () => ({}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
jest.mock('@/components/church/ChurchField', () => ({
  __esModule: true,
  default: ({ value, onChange }: { value?: { name?: string }; onChange: (church: { id: string; name: string; city: string }) => void }) =>
    <input aria-label="Church" value={value?.name ?? ''} onChange={event => onChange({ id: 'church-1', name: event.target.value, city: 'Everett' })} />,
}));
jest.mock('@/components/ui/DatePickerField', () => ({
  __esModule: true,
  default: ({ id, value, onChange }: { id?: string; value: string; onChange: (value: string) => void }) =>
    <input id={id} aria-label={id === 'preach-date-input' ? 'Date' : 'Planned date'} value={value} onChange={event => onChange(event.target.value)} />,
}));

const resource = { collection: 'sermons', id: 'sermon-refusal' };
const snapshot: ResourceSnapshot = {
  resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
  value: { userId: 'user-1', title: 'Stored sermon title', verse: 'John 3:16', date: '2026-08-11T00:00:00.000Z', thoughts: [], preachDates: [] },
};

function DashboardHarness() {
  const { sermons, state } = useDashboardSermons();
  // `/sermons` renders the Active tab by filtering preached sermons out.
  const sermon = sermons.find(candidate => !getEffectiveIsPreached(candidate));
  return (
    <>
      <DataCollectionStatus state={state} />
      {sermon ? <SermonCard sermon={sermon} onDelete={jest.fn()} onUpdate={jest.fn()} /> : <p>No active sermons</p>}
    </>
  );
}

function renderDashboard() {
  const harness = membershipEngineHarness([snapshot]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  jest.mocked(harness.transport.send).mockImplementation(async command =>
    ({ kind: 'refused', operationId: command.operationId, code: 'permission-denied' }));
  const view = render(
    <QueryProvider>
      <DataEngineProvider>
        <DashboardHarness />
      </DataEngineProvider>
    </QueryProvider>
  );
  return { harness, view };
}

const openOptions = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'optionMenu.options' }));
};
const settle = () => act(async () => { await settleEngine(); });
async function fieldReady(label: string) {
  const field = await screen.findByLabelText(label);
  await waitFor(() => expect(field).toBeEnabled());
  await settle();
  return field;
}
async function refusedRequest(harness: ReturnType<typeof renderDashboard>['harness']) {
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  const [request] = await harness.commits.list('user-1');
  return request;
}

describe('dashboard refusal recovery through the real engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons,series';
  });
  afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

  it('keeps a refused sermon edit retrievable, reports it on the dashboard and leaves the stored sermon alone', async () => {
    const { harness, view } = renderDashboard();

    await openOptions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'optionMenu.edit' }));
    const title = await fieldReady('addSermon.titleLabel');
    fireEvent.change(title, { target: { value: 'Exact refused sermon title' } });
    fireEvent.change(screen.getByLabelText('addSermon.verseLabel'), { target: { value: 'Exact refused sermon verse' } });
    fireEvent.change(screen.getByLabelText('Planned date'), { target: { value: '2026-11-20' } });
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const request = await refusedRequest(harness);
    expect(request.state).toBe('refused');
    const stored = JSON.stringify(request);
    for (const text of ['Exact refused sermon title', 'Exact refused sermon verse', '2026-11-20']) expect(stored).toContain(text);
    // The person is told on the page they are looking at.
    await waitFor(() => expect(screen.getByText('dataSync.collectionAttention')).toBeInTheDocument());
    // The stored sermon is untouched.
    expect(harness.read(resource).value).toMatchObject({ title: 'Stored sermon title', verse: 'John 3:16' });
    // The refused change stays on the row as waiting-for-attention work, never silently dropped
    // and never presented as stored: the notice above says so.
    expect(within(screen.getByTestId('sermon-card-sermon-refusal')).getByRole('heading', { level: 3 })).toHaveTextContent('Exact refused sermon title');
    view.unmount();
  });

  it('keeps refused preaching details retrievable, reports them on the dashboard and out of the stored sermon status', async () => {
    const { harness, view } = renderDashboard();

    await openOptions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'optionMenu.markAsPreached' }));
    const date = await fieldReady('Date');
    fireEvent.change(date, { target: { value: '2026-11-19' } });
    fireEvent.change(screen.getByLabelText('Church'), { target: { value: 'Refused Church' } });
    fireEvent.change(screen.getByLabelText('calendar.audience'), { target: { value: 'Exact refused audience' } });
    fireEvent.change(screen.getByLabelText('calendar.notes'), { target: { value: 'Exact refused preaching notes' } });
    await settle();
    await waitFor(() => expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const request = await refusedRequest(harness);
    expect(request.state).toBe('refused');
    const stored = JSON.stringify(request);
    for (const text of ['2026-11-19', 'Refused Church', 'Exact refused audience', 'Exact refused preaching notes']) expect(stored).toContain(text);
    await waitFor(() => expect(screen.getByText('dataSync.collectionAttention')).toBeInTheDocument());
    // The stored sermon carries no preached status and no date from the refused form.
    expect(harness.read(resource).value?.isPreached).toBeFalsy();
    expect(harness.read(resource).value?.preachDates).toEqual([]);
    view.unmount();
  });
});
