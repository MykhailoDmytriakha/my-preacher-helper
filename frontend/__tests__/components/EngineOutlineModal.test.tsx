import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';

import { EngineOutlineModal } from '@/components/sermon/EngineOutlineModal';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataDocumentProvider, DataEngineProvider, useDataDocument } from '@/data-engine/react.client';
import { settleEngine } from '../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';

import type { ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
const resource = { collection: 'sermons', id: 'sermon' };
const a = { id: 'a', text: 'Opening thought', tags: ['main'], outlinePointId: 'main', subPointId: 'sub', date: '2026-09-19' };
const b = { id: 'b', text: 'Sibling', tags: [], date: '2026-09-19' };
const structure = { introduction: [], main: ['a'], conclusion: [], ambiguous: ['b'] };
const original: ResourceSnapshot = { resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
  value: { userId: 'owner', title: 'Sermon', verse: 'Romans 1', date: '2026-09-19', thoughts: [a, b], structure, thoughtsBySection: structure,
    outline: { introduction: [{ id: 'intro', text: 'Introduction' }], main: [{ id: 'main', text: 'Main', subPoints: [{ id: 'sub', text: 'Sub', position: 1000 }] }], conclusion: [] } } };
function setup() {
  const harness = membershipEngineHarness([original]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  function Projection() {
    const document = useDataDocument(resource);
    return <output data-testid="projection">{JSON.stringify(document.data)}</output>;
  }
  function Content() {
    const [open, setOpen] = useState(true);
    return <><Projection /><button onClick={() => setOpen(true)}>Open</button>{open && <EngineOutlineModal
      sermonId="sermon" onClose={() => setOpen(false)} />}</>;
  }
  function Workspace() { return <DataEngineProvider><DataDocumentProvider resource={resource}><Content /></DataDocumentProvider></DataEngineProvider>; }
  return { harness, Workspace, view: render(<Workspace />) };
}
async function ready(value = 'Main') { await waitFor(() => expect(screen.getByDisplayValue(value)).toBeEnabled()); }
function change(before: string, after: string) { fireEvent.change(screen.getByDisplayValue(before), { target: { value: after } }); }
async function settle() { await act(async () => { await settleEngine(); }); }
async function save() {
  await settle(); fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}
async function deliver(harness: ReturnType<typeof membershipEngineHarness>) {
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
}
beforeEach(() => { jest.clearAllMocks(); process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons'; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });


it('stages every title and reminder keystroke without sending or changing the page document', async () => {
  const { harness, view } = setup(); await ready();
  change('Main', 'My main'); change('Sub', 'My sub');
  fireEvent.change(screen.getAllByLabelText('planEditor.note.label')[1], { target: { value: 'Durable reminder' } });
  await settle();
  expect(harness.transport.send).not.toHaveBeenCalled();
  expect(screen.getByTestId('projection')).not.toHaveTextContent('My main');
  await save(); await deliver(harness);
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(harness.read(resource).value?.outline).toMatchObject({ main: [{ id: 'main', text: 'My main', note: 'Durable reminder', subPoints: [{ id: 'sub', text: 'My sub' }] }] });
  expect(harness.read(resource).value?.thoughts).toEqual([a, b]); view.unmount();
});

it('recovers unfinished titles and notes after restart and Cancel never sends them', async () => {
  const { harness, view, Workspace } = setup(); await ready();
  change('Main', 'Recovered outline'); change('Sub', 'Recovered sub'); await settle();
  fireEvent.click(screen.getByRole('button', { name: 'common.close' })); view.unmount();
  const restored = render(<Workspace />); await ready();
  const choice = await screen.findByRole('option', { name: 'Sermon' });
  fireEvent.change(screen.getByLabelText('dataSync.recoveryLabel'), { target: { value: choice.getAttribute('value') } });
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' }));
  await ready('Recovered outline'); await ready('Recovered sub');
  fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await deliver(harness); expect(harness.transport.send).not.toHaveBeenCalled();
  expect(harness.read(resource).value).toEqual(original.value); restored.unmount();
});

it('keeps a new empty point in the stage and refuses Save until its title is filled', async () => {
  const { harness, view } = setup(); await ready();
  const column = within(screen.getByTestId('outline-board-column-conclusion'));
  fireEvent.click(column.getByText('structure.addPointButton')); await settle();
  expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
  fireEvent.change(column.getByLabelText('structure.editPointPlaceholder'), { target: { value: 'New conclusion' } }); await save(); await deliver(harness);
  expect(harness.read(resource).value?.outline).toMatchObject({ conclusion: [{ id: expect.any(String), text: 'New conclusion' }] }); view.unmount();
});

it('deletes a point and repairs its thoughts in the same command while preserving remote text', async () => {
  const { harness, view } = setup(); await ready();
  fireEvent.click(within(screen.getByTestId('outline-board-column-main')).getAllByLabelText('common.delete')[0]);
  fireEvent.click(screen.getByText('common.delete')); await settle();
  harness.replace({ ...original, metadata: { ...original.metadata!, revision: 2 }, value: { ...original.value!, thoughts: [{ ...a, text: 'Remote thought text' }, b] } });
  await deliver(harness); await save(); await deliver(harness);
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(harness.read(resource).value).toMatchObject({ outline: { main: [] }, thoughts: [{ ...a, text: 'Remote thought text', outlinePointId: null, subPointId: null }, b] }); view.unmount();
});

it('merges an independently added remote outline point against the opening version', async () => {
  const { harness, view } = setup(); await ready(); change('Main', 'My main'); await settle();
  const outline = original.value!.outline as Record<string, unknown>;
  harness.replace({ ...original, metadata: { ...original.metadata!, revision: 2 }, value: { ...original.value!,
    outline: { ...outline, conclusion: [{ id: 'remote', text: 'Remote conclusion' }] } as never } });
  await deliver(harness); await save(); await deliver(harness);
  expect(harness.read(resource).value?.outline).toMatchObject({ main: [{ id: 'main', text: 'My main' }], conclusion: [{ id: 'remote', text: 'Remote conclusion' }] }); view.unmount();
});

it.each(['local', 'remote'] as const)('keeps the pinned title conflict and resolves the %s choice explicitly', async choice => {
  const { harness, view } = setup(); await ready(); change('Main', 'My main'); await settle();
  const outline = original.value!.outline as Record<string, unknown>;
  harness.replace({ ...original, metadata: { ...original.metadata!, revision: 2 }, value: { ...original.value!,
    outline: { ...outline, main: [{ id: 'main', text: 'Remote main', subPoints: [{ id: 'sub', text: 'Sub', position: 1000 }] }] } as never } });
  await deliver(harness); await save(); await deliver(harness);
  expect(harness.read(resource).value?.outline).toMatchObject({ main: [{ text: 'Remote main' }] });
  fireEvent.click(screen.getByRole('button', { name: 'Open' })); await ready('My main');
  fireEvent.click(await screen.findByRole('button', { name: choice === 'local' ? 'freshness.conflictKeepMine' : 'freshness.conflictTakeTheirs' }));
  await deliver(harness); const expected = choice === 'local' ? 'My main' : 'Remote main'; await ready(expected);
  expect(harness.read(resource).value?.outline).toMatchObject({ main: [{ text: expected }] }); view.unmount();
});

it('replays the same offline operation after restart without creating another outline', async () => {
  const { harness, Workspace, view } = setup(); await ready();
  const send = jest.mocked(harness.transport.send), online = send.getMockImplementation()!;
  send.mockRejectedValue(new Error('Offline'));
  change('Main', 'Offline outline'); await save(); await settle();
  expect(screen.getByTestId('projection')).toHaveTextContent('Offline outline');
  expect(harness.read(resource).value).toEqual(original.value);
  const operationId = send.mock.calls[0][0].operationId;
  view.unmount(); send.mockImplementation(online);
  const restored = render(<Workspace />); await ready('Offline outline'); await deliver(harness);
  expect(new Set(send.mock.calls.map(([command]) => command.operationId))).toEqual(new Set([operationId]));
  expect(harness.read(resource).value?.outline).toMatchObject({ main: [{ id: 'main', text: 'Offline outline' }] });
  const count = send.mock.calls.length; await deliver(harness); expect(send.mock.calls.length).toBe(count); restored.unmount();
});

it('preserves a remote reassignment instead of silently detaching that thought', async () => {
  const { harness, view } = setup(); await ready();
  fireEvent.click(within(screen.getByTestId('outline-board-column-main')).getAllByLabelText('common.delete')[0]);
  fireEvent.click(screen.getByText('common.delete')); await settle();
  const placement = { introduction: ['a'], main: [], conclusion: [], ambiguous: ['b'] };
  harness.replace({ ...original, metadata: { ...original.metadata!, revision: 2 }, value: { ...original.value!,
    thoughts: [{ ...a, outlinePointId: 'intro', subPointId: null, tags: ['intro'] }, b], structure: placement, thoughtsBySection: placement } });
  await deliver(harness); await save(); await deliver(harness);
  expect(harness.read(resource).value?.outline).toEqual(original.value?.outline);
  expect(harness.read(resource).value?.thoughts).toEqual([{ ...a, outlinePointId: 'intro', subPointId: null, tags: ['intro'] }, b]);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(await screen.findByRole('button', { name: 'freshness.conflictTakeTheirs' })).toBeInTheDocument(); view.unmount();
});

it('adds and recovers an unsent subpoint before its title is complete', async () => {
  const { harness, Workspace, view } = setup(); await ready();
  const column = within(screen.getByTestId('outline-board-column-introduction'));
  fireEvent.click(column.getByText('structure.addSubPoint')); await settle();
  const input = column.getByLabelText('structure.subPointPlaceholder');
  fireEvent.change(input, { target: { value: 'Unfinished subpoint' } });
  fireEvent.change(column.getAllByLabelText('planEditor.note.label')[1], { target: { value: 'Unfinished reminder' } }); await settle();
  view.unmount(); const restored = render(<Workspace />); await ready();
  const choice = await screen.findByRole('option', { name: 'Sermon' });
  fireEvent.change(screen.getByLabelText('dataSync.recoveryLabel'), { target: { value: choice.getAttribute('value') } });
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' }));
  await ready('Unfinished subpoint'); await ready('Unfinished reminder');
  await save(); await deliver(harness);
  expect(harness.read(resource).value?.outline).toMatchObject({ introduction: [{ subPoints: [{ text: 'Unfinished subpoint', note: 'Unfinished reminder' }] }] }); restored.unmount();
});
