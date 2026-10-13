import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import PreachDateList from '@/components/calendar/PreachDateList';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import '@testing-library/jest-dom';

import { settleEngine } from '../../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../../test-utils/membershipEngineHarness';

import type { Church, PreachDate } from '@/models/models';

// Sermons are engine-owned: the list opens engine forms on the stored sermon, so every
// write below is asserted on the stored document (only I/O is replaced).
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/church/ChurchField', () => ({
  __esModule: true,
  default: ({ value, onChange }: { value?: Church; onChange: (church: Church) => void }) =>
    <input aria-label="Church" value={value?.name ?? ''} onChange={event => onChange({ id: 'c1', name: event.target.value, city: 'City' })} />,
}));
jest.mock('@/components/ui/DatePickerField', () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    <input aria-label="Date" value={value} onChange={event => onChange(event.target.value)} />,
}));

const resource = { collection: 'sermons', id: 's1' };
const preached: PreachDate = { id: 'pd-preached', date: '2026-02-17', status: 'preached',
  church: { id: 'c1', name: 'Grace Church', city: 'Kyiv' }, createdAt: '2026-02-01T00:00:00.000Z' };
const plannedOdd = { id: 'pd-planned-invalid', date: 'invalid-date', status: 'planned', church: { id: 'c2', name: 'Hope Church', city: 'Lviv' },
  audience: 'Youth', outcome: 'good', createdAt: '2026-02-01T00:00:00.000Z' } as PreachDate;
const planned: PreachDate = { id: 'pd-planned', date: '2026-02-17', status: 'planned',
  church: { id: 'c1', name: 'Grace Church', city: '' }, createdAt: '2026-02-01T00:00:00.000Z' };

function setup(preachDates: PreachDate[] = []) {
  const harness = membershipEngineHarness([{ resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
    value: { userId: 'owner', title: 'Opening', verse: 'Romans 1', date: '2026-01-01', thoughts: [], isPreached: false, preachDates: preachDates as never } }]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const view = render(<DataEngineProvider><PreachDateList sermonId="s1" /></DataEngineProvider>);
  return { harness, view };
}
const settle = () => act(async () => { await settleEngine(); });
const deliver = (harness: ReturnType<typeof setup>['harness']) => act(async () => { await harness.engine.retry(); await settleEngine(); });
const stored = (harness: ReturnType<typeof setup>['harness']) => harness.read(resource).value!.preachDates as unknown as PreachDate[];
async function addButtonReady() {
  const add = await screen.findByRole('button', { name: 'calendar.addPreachDate' });
  await waitFor(() => expect(add).toBeEnabled());
  return add;
}

beforeEach(() => { jest.clearAllMocks(); process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons'; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

describe('PreachDateList on the data engine', () => {
  it('renders the empty state when there are no preach dates', async () => {
    const { view } = setup();
    await addButtonReady();
    expect(screen.getByText('calendar.noPreachDates')).toBeInTheDocument();
    view.unmount();
  });

  it('renders preach dates with planned/preached badges and the raw date when it cannot be parsed', async () => {
    const { view } = setup([preached, plannedOdd]);
    await addButtonReady();
    expect(await screen.findByText('calendar.status.preached')).toBeInTheDocument();
    expect(screen.getByText('calendar.status.planned')).toBeInTheDocument();
    expect(screen.getByText('invalid-date')).toBeInTheDocument();
    expect(screen.getByText('Grace Church')).toBeInTheDocument();
    expect(screen.getByText('Hope Church')).toBeInTheDocument();
    expect(screen.getByText('Youth')).toBeInTheDocument();
    expect(screen.getByText('calendar.outcomes.good')).toBeInTheDocument();
    view.unmount();
  });

  it('deletes the date through an explicit form and keeps its sibling', async () => {
    // Rows are listed newest first, so the later planned date is the first row.
    const { harness, view } = setup([{ ...planned, date: '2026-03-01' }, preached]);
    await addButtonReady();
    fireEvent.click((await screen.findAllByTitle('common.delete'))[0]);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'common.delete' })).toBeEnabled());
    expect(harness.transport.send).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await deliver(harness);
    expect(stored(harness)).toHaveLength(1);
    expect(stored(harness)[0].id).toBe('pd-preached');
    view.unmount();
  });

  it('does not delete when the delete form is cancelled', async () => {
    const { harness, view } = setup([planned]);
    await addButtonReady();
    fireEvent.click(await screen.findByTitle('common.delete'));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'common.delete' })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole('button', { name: 'buttons.cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await deliver(harness);
    expect(harness.transport.send).not.toHaveBeenCalled();
    expect(stored(harness)).toEqual([planned]);
    view.unmount();
  });

  it('opens the add form and stores a new planned date on save', async () => {
    const { harness, view } = setup();
    fireEvent.click(await addButtonReady());
    const date = await screen.findByLabelText('Date');
    await waitFor(() => expect(date).toBeEnabled());
    await settle();
    fireEvent.change(date, { target: { value: '2026-03-01' } });
    fireEvent.change(screen.getByLabelText('Church'), { target: { value: 'Saved Church' } });
    await settle();
    await waitFor(() => expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await deliver(harness);
    expect(stored(harness)).toEqual([expect.objectContaining({ date: '2026-03-01', status: 'planned', church: expect.objectContaining({ name: 'Saved Church' }) })]);
    view.unmount();
  });

  it('opens the edit form on the chosen row and updates that very date', async () => {
    const { harness, view } = setup([planned]);
    await addButtonReady();
    fireEvent.click(await screen.findByTitle('common.edit'));
    const date = await screen.findByLabelText('Date');
    await waitFor(() => expect(date).toBeEnabled());
    await settle();
    expect(date).toHaveValue('2026-02-17');
    fireEvent.change(date, { target: { value: '2026-03-01' } });
    await settle();
    await waitFor(() => expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await deliver(harness);
    expect(stored(harness)).toEqual([expect.objectContaining({ id: 'pd-planned', date: '2026-03-01', status: 'planned' })]);
    view.unmount();
  });
});
