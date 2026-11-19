import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import { EnginePreachDateChips } from '@/components/calendar/EnginePreachDateChips';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import '@testing-library/jest-dom';

import { settleEngine } from '../../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../../test-utils/membershipEngineHarness';

import type { Church, PreachDate } from '@/models/models';

// Sermons are engine-owned: the chips open engine forms on the stored sermon, so every
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
  const view = render(<DataEngineProvider><EnginePreachDateChips sermonId="s1" /></DataEngineProvider>);
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
/** Opens the card of the date whose chip names this church, oldest first, and presses one of its actions. */
async function chooseOnCard(church: RegExp, index: number, action: string) {
  const chips = await screen.findAllByRole('button', { name: church });
  fireEvent.click(chips[index]);
  fireEvent.click(await screen.findByRole('button', { name: action }));
}

beforeEach(() => { jest.clearAllMocks(); process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons'; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

describe('EnginePreachDateChips on the data engine', () => {
  it('offers only «+ preach date» when there are no preach dates', async () => {
    const { view } = setup();
    const add = await addButtonReady();
    expect(add).toHaveTextContent('calendar.addFirstDateChip');
    expect(screen.queryByRole('button', { name: /calendar\.status/ })).not.toBeInTheDocument();
    view.unmount();
  });

  it('shows each date once as a chip, oldest first, with its details on the card', async () => {
    const { view } = setup([plannedOdd, preached]);
    const add = await addButtonReady();
    expect(add).toHaveTextContent('calendar.addDateChip');
    const chips = screen.getAllByRole('button', { name: /calendar\.status/ });
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveAccessibleName(expect.stringContaining('calendar.status.preached'));
    expect(chips[0]).toHaveTextContent('Grace Church');
    expect(chips[1]).toHaveAccessibleName(expect.stringContaining('calendar.status.planned'));
    // A stored date that is no date is shown as typed rather than hidden.
    expect(chips[1]).toHaveTextContent('invalid-date');
    expect(chips[1]).toHaveTextContent('Hope Church');
    fireEvent.click(chips[1]);
    expect(await screen.findByText('Youth')).toBeInTheDocument();
    expect(screen.getByText('calendar.outcomes.good')).toBeInTheDocument();
    expect(screen.getByText('Hope Church, Lviv')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'optionMenu.markAsPreached' })).toBeInTheDocument();
    view.unmount();
  });

  it('reads a legacy date without its own status from the sermon flag, and puts a date without a day last', async () => {
    const legacy = { ...planned, id: 'pd-legacy', status: undefined, church: { id: 'c3', name: 'Old Church', city: '' } } as unknown as PreachDate;
    const undated: PreachDate = { ...planned, id: 'pd-undated', date: '', church: { id: 'c4', name: 'Someday Church', city: '' } };
    const harness = membershipEngineHarness([{ resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
      value: { userId: 'owner', title: 'Opening', verse: 'Romans 1', date: '2026-01-01', thoughts: [], isPreached: true, preachDates: [undated, legacy] as never } }]);
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    const view = render(<DataEngineProvider><EnginePreachDateChips sermonId="s1" /></DataEngineProvider>);
    await addButtonReady();
    const chips = screen.getAllByRole('button', { name: /calendar\.status/ });
    expect(chips.map(chip => chip.textContent)).toEqual([expect.stringContaining('Old Church'), expect.stringContaining('Someday Church')]);
    expect(chips[0]).toHaveAccessibleName(expect.stringContaining('calendar.status.preached'));
    expect(chips[1]).toHaveTextContent('calendar.dateNotSet');
    view.unmount();
  });

  it('a preached date offers no «mark preached» on its card', async () => {
    const { view } = setup([preached]);
    await addButtonReady();
    fireEvent.click(screen.getByRole('button', { name: /Grace Church/ }));
    expect(await screen.findByRole('button', { name: 'common.edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'optionMenu.markAsPreached' })).not.toBeInTheDocument();
    view.unmount();
  });

  it('deletes the date through an explicit form and keeps its sibling', async () => {
    // Chips run oldest first, so the later planned date is the second chip.
    const { harness, view } = setup([{ ...planned, date: '2026-03-01' }, preached]);
    await addButtonReady();
    await chooseOnCard(/Grace Church/, 1, 'common.delete');
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
    await chooseOnCard(/Grace Church/, 0, 'common.delete');
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

  it('opens the edit form on the chosen date and updates that very date', async () => {
    const { harness, view } = setup([planned]);
    await addButtonReady();
    await chooseOnCard(/Grace Church/, 0, 'common.edit');
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

  it('«mark preached» on a planned date marks that very date and leaves its sibling planned', async () => {
    // Marking without a chosen date picks the latest past one (pd-later); the card must mark the earlier date it was opened on.
    const sibling: PreachDate = { ...planned, id: 'pd-later', date: '2026-04-05' };
    const { harness, view } = setup([planned, sibling]);
    await addButtonReady();
    await chooseOnCard(/Grace Church/, 0, 'optionMenu.markAsPreached');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('optionMenu.markAsPreached')).toBeInTheDocument();
    await settle();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'buttons.save' })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await deliver(harness);
    expect(stored(harness)).toEqual([
      expect.objectContaining({ id: 'pd-planned', status: 'preached' }),
      expect.objectContaining({ id: 'pd-later', status: 'planned' }),
    ]);
    expect(harness.read(resource).value!.isPreached).toBe(true);
    view.unmount();
  });
});
