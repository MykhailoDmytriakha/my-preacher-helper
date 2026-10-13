import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { EnginePreachDateModal } from '@/components/calendar/EnginePreachDateModal';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import '@testing-library/jest-dom';

import { settleEngine } from '../../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../../test-utils/membershipEngineHarness';

import type { ResourceSnapshot } from '@/data-engine/types';
import type { Church, PreachDate } from '@/models/models';
import type { PreachDateAction } from '@/components/calendar/preachDateForm';

// Sermons are engine-owned: the modal edits the stored sermon through the REAL engine
// (only I/O is replaced), so every assertion below is about what ends up stored.
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

const resource = { collection: 'sermons', id: 'sermon' };
const SERMON_CHURCH = { id: 'c-grace', name: 'Grace Chapel', city: 'Fresno' };
const STAND_IN = { id: 'church-unspecified', name: 'Church not specified', city: '' };
const snapshot = (value: Record<string, unknown> = {}): ResourceSnapshot => ({ resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
  value: { userId: 'owner', title: 'Opening', verse: 'Romans 1', date: '2026-09-22', thoughts: [], isPreached: false, preachDates: [], ...value } });
const existing: PreachDate = { id: 'd1', date: '2023-10-27', status: 'planned', church: { id: 'c1', name: 'Zion', city: 'Kyiv' },
  audience: 'Youth', notes: 'Good', createdAt: '2023-10-01T00:00:00.000Z' };

function setup(props: { value?: Record<string, unknown>; action?: PreachDateAction; initialData?: PreachDate; defaultStatus?: 'planned' | 'preached' } = {}) {
  const harness = membershipEngineHarness([snapshot(props.value)]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const onClose = jest.fn();
  const action: PreachDateAction = props.action ?? { kind: props.initialData?.id ? 'edit' : 'add', dateId: props.initialData?.id, status: props.defaultStatus };
  const view = render(<DataEngineProvider>
    <EnginePreachDateModal sermonId="sermon" action={action} onClose={onClose} />
  </DataEngineProvider>);
  return { harness, onClose, view };
}
const settle = () => act(async () => { await settleEngine(); });
async function ready() {
  const field = await screen.findByLabelText('Date');
  await waitFor(() => expect(field).toBeEnabled());
  await settle();
  return field;
}
const dates = (harness: ReturnType<typeof setup>['harness']) => harness.read(resource).value!.preachDates as unknown as PreachDate[];
const deliver = (harness: ReturnType<typeof setup>['harness']) => act(async () => { await harness.engine.retry(); await settleEngine(); });

beforeEach(() => { jest.clearAllMocks(); process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons'; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

describe('EnginePreachDateModal on the data engine', () => {
  describe('the congregation the sermon is already prepared for', () => {
    it('offers it when the sermon has no date yet, instead of asking for it again', async () => {
      // Marking a sermon preached opens this form with no date to read from, so the
      // church field started empty even though the sermon itself names one.
      const { view } = setup({ value: { church: SERMON_CHURCH }, defaultStatus: 'preached' });
      await ready();
      expect(screen.getByLabelText('Church')).toHaveValue('Grace Chapel');
      await waitFor(() => expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled());
      view.unmount();
    });

    it('offers it when the existing date still holds the stand-in', async () => {
      const { view } = setup({
        value: { church: SERMON_CHURCH, preachDates: [{ id: 'pd1', date: '2026-09-20', status: 'planned', church: STAND_IN, createdAt: 'now' }] },
        initialData: { id: 'pd1', date: '2026-09-20', status: 'planned', church: STAND_IN, createdAt: 'now' } as PreachDate,
      });
      await ready();
      await waitFor(() => expect(screen.getByLabelText('Church')).toHaveValue('Grace Chapel'));
      view.unmount();
    });

    it('NEVER overrides a congregation the date itself names', async () => {
      const hope = { id: 'c-hope', name: 'Hope Church', city: '' };
      const { view } = setup({
        value: { church: SERMON_CHURCH, preachDates: [{ id: 'pd1', date: '2026-09-20', status: 'planned', church: hope, createdAt: 'now' }] },
        initialData: { id: 'pd1', date: '2026-09-20', status: 'planned', church: hope, createdAt: 'now' } as PreachDate,
      });
      await ready();
      expect(screen.getByLabelText('Church')).toHaveValue('Hope Church');
      view.unmount();
    });
  });

  it('renders with the "Add" title and a date field when no initialData is provided', async () => {
    const { view } = setup();
    await ready();
    expect(screen.getByText('calendar.addPreachDate')).toBeInTheDocument();
    view.unmount();
  });

  it('renders with the "Edit" title and the stored values when initialData is provided', async () => {
    const { view } = setup({ value: { preachDates: [existing] }, initialData: existing });
    await ready();
    expect(screen.getByText('calendar.editPreachDate')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2023-10-27')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Youth')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Good')).toBeInTheDocument();
    view.unmount();
  });

  it('stores the new preach date with the typed church, audience and notes, and closes', async () => {
    const { harness, onClose, view } = setup();
    await ready();
    fireEvent.change(screen.getByLabelText('Church'), { target: { value: 'New Church' } });
    fireEvent.change(screen.getByLabelText('calendar.audience'), { target: { value: 'Adults' } });
    await settle();
    await waitFor(() => expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await deliver(harness);
    expect(dates(harness)).toEqual([expect.objectContaining({ church: { id: 'c1', name: 'New Church', city: 'City' }, audience: 'Adults' })]);
    view.unmount();
  });

  it('calls onClose when the cancel button is clicked and writes nothing', async () => {
    const { harness, onClose, view } = setup();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(harness.transport.send).not.toHaveBeenCalled();
    view.unmount();
  });

  it('disables the save button while the church name is empty', async () => {
    const { view } = setup();
    await ready();
    expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Church'), { target: { value: 'Some Church' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled());
    view.unmount();
  });

  it('keeps the exact preaching notes in the stored request when the server refuses them', async () => {
    const { harness, onClose, view } = setup();
    jest.mocked(harness.transport.send).mockImplementation(async command =>
      ({ kind: 'refused', operationId: command.operationId, code: 'permission-denied' }));
    await ready();
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-19' } });
    fireEvent.change(screen.getByLabelText('Church'), { target: { value: 'Refused Church' } });
    fireEvent.change(screen.getByLabelText('calendar.audience'), { target: { value: 'Exact refused audience' } });
    fireEvent.change(screen.getByLabelText('calendar.notes'), { target: { value: 'Exact refused preaching notes' } });
    await settle();
    await waitFor(() => expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await deliver(harness);

    const [request] = await harness.commits.list('owner');
    expect(request.state).toBe('refused');
    const stored = JSON.stringify(request);
    for (const text of ['2026-11-19', 'Refused Church', 'Exact refused audience', 'Exact refused preaching notes']) expect(stored).toContain(text);
    expect(dates(harness)).toEqual([]);
    view.unmount();
  });

  it('closes silently after an offline preach-date write is locally accepted', async () => {
    const { harness, onClose, view } = setup();
    jest.mocked(harness.transport.send).mockRejectedValue(new Error('offline'));
    await ready();
    fireEvent.change(screen.getByLabelText('Church'), { target: { value: 'Offline Church' } });
    await settle();
    await waitFor(() => expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await settle();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await harness.commits.list('owner')).toHaveLength(1);
    view.unmount();
  });
});
