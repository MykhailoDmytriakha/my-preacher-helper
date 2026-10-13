import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import EditSermonModal from '@/components/EditSermonModal';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import '@testing-library/jest-dom';

import { settleEngine } from '../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';

import type { ResourceSnapshot } from '@/data-engine/types';
import type { Sermon } from '@/models/models';

// Sermons are engine-owned: the dialog edits the stored document through the REAL engine
// (only I/O is replaced), so every assertion below is about what ends up stored.
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'test-user-id' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/church/ChurchField', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/DatePickerField', () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    <input aria-label="Planned date" value={value} onChange={event => onChange(event.target.value)} />,
}));

const resource = { collection: 'sermons', id: 'test-sermon-id' };
const unspecified = { id: 'church-unspecified', name: 'Church not specified', city: '' };
const baseValue = { userId: 'test-user-id', title: 'Test Sermon', verse: 'John 3:16', date: '2023-05-01T12:00:00Z', thoughts: [] };
const plain: ResourceSnapshot = { resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false }, value: baseValue };
const withPlannedDate: ResourceSnapshot = { ...plain, value: { ...baseValue, preachDates: [
  { id: 'pd-existing', date: '2099-04-10', status: 'planned', church: unspecified, createdAt: '2099-01-01T00:00:00.000Z' },
] } };

function setup(snapshot: ResourceSnapshot = plain) {
  const harness = membershipEngineHarness([snapshot]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const onClose = jest.fn(), onUpdate = jest.fn();
  const listCopy = { ...snapshot.value, id: resource.id } as unknown as Sermon;
  const view = render(<DataEngineProvider><EditSermonModal sermon={listCopy} onClose={onClose} onUpdate={onUpdate} /></DataEngineProvider>);
  return { harness, onClose, onUpdate, view };
}
async function ready() {
  const title = await screen.findByLabelText('addSermon.titleLabel');
  await waitFor(() => expect(title).toBeEnabled());
  return title;
}
async function saveAndSend(harness: ReturnType<typeof setup>['harness'], onClose: jest.Mock) {
  await act(async () => { await settleEngine(); });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
}

beforeEach(() => { jest.clearAllMocks(); process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'series'; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

describe('EditSermonModal on the data engine', () => {
  test('opens on the stored values with Save disabled until something changes', async () => {
    const { view } = setup();
    const title = await ready();
    expect(screen.getByText('editSermon.editSermon')).toBeInTheDocument();
    expect(title).toHaveValue('Test Sermon');
    expect(screen.getByLabelText('addSermon.verseLabel')).toHaveValue('John 3:16');
    expect(screen.getByLabelText('Planned date')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'addSermon.cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
    view.unmount();
  });

  test('shows the stored title, not the stale copy the list handed over', async () => {
    const harness = membershipEngineHarness([plain]);
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    const stale = { ...baseValue, id: resource.id, title: 'Stale list title' } as unknown as Sermon;
    const view = render(<DataEngineProvider><EditSermonModal sermon={stale} onClose={jest.fn()} onUpdate={jest.fn()} /></DataEngineProvider>);
    expect(await ready()).toHaveValue('Test Sermon');
    view.unmount();
  });

  test('calls onClose when the cancel button is clicked, sending nothing', async () => {
    const { harness, onClose, view } = setup();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'addSermon.cancel' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(harness.transport.send).not.toHaveBeenCalled();
    view.unmount();
  });

  test('enables the save button when changes are made', async () => {
    const { view } = setup();
    const title = await ready();
    expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
    fireEvent.change(title, { target: { value: 'Updated Sermon Title' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled());
    view.unmount();
  });

  test('stores the edited title and verse', async () => {
    const { harness, onClose, view } = setup();
    const title = await ready();
    fireEvent.change(title, { target: { value: 'Updated Sermon Title' } });
    fireEvent.change(screen.getByLabelText('addSermon.verseLabel'), { target: { value: 'Romans 8:28' } });
    await saveAndSend(harness, onClose);
    expect(harness.read(resource).value).toMatchObject({ title: 'Updated Sermon Title', verse: 'Romans 8:28' });
    view.unmount();
  });

  test('creates a planned date when the person sets one and saves', async () => {
    const { harness, onClose, view } = setup();
    await ready();
    fireEvent.change(screen.getByLabelText('Planned date'), { target: { value: '2026-04-10' } });
    await saveAndSend(harness, onClose);
    expect(harness.read(resource).value?.preachDates).toEqual([
      expect.objectContaining({ date: '2026-04-10', status: 'planned', church: expect.objectContaining({ id: 'church-unspecified' }) }),
    ]);
    view.unmount();
  });

  test('clears the existing planned date and removes it on save', async () => {
    const { harness, onClose, view } = setup(withPlannedDate);
    await ready();
    expect(screen.getByLabelText('Planned date')).toHaveValue('2099-04-10');
    fireEvent.click(screen.getByText('editSermon.clearPlannedDate'));
    expect(screen.getByLabelText('Planned date')).toHaveValue('');
    await saveAndSend(harness, onClose);
    expect(harness.read(resource).value?.preachDates).toEqual([]);
    view.unmount();
  });

  test('updates the existing planned date and keeps the preach date identity and creation time', async () => {
    const { harness, onClose, view } = setup(withPlannedDate);
    await ready();
    fireEvent.change(screen.getByLabelText('Planned date'), { target: { value: '2099-04-20' } });
    await saveAndSend(harness, onClose);
    expect(harness.read(resource).value?.preachDates).toEqual([
      expect.objectContaining({ id: 'pd-existing', date: '2099-04-20', status: 'planned', createdAt: '2099-01-01T00:00:00.000Z' }),
    ]);
    view.unmount();
  });

  test('closes silently after an offline edit is locally queued, and the edit waits in the queue', async () => {
    const { harness, onClose, view } = setup();
    jest.mocked(harness.transport.send).mockRejectedValue(new Error('offline'));
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation();
    const title = await ready();
    fireEvent.change(title, { target: { value: 'Queued offline sermon title' } });
    await act(async () => { await settleEngine(); });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await act(async () => { await settleEngine(); });
    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await harness.commits.list('test-user-id')).toHaveLength(1);
    alertSpy.mockRestore();
    view.unmount();
  });

  test('keeps the exact refused sermon edit retrievable in the stored request and leaves the stored sermon untouched', async () => {
    const { harness, onClose, view } = setup();
    jest.mocked(harness.transport.send).mockImplementation(async command =>
      ({ kind: 'refused', operationId: command.operationId, code: 'permission-denied' }));
    const title = await ready();
    fireEvent.change(title, { target: { value: 'Exact refused sermon title' } });
    fireEvent.change(screen.getByLabelText('addSermon.verseLabel'), { target: { value: 'Exact refused sermon verse' } });
    await saveAndSend(harness, onClose);

    const [request] = await harness.commits.list('test-user-id');
    expect(request.state).toBe('refused');
    expect(JSON.stringify(request)).toContain('Exact refused sermon title');
    expect(JSON.stringify(request)).toContain('Exact refused sermon verse');
    expect(harness.read(resource).value?.title).toBe('Test Sermon');
    view.unmount();
  });
});
