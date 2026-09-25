import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { EnginePreachDateModal } from '@/components/calendar/EnginePreachDateModal';
import { EnginePreachDateList } from '@/components/calendar/EnginePreachDateList';
import PreachDateModal from '@/components/calendar/PreachDateModal';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { settleEngine } from '../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';
import type { PreachDateAction } from '@/components/calendar/preachDateForm';
import type { ResourceSnapshot } from '@/data-engine/types';
import type { PreachDate } from '@/models/models';
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/church/ChurchField', () => ({ __esModule: true, default: ({ value, onChange }: any) =>
  <input aria-label="Church" value={value?.name ?? ''} onChange={event => onChange({ id: 'church', name: event.target.value })} /> }));
jest.mock('@/components/ui/DatePickerField', () => ({ __esModule: true, default: ({ value, onChange }: any) =>
  <input aria-label="Date" value={value} onChange={event => onChange(event.target.value)} /> }));
const resource = { collection: 'sermons', id: 'sermon' };
const church = { id: 'church', name: 'Named church', city: 'City' };
const first = { id: 'first', date: '2099-10-03', status: 'planned', church, notes: 'Opening note', createdAt: 'now' };
const second = { ...first, id: 'second', date: '2099-10-04', notes: 'Sibling note' };
const original: ResourceSnapshot = { resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
  value: { userId: 'owner', title: 'Opening', verse: 'Romans 1', date: '2026-09-22', church, thoughts: [], isPreached: false, preachDates: [first, second] } };
