import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import AddSermonModal from '@/components/AddSermonModal';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';

import { settleEngine } from '../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';
import '@testing-library/jest-dom';

// The REAL church field runs inside the REAL engine create stage; only I/O is replaced.
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/ui/DatePickerField', () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    <input aria-label="Planned date" value={value} onChange={event => onChange(event.target.value)} />,
}));

function setup() {
  const harness = membershipEngineHarness([]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const onClose = jest.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(
    <QueryClientProvider client={client}>
      <DataEngineProvider><AddSermonModal isOpen showTriggerButton={false} allowPlannedDate onClose={onClose} /></DataEngineProvider>
    </QueryClientProvider>
  );
  return { harness, onClose, view };
}

async function fillRequiredFields() {
  const title = await screen.findByLabelText('addSermon.titleLabel');
  await waitFor(() => expect(title).toBeEnabled());
  fireEvent.change(title, { target: { value: 'Grace that carries' } });
  fireEvent.change(screen.getByLabelText('addSermon.verseLabel'), { target: { value: 'Eph 2:8' } });
  await act(async () => { await settleEngine(); });
}

/** Typing opens the suggestion list; Escape is what a keyboard user does to close it. */
async function chooseChurch(name: string) {
  const field = screen.getByLabelText('calendar.church');
  fireEvent.change(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: 'Escape' });
  await act(async () => { await settleEngine(); });
}

async function savedSermon(harness: ReturnType<typeof membershipEngineHarness>) {
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  const [request] = await harness.commits.list('owner');
  return harness.read(request.baseline.resource).value;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons,series';
});
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

describe('AddSermonModal — the congregation a sermon is prepared for', () => {
  test('a church named WITHOUT a date is still stored, on the sermon itself', async () => {
    const { harness, onClose, view } = setup();
    await fillRequiredFields();
    await chooseChurch('Bethel');
    fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const stored = await savedSermon(harness);
    expect(stored?.church).toEqual({ id: '', name: 'Bethel', city: '' });
    // This is the whole point of the field: no date was given, and the church survives.
    expect(stored?.preachDates ?? []).toEqual([]);
    view.unmount();
  });

  test('a church named WITH a date reaches the preach date too, instead of the stand-in', async () => {
    const { harness, onClose, view } = setup();
    await fillRequiredFields();
    await chooseChurch('Bethel');
    fireEvent.change(screen.getByLabelText('Planned date'), { target: { value: '2026-10-05' } });
    await act(async () => { await settleEngine(); });
    fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const stored = await savedSermon(harness);
    expect(stored?.preachDates).toEqual([expect.objectContaining({ date: '2026-10-05', status: 'planned',
      church: { id: '', name: 'Bethel', city: '' } })]);
    // The sermon carries it as well: the two facts are stored side by side, never derived.
    expect(stored?.church).toEqual({ id: '', name: 'Bethel', city: '' });
    view.unmount();
  });

  test('a church typed AFTER the date still reaches the preach date', async () => {
    const { harness, onClose, view } = setup();
    await fillRequiredFields();
    fireEvent.change(screen.getByLabelText('Planned date'), { target: { value: '2026-10-05' } });
    await act(async () => { await settleEngine(); });
    await chooseChurch('Bethel');
    fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const stored = await savedSermon(harness);
    expect(stored?.preachDates).toEqual([expect.objectContaining({ church: { id: '', name: 'Bethel', city: '' } })]);
    view.unmount();
  });

  test('a freshly typed church survives closing the suggestion list', async () => {
    // Found live: the previous combobox rewrote the input to the SELECTED option every
    // time the list closed, so a brand-new church vanished from the field while the form
    // still held it. The field owns its text now, and this says so.
    const { view } = setup();
    const title = await screen.findByLabelText('addSermon.titleLabel');
    await waitFor(() => expect(title).toBeEnabled());
    const field = screen.getByLabelText('calendar.church');
    fireEvent.change(field, { target: { value: 'Bethel Sarny' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    await act(async () => { await settleEngine(); });
    expect(field).toHaveValue('Bethel Sarny');
    view.unmount();
  });

  test('leaving the church empty still falls back to the stand-in for the date', async () => {
    const { harness, onClose, view } = setup();
    await fillRequiredFields();
    fireEvent.change(screen.getByLabelText('Planned date'), { target: { value: '2026-10-05' } });
    await act(async () => { await settleEngine(); });
    fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const stored = await savedSermon(harness);
    expect(stored?.preachDates).toEqual([expect.objectContaining({ church: expect.objectContaining({ id: 'church-unspecified' }) })]);
    expect(stored?.church).toBeUndefined();
    view.unmount();
  });
});
