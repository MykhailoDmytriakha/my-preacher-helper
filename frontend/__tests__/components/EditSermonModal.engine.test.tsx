import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import EditSermonModal from '@/components/EditSermonModal';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { settleEngine } from '../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';
import type { Sermon } from '@/models/models';
import type { ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/church/ChurchField', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/DatePickerField', () => ({ __esModule: true, default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
  <input aria-label="Planned date" value={value} onChange={event => onChange(event.target.value)} /> }));
const resource = { collection: 'sermons', id: 'sermon' };
const church = { id: 'church', name: 'Named church' };
const original: ResourceSnapshot = { resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
  value: { userId: 'owner', title: 'Opening', verse: 'Romans 1', date: '2026-09-19', thoughts: [], preachDates: [
    { id: 'first', date: '2099-10-03', status: 'planned', church, createdAt: 'now' },
    { id: 'second', date: '2099-10-04', status: 'planned', church, createdAt: 'now' },
  ] } };
function setup(snapshot = original) {
  const harness = membershipEngineHarness([snapshot]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const legacySave = jest.fn(), legacyUpdate = jest.fn();
  function Workspace() {
    const [open, setOpen] = useState(true);
    return <DataEngineProvider><button onClick={() => setOpen(true)}>Open</button>{open && <EditSermonModal
      sermon={{ ...snapshot.value, id: 'sermon', title: 'Stale list title' } as unknown as Sermon}
      onClose={() => setOpen(false)} onSaveRequest={legacySave} onUpdate={legacyUpdate} />}</DataEngineProvider>;
  }
  return { harness, Workspace, legacySave, legacyUpdate, view: render(<Workspace />) };
}
async function ready() {
  const title = await screen.findByLabelText('addSermon.titleLabel'); await waitFor(() => expect(title).toBeEnabled()); return title;
}
async function save() {
  await act(async () => { await settleEngine(); });
  fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}
beforeEach(() => { jest.clearAllMocks(); process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons'; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

it('pins the actual document, keeps the selected date identity across reorder and saves metadata/date in one command', async () => {
  const { harness, view, legacySave, legacyUpdate } = setup(); const title = await ready();
  expect(title).toHaveValue('Opening');
  fireEvent.change(title, { target: { value: 'Edited' } });
  fireEvent.change(screen.getByLabelText('Planned date'), { target: { value: '2099-10-08' } });
  await act(async () => { await settleEngine(); });
  fireEvent.change(screen.getByLabelText('Planned date'), { target: { value: '2099-10-09' } });
  expect(harness.transport.send).not.toHaveBeenCalled(); await save();
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(harness.read(resource).value).toMatchObject({ title: 'Edited', preachDates: [
    { id: 'first', date: '2099-10-09' }, { id: 'second', date: '2099-10-04' },
  ] });
  expect(legacySave).not.toHaveBeenCalled(); expect(legacyUpdate).not.toHaveBeenCalled(); view.unmount();
});

it('recovers an unsent added date after restart and edits the same embedded identity', async () => {
  const { harness, view, Workspace } = setup({ ...original, value: { ...original.value!, preachDates: [] } }); await ready();
  fireEvent.change(screen.getByLabelText('Planned date'), { target: { value: '2099-10-03' } });
  await act(async () => { await settleEngine(); });
  fireEvent.click(screen.getByRole('button', { name: 'common.close' })); view.unmount();
  const restored = render(<Workspace />); await ready();
  const choice = await screen.findByRole('option', { name: 'Opening' });
  fireEvent.change(screen.getByLabelText('dataSync.recoveryLabel'), { target: { value: choice.getAttribute('value') } });
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' }));
  await waitFor(() => expect(screen.getByLabelText('Planned date')).toHaveValue('2099-10-03'));
  fireEvent.change(screen.getByLabelText('Planned date'), { target: { value: '2099-10-05' } });
  expect(harness.transport.send).not.toHaveBeenCalled(); await save();
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.read(resource).value?.preachDates).toEqual([expect.objectContaining({ date: '2099-10-05' })]); restored.unmount();
});

it.each(['local', 'remote'] as const)('keeps the opening ancestor and resolves %s after reopening the refused form', async choice => {
  const { harness, view } = setup(); const title = await ready();
  fireEvent.change(title, { target: { value: 'My title' } });
  harness.replace({ ...original, value: { ...original.value!, title: 'Their title' }, metadata: { ...original.metadata!, revision: 2 } });
  await act(async () => { await harness.engine.retry(resource); await settleEngine(); });
  expect(title).toHaveValue('My title'); await save();
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.read(resource).value?.title).toBe('Their title');
  expect((await harness.commits.list('owner')).some(request => request.state === 'conflict')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Open' })); await ready();
  await screen.findByText('freshness.conflictDescription');
  fireEvent.click(screen.getByRole('button', { name: choice === 'local' ? 'freshness.conflictKeepMine' : 'freshness.conflictTakeTheirs' }));
  const expected = choice === 'local' ? 'My title' : 'Their title';
  await waitFor(() => expect(screen.queryByText('freshness.conflictDescription')).not.toBeInTheDocument());
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  await waitFor(() => expect(screen.getByLabelText('addSermon.titleLabel')).toHaveValue(expected));
  expect(harness.read(resource).value?.title).toBe(expected);
  expect(screen.getByLabelText('addSermon.titleLabel')).toBeEnabled(); view.unmount();
});


it('cancels typed metadata and planned dates without submitting or offering cancelled input on reopening', async () => {
  const { harness, view } = setup(); const title = await ready();
  fireEvent.change(title, { target: { value: 'Cancelled title' } });
  fireEvent.change(screen.getByLabelText('Planned date'), { target: { value: '2099-11-01' } });
  await act(async () => { await settleEngine(); });
  fireEvent.click(screen.getByRole('button', { name: 'addSermon.cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Open' })); await ready();
  expect(screen.getByLabelText('addSermon.titleLabel')).toHaveValue('Opening');
  expect(screen.getByLabelText('Planned date')).toHaveValue('2099-10-03');
  expect(screen.queryByRole('button', { name: 'dataSync.recover' })).not.toBeInTheDocument();
  expect(await harness.commits.list('owner')).toEqual([]); expect(harness.transport.send).not.toHaveBeenCalled(); view.unmount();
});