function setup(action: PreachDateAction = { kind: 'edit', dateId: 'first' }, snapshot = original) {
  const harness = membershipEngineHarness([snapshot]); jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  function Workspace() {
    const [open, setOpen] = useState(true);
    return <DataEngineProvider><button onClick={() => setOpen(true)}>Open</button>{open && <EnginePreachDateModal
      sermonId="sermon" action={action} onClose={() => setOpen(false)} />}</DataEngineProvider>;
  }
  return { harness, Workspace, view: render(<Workspace />) };
}
async function settle() { await act(async () => { await settleEngine(); }); }
async function ready() { const field = await screen.findByLabelText('Date'); await waitFor(() => expect(field).toBeEnabled()); await settle(); return field; }
async function save(label = 'buttons.save') { await settle(); await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: label })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); }
async function deliver(harness: ReturnType<typeof membershipEngineHarness>) { await act(async () => { await harness.engine.retry(); await settleEngine(); }); }
function dates(harness: ReturnType<typeof membershipEngineHarness>) { return harness.read(resource).value!.preachDates as unknown as PreachDate[]; }
function editNotes(value: string) { fireEvent.change(screen.getByLabelText('calendar.notes'), { target: { value } }); }
beforeEach(() => { jest.clearAllMocks(); process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons'; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });
it('stages fields and merges another remote row in one command', async () => {
  const { harness, view } = setup(); await ready(); editNotes('Mine'); await settle();
  harness.replace({ ...original, value: { ...original.value!, preachDates: [first, { ...second, notes: 'Remote sibling' }] }, metadata: { ...original.metadata!, revision: 2 } });
  await deliver(harness); expect(screen.getByLabelText('calendar.notes')).toHaveValue('Mine'); expect(harness.transport.send).not.toHaveBeenCalled();
  await save(); await deliver(harness); expect(dates(harness)).toMatchObject([{ id: 'first', notes: 'Mine' }, { id: 'second', notes: 'Remote sibling' }]);
  expect(harness.transport.send).toHaveBeenCalledTimes(1); view.unmount();
});
it.each(['local', 'remote'] as const)('resolves same-date conflict with explicit %s choice', async choice => {
  const { harness, view } = setup(); await ready(); editNotes('Mine'); await settle();
  harness.replace({ ...original, value: { ...original.value!, preachDates: [{ ...first, notes: 'Theirs' }, second] }, metadata: { ...original.metadata!, revision: 2 } });
  await deliver(harness); await save(); await deliver(harness); expect(dates(harness)[0].notes).toBe('Theirs');
  fireEvent.click(screen.getByRole('button', { name: 'Open' })); await ready();
  fireEvent.click(await screen.findByRole('button', { name: choice === 'local' ? 'freshness.conflictKeepMine' : 'freshness.conflictTakeTheirs' }));
  await deliver(harness); expect(dates(harness)[0].notes).toBe(choice === 'local' ? 'Mine' : 'Theirs'); view.unmount();
});
it('recovers a new date and all fields without submitting or duplicating it', async () => {
  const { harness, Workspace, view } = setup({ kind: 'add', status: 'planned' }); await ready(); editNotes('Recovered note');
  fireEvent.change(screen.getByLabelText('Church'), { target: { value: 'Recovered church' } }); await settle();
  expect(harness.transport.send).not.toHaveBeenCalled(); view.unmount(); const restored = render(<Workspace />); await ready();
  const choice = await screen.findByRole('option', { name: 'Opening' });
  fireEvent.change(screen.getByLabelText('dataSync.recoveryLabel'), { target: { value: choice.getAttribute('value') } });
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' }));
  await waitFor(() => expect(screen.getByLabelText('calendar.notes')).toHaveValue('Recovered note')); expect(screen.getByLabelText('Church')).toHaveValue('Recovered church');
  editNotes('Recovered and edited'); await save(); await deliver(harness); expect(dates(harness)).toHaveLength(3);
  expect(dates(harness)[2]).toMatchObject({ notes: 'Recovered and edited', church: { name: 'Recovered church' } }); restored.unmount();
});
it('cancels a new date without writing', async () => {
  const { harness, view } = setup({ kind: 'add' }); await ready(); editNotes('Cancelled'); await settle();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' })); await settle();
  expect(harness.transport.send).not.toHaveBeenCalled(); expect(dates(harness)).toHaveLength(2); view.unmount();
});
it('marks the preferred date and flag atomically without marking other dates', async () => {
  const { harness, view } = setup({ kind: 'mark' }); await ready(); await save(); await deliver(harness);
  expect(harness.read(resource).value).toMatchObject({ isPreached: true, preachDates: [{ id: 'first', status: 'preached' }, { id: 'second', status: 'planned' }] });
  expect(harness.transport.send).toHaveBeenCalledTimes(1); view.unmount();
});
it('unmarks opening dates but preserves a newly added remote preached date', async () => {
  const snapshot = { ...original, value: { ...original.value!, isPreached: true, preachDates: [{ ...first, status: 'preached' }, { ...second, status: 'preached' }] } };
  const { harness, view } = setup({ kind: 'unmark' }, snapshot); await screen.findByText('Opening'); await settle();
  harness.replace({ ...snapshot, metadata: { ...original.metadata!, revision: 2 }, value: { ...snapshot.value, preachDates: [...snapshot.value.preachDates, { ...first, id: 'new', status: 'preached' }] } });
  await deliver(harness); await save(); await deliver(harness); expect(dates(harness).map(date => date.status)).toEqual(['planned', 'planned', 'preached']); view.unmount();
});
it('refuses deleting a date edited elsewhere without losing its notes', async () => {
  const { harness, view } = setup({ kind: 'delete', dateId: 'first' }); await screen.findByText(first.date); await settle();
  harness.replace({ ...original, metadata: { ...original.metadata!, revision: 2 }, value: { ...original.value!, preachDates: [{ ...first, notes: 'Remote' }, second] } });
  await deliver(harness); await save('common.delete'); await deliver(harness); expect(dates(harness)[0].notes).toBe('Remote');
  expect((await harness.commits.list('owner')).some(request => request.state === 'conflict')).toBe(true); view.unmount();
});
it('does not resurrect a remotely deleted date when saving an open editor', async () => {
  const { harness, view } = setup(); await ready(); editNotes('Mine'); await settle();
  harness.replace({ ...original, metadata: { ...original.metadata!, revision: 2 }, value: { ...original.value!, preachDates: [second] } });
  await deliver(harness); await save(); await deliver(harness); expect(dates(harness)).toEqual([second]);
  expect((await harness.commits.list('owner')).some(request => request.state === 'conflict')).toBe(true); view.unmount();
});
it('replays one command and one date after offline restart', async () => {
  const { harness, Workspace, view } = setup({ kind: 'add' }); await ready(); editNotes('Offline'); await settle();
  const send = jest.mocked(harness.transport.send), online = send.getMockImplementation()!; send.mockRejectedValue(new Error('Offline'));
  await save(); await settle(); const id = send.mock.calls[0][0].operationId; view.unmount(); send.mockImplementation(online);
  const restored = render(<Workspace />); await ready(); await deliver(harness);
  expect(new Set(send.mock.calls.map(([command]) => command.operationId))).toEqual(new Set([id]));
  expect(dates(harness).filter(date => date.notes === 'Offline')).toHaveLength(1); restored.unmount();
});
it('routes the calendar modal through the engine without its legacy callback', async () => {
  const harness = membershipEngineHarness([original]); jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const legacy = jest.fn(); const view = render(<DataEngineProvider><PreachDateModal sermonId="sermon" isOpen onClose={jest.fn()} onSave={legacy} /></DataEngineProvider>);
  await ready(); editNotes('Calendar'); await settle(); fireEvent.click(screen.getByRole('button', { name: 'buttons.save' })); await deliver(harness);
  expect(dates(harness)).toHaveLength(3); expect(legacy).not.toHaveBeenCalled(); view.unmount();
});

it('retains the marked date identity after its originally upcoming date has passed', async () => {
  const { preachDateTarget } = await import('@/components/calendar/preachDateForm');
  const initial = { ...original.value!, preachDates: [{ ...first, date: '2000-01-01' }, second] };
  const value = { ...initial, preachDates: [{ ...first, date: '2000-01-01', status: 'preached' }, second] };
  expect(preachDateTarget(initial as never, value as never, { kind: 'mark' }, 'new')).toBe('first');
});

it('does not mistake normalized legacy sibling statuses for the marked target', async () => {
  const { preachDateTarget, preparePreachDate } = await import('@/components/calendar/preachDateForm');
  const { status: _status, ...legacy } = second;
  const initial = { ...original.value!, preachDates: [legacy, first] };
  const value = preparePreachDate(initial, { kind: 'mark' }, first as PreachDate);
  expect(preachDateTarget(initial as never, value as never, { kind: 'mark' }, 'new')).toBe('first');
});

it('opens history deletion as an explicit engine form and retains the sibling date', async () => {
  const harness = membershipEngineHarness([original]); jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const view = render(<DataEngineProvider><EnginePreachDateList sermonId="sermon" /></DataEngineProvider>);
  const buttons = await screen.findAllByTitle('common.delete');
  fireEvent.click(buttons[0]);
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'common.delete' })).toBeEnabled());
  expect(harness.transport.send).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'common.delete' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await deliver(harness);
  expect(dates(harness)).toEqual([first]);
  expect(harness.transport.send).toHaveBeenCalledTimes(1); view.unmount();
});
