import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { composePlanFromScratch } from '@/services/scratch.service';
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
jest.mock('@/services/scratch.service', () => ({ composePlanFromScratch: jest.fn() }));
jest.mock('@/providers/ConnectionProvider', () => ({ useConnection: () => ({ isMagicAvailable: true }) }));
const resource = { collection: 'sermons', id: 'sermon' };
const a = { id: 'a', text: 'Opening thought', tags: ['main'], outlinePointId: 'main', subPointId: 'sub', date: '2026-09-19' };
const b = { id: 'b', text: 'Sibling', tags: [], date: '2026-09-19' };
const structure = { introduction: [], main: ['a'], conclusion: [], ambiguous: ['b'] };
const original: ResourceSnapshot = { resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
  value: { scratch: [{ id: 'note', text: 'Source note', createdAt: '2026-09-22' }], userId: 'owner', title: 'Sermon', verse: 'Romans 1', date: '2026-09-19', thoughts: [a, b], structure, thoughtsBySection: structure,
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
      sermonId="sermon" withScratch onClose={() => setOpen(false)} />}</>;
  }
  function Workspace() { return <DataEngineProvider><DataDocumentProvider resource={resource}><Content /></DataDocumentProvider></DataEngineProvider>; }
  return { harness, Workspace, view: render(<Workspace />) };
}
async function ready(value = 'Main') { await waitFor(() => expect(screen.getByDisplayValue(value)).toBeEnabled()); }
function change(before: string, after: string) { fireEvent.change(screen.getByDisplayValue(before), { target: { value: after } }); }
async function settle() { await act(async () => { await settleEngine(); }); }
async function save() {
  await settle(); fireEvent.click(screen.getByRole('button', { name: 'scratch.board.apply' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}
async function deliver(harness: ReturnType<typeof membershipEngineHarness>) {
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
}
beforeEach(() => { jest.clearAllMocks(); process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons'; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });



const proposed = { introduction: [{ id: 'intro', text: 'Introduction' }], main: [{ id: 'main', text: 'Main',
  subPoints: [{ id: 'sub', text: 'Sub', position: 1000 }, { id: 'ai-note', text: 'Generated heading', note: 'Source note', position: 2000, scratchNoteId: 'note' }] }], conclusion: [] };
function manualPlace() {
  fireEvent.change(screen.getByRole('combobox', { name: 'scratch.card.placeInto: Source note' }), { target: { value: JSON.stringify({ pointId: 'main' }) } });
}
async function generate() {
  jest.mocked(composePlanFromScratch).mockResolvedValue({ outline: proposed, unplacedScratchNoteIds: [] });
  fireEvent.click(screen.getByRole('button', { name: 'scratch.board.compose' })); await ready('Generated heading'); await settle();
}
it('pins generator input and keeps its outline and consumed notes staged until Apply', async () => {
  const { harness, view } = setup(); await ready(); await generate();
  expect(composePlanFromScratch).toHaveBeenCalledWith('sermon', original.value!.outline, ['note'], {
    title: 'Sermon', verse: 'Romans 1', scratch: [{ id: 'note', text: 'Source note', createdAt: '2026-09-22', section: null }],
  });
  expect(harness.transport.send).not.toHaveBeenCalled();
  expect(screen.getByTestId('projection')).not.toHaveTextContent('Generated heading');
  expect(screen.getByTestId('projection')).toHaveTextContent('Source note');
  await save(); await deliver(harness);
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(harness.read(resource).value).toMatchObject({ scratch: [], outline: { main: [{ subPoints: [expect.any(Object), { id: expect.any(String), text: 'Generated heading', note: 'Source note', position: 2000 }] }] } });
  expect(JSON.stringify(harness.read(resource))).not.toContain('scratchNoteId'); view.unmount();
});
it('recovers an edited AI proposal and its consumed-note intent after restart without sending it', async () => {
  const { harness, view, Workspace } = setup(); await ready(); await generate(); change('Generated heading', 'Edited proposal'); await settle();
  view.unmount(); const restored = render(<Workspace />); await ready();
  const option = await screen.findByRole('option', { name: 'Sermon' });
  fireEvent.change(screen.getByLabelText('dataSync.recoveryLabel'), { target: { value: option.getAttribute('value') } });
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' })); await ready('Edited proposal');
  expect(harness.transport.send).not.toHaveBeenCalled();
  expect(screen.queryByRole('combobox', { name: 'scratch.card.placeInto: Source note' })).not.toBeInTheDocument();
  await save(); await deliver(harness); expect(harness.read(resource).value?.scratch).toEqual([]);
  expect(JSON.stringify(harness.read(resource))).toContain('Edited proposal'); restored.unmount();
});
it('cancels a manual placement without deleting its source note or altering the outline', async () => {
  const { harness, view } = setup(); await ready(); manualPlace(); await settle();
  expect(harness.transport.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' })); await settle();
  expect(harness.read(resource).value).toEqual(original.value); expect(harness.transport.send).not.toHaveBeenCalled(); view.unmount();
});
it.each(['changed', 'deleted'] as const)('refuses whole Apply when the source note was %s elsewhere', async kind => {
  const { harness, view } = setup(); await ready(); await generate();
  const scratch = kind === 'deleted' ? [] : [{ id: 'note', text: 'Remote source text', createdAt: '2026-09-22' }];
  harness.replace({ ...original, metadata: { ...original.metadata!, revision: 2 }, value: { ...original.value!, scratch } });
  await deliver(harness); await save(); await deliver(harness);
  expect(harness.read(resource).value?.scratch).toEqual(scratch);
  expect(harness.read(resource).value?.outline).toEqual(original.value?.outline);
  fireEvent.click(screen.getByRole('button', { name: 'Open' })); await ready('Generated heading');
  expect(await screen.findByRole('button', { name: 'freshness.conflictTakeTheirs' })).toBeInTheDocument(); view.unmount();
});
it('keeps unrelated new notes and remote outline siblings when applying a manual placement', async () => {
  const { harness, view } = setup(); await ready(); manualPlace(); await settle();
  const remoteNote = { id: 'other', text: 'New remote note', createdAt: '2026-09-22' };
  harness.replace({ ...original, metadata: { ...original.metadata!, revision: 2 }, value: { ...original.value!,
    scratch: [...original.value!.scratch as never[], remoteNote], outline: { ...original.value!.outline as object, conclusion: [{ id: 'remote', text: 'Remote conclusion' }] } } });
  await deliver(harness); await save(); await deliver(harness);
  expect(harness.read(resource).value).toMatchObject({ scratch: [remoteNote], outline: { main: [{ id: 'main', note: 'Source note' }], conclusion: [{ id: 'remote', text: 'Remote conclusion' }] } }); view.unmount();
});
it('does not stage a late AI response after closing the form', async () => {
  const { harness, view, Workspace } = setup(); await ready();
  let resolve!: (value: Awaited<ReturnType<typeof composePlanFromScratch>>) => void;
  jest.mocked(composePlanFromScratch).mockReturnValue(new Promise(done => { resolve = done; }));
  fireEvent.click(screen.getByRole('button', { name: 'scratch.board.compose' }));
  await waitFor(() => expect(composePlanFromScratch).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
  await act(async () => { resolve({ outline: proposed, unplacedScratchNoteIds: [] }); await settleEngine(); });
  view.unmount(); const restored = render(<Workspace />); await ready(); await settle();
  expect(screen.queryByDisplayValue('Generated heading')).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Sermon' })).not.toBeInTheDocument();
  expect(harness.read(resource).value).toEqual(original.value); expect(harness.transport.send).not.toHaveBeenCalled(); restored.unmount();
});
it('keeps one submitted proposal identity across offline restart', async () => {
  const { harness, Workspace, view } = setup(); await ready(); await generate();
  const send = jest.mocked(harness.transport.send), online = send.getMockImplementation()!; send.mockRejectedValue(new Error('Offline'));
  await save(); await settle(); const id = send.mock.calls[0][0].operationId; view.unmount(); send.mockImplementation(online);
  const restored = render(<Workspace />); await ready('Generated heading'); await deliver(harness);
  expect(new Set(send.mock.calls.map(([command]) => command.operationId))).toEqual(new Set([id]));
  expect(harness.read(resource).value?.scratch).toEqual([]); restored.unmount();
});

it.each(['local', 'remote'] as const)('resolves a changed source with the explicit %s choice as a complete action', async choice => {
  const { harness, view } = setup(); await ready(); await generate();
  const scratch = [{ id: 'note', text: 'Remote correction', createdAt: '2026-09-22' }];
  harness.replace({ ...original, metadata: { ...original.metadata!, revision: 2 }, value: { ...original.value!, scratch } });
  await deliver(harness); await save(); await deliver(harness);
  fireEvent.click(screen.getByRole('button', { name: 'Open' })); await ready('Generated heading');
  fireEvent.click(await screen.findByRole('button', { name: choice === 'local' ? 'freshness.conflictKeepMine' : 'freshness.conflictTakeTheirs' })); await deliver(harness);
  if (choice === 'remote') {
    expect(harness.read(resource).value).toMatchObject({ scratch, outline: original.value!.outline });
    expect(screen.queryByDisplayValue('Generated heading')).not.toBeInTheDocument();
  } else {
    expect(harness.read(resource).value?.scratch).toEqual([]);
    expect(JSON.stringify(harness.read(resource).value?.outline)).toContain('Generated heading');
  }
  view.unmount();
});
it('retains the stage when generation fails and does not send an Apply implicitly', async () => {
  const { harness, view } = setup(); await ready(); change('Main', 'Manual work before failure'); await settle();
  jest.mocked(composePlanFromScratch).mockRejectedValue(new Error('Source changed'));
  fireEvent.click(screen.getByRole('button', { name: 'scratch.board.compose' }));
  expect(await screen.findByText('Source changed')).toBeInTheDocument(); await ready('Manual work before failure');
  expect(harness.transport.send).not.toHaveBeenCalled(); view.unmount();
});
