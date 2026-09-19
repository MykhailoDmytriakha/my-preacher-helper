import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { useTextDictation } from '@/hooks/useTextDictation';

import { EngineThoughtModal } from '@/components/thought/EngineThoughtModal';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataDocumentProvider, DataEngineProvider, useDataDocument } from '@/data-engine/react.client';
import { settleEngine } from '../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';

import type { ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/providers/ConnectionProvider', () => ({ useConnection: () => ({ isMagicAvailable: false }) }));
jest.mock('@/hooks/useTextDictation', () => ({ useTextDictation: jest.fn(() => ({})) }));
jest.mock('@/components/thought/ThoughtTextHeader', () => ({ ThoughtTextHeader: () => null }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({ RichMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
  <textarea aria-label="Thought" value={value} onChange={event => onChange(event.target.value)} /> }));
const resource = { collection: 'sermons', id: 'sermon' };
const a = { id: 'a', text: 'Opening thought', tags: [], date: '2026-09-19' };
const b = { id: 'b', text: 'Sibling', tags: [], date: '2026-09-19' };
const structure = { introduction: [], main: [], conclusion: [], ambiguous: ['a', 'b'] };
const original: ResourceSnapshot = { resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
  value: { userId: 'owner', title: 'Sermon', verse: 'Romans 1', date: '2026-09-19', thoughts: [a, b], structure, thoughtsBySection: structure,
    outline: { introduction: [{ id: 'intro', text: 'Introduction' }], main: [{ id: 'main', text: 'Main' }], conclusion: [] } } };
function setup(thoughtId?: string) {
  const harness = membershipEngineHarness([original]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  function Projection() {
    const document = useDataDocument(resource);
    return <output data-testid="projection">{JSON.stringify(document.data?.thoughts)}</output>;
  }
  function Content() {
    const [open, setOpen] = useState(true);
    return <><Projection /><button onClick={() => setOpen(true)}>Open</button>{open && <EngineThoughtModal
      sermonId="sermon" thoughtId={thoughtId} allowedTags={[{ name: 'custom', color: '#000000' }]} onClose={() => setOpen(false)} />}</>;
  }
  function Workspace() { return <DataEngineProvider><DataDocumentProvider resource={resource}><Content /></DataDocumentProvider></DataEngineProvider>; }
  return { harness, Workspace, view: render(<Workspace />) };
}
async function ready(value: string) { await waitFor(() => expect(screen.getByLabelText('Thought')).toHaveValue(value)); }
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

it('keeps typing outside the page document and captures text plus placement in one command', async () => {
  const { harness, view } = setup('a'); await ready(a.text);
  fireEvent.change(screen.getByLabelText('Thought'), { target: { value: 'My edited thought' } });
  fireEvent.click(screen.getByLabelText('editThought.outlinePointLabel'));
  fireEvent.click(screen.getByRole('button', { name: 'Main' })); await settle();
  expect(screen.getByTestId('projection')).toHaveTextContent('Opening thought');
  expect(screen.getByTestId('projection')).not.toHaveTextContent('My edited thought');
  expect(harness.transport.send).not.toHaveBeenCalled(); await save(); await deliver(harness);
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(harness.read(resource).value).toMatchObject({ thoughts: [{ ...a, text: 'My edited thought', outlinePointId: 'main', subPointId: null }, b],
    structure: { main: ['a'], ambiguous: ['b'] }, thoughtsBySection: { main: ['a'], ambiguous: ['b'] } }); view.unmount();
});

it('recovers unsent creation after restart with its original identity and Cancel never sends it', async () => {
  const { harness, Workspace, view } = setup(); await ready('');
  fireEvent.change(screen.getByLabelText('Thought'), { target: { value: 'New durable thought' } }); await settle();
  expect(screen.getByTestId('projection')).not.toHaveTextContent('New durable thought');
  fireEvent.click(screen.getByRole('button', { name: 'common.close' })); view.unmount();
  const restored = render(<Workspace />); await ready('');
  const choice = await screen.findByRole('option', { name: 'Sermon' });
  fireEvent.change(screen.getByLabelText('dataSync.recoveryLabel'), { target: { value: choice.getAttribute('value') } });
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' })); await ready('New durable thought');
  fireEvent.change(screen.getByLabelText('Thought'), { target: { value: 'Recovered and edited' } }); await save(); await deliver(harness);
  const thoughts = harness.read(resource).value?.thoughts as unknown as typeof a[];
  expect(thoughts).toHaveLength(3); expect(thoughts.filter(item => !['a', 'b'].includes(item.id))).toEqual([expect.objectContaining({ text: 'Recovered and edited' })]);
  expect(harness.read(resource).value?.structure).toEqual(harness.read(resource).value?.thoughtsBySection);
  fireEvent.click(screen.getByRole('button', { name: 'Open' })); await ready('');
  fireEvent.change(screen.getByLabelText('Thought'), { target: { value: 'Cancel this' } }); await settle();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await deliver(harness); expect(harness.transport.send).toHaveBeenCalledTimes(1); restored.unmount();
});

it('merges a remote sibling edit without applying it to the open form ancestor', async () => {
  const { harness, view } = setup('a'); await ready(a.text);
  fireEvent.change(screen.getByLabelText('Thought'), { target: { value: 'My text' } }); await settle();
  harness.replace({ ...original, metadata: { ...original.metadata!, revision: 2 }, value: { ...original.value!, thoughts: [a, { ...b, text: 'Remote sibling' }] } });
  await deliver(harness); await ready('My text'); await save(); await deliver(harness);
  expect(harness.read(resource).value?.thoughts).toEqual([{ ...a, text: 'My text' }, { ...b, text: 'Remote sibling' }]); view.unmount();
});

it.each(['local', 'remote'] as const)('retains the opening thought ancestor and supports the %s conflict choice after reopen', async choice => {
  const { harness, view } = setup('a'); await ready(a.text);
  fireEvent.change(screen.getByLabelText('Thought'), { target: { value: 'My text' } }); await settle();
  harness.replace({ ...original, metadata: { ...original.metadata!, revision: 2 }, value: { ...original.value!, thoughts: [{ ...a, text: 'Remote text' }, b] } });
  await deliver(harness); await save(); await deliver(harness);
  expect(harness.read(resource).value?.thoughts).toEqual([{ ...a, text: 'Remote text' }, b]);
  fireEvent.click(screen.getByRole('button', { name: 'Open' })); await ready('My text');
  fireEvent.click(await screen.findByRole('button', { name: choice === 'local' ? 'freshness.conflictKeepMine' : 'freshness.conflictTakeTheirs' }));
  await deliver(harness); const text = choice === 'local' ? 'My text' : 'Remote text';
  await ready(text); expect(harness.read(resource).value?.thoughts).toEqual([{ ...a, text }, b]); view.unmount();
});

it('keeps an offline saved creation visible across restart and retries the same command once', async () => {
  const { harness, Workspace, view } = setup(); await ready('');
  const send = jest.mocked(harness.transport.send), online = send.getMockImplementation()!;
  send.mockRejectedValue(new Error('Offline'));
  fireEvent.change(screen.getByLabelText('Thought'), { target: { value: 'Offline creation' } }); await save(); await settle();
  const submitted = JSON.parse(screen.getByTestId('projection').textContent!) as typeof a[];
  const created = submitted.find(item => item.text === 'Offline creation')!;
  expect(created.id).toBeTruthy(); expect(harness.read(resource).value?.thoughts).toEqual([a, b]);
  const commandId = send.mock.calls[0][0].operationId;
  view.unmount(); send.mockImplementation(online);
  const restored = render(<Workspace />); await ready(''); await deliver(harness);
  expect(harness.read(resource).value?.thoughts).toEqual([created, a, b]);
  expect(new Set(send.mock.calls.map(([command]) => command.operationId))).toEqual(new Set([commandId]));
  await deliver(harness); expect(harness.read(resource).value?.thoughts).toHaveLength(3); restored.unmount();
});

it('keeps the staged text when another device deletes the thought and accepts the deletion explicitly', async () => {
  const { harness, view } = setup('a'); await ready(a.text);
  fireEvent.change(screen.getByLabelText('Thought'), { target: { value: 'My retained text' } }); await settle();
  const remaining = { ...structure, ambiguous: ['b'] };
  harness.replace({ ...original, metadata: { ...original.metadata!, revision: 2 }, value: { ...original.value!, thoughts: [b], structure: remaining, thoughtsBySection: remaining } });
  await deliver(harness); await ready('My retained text'); await save(); await deliver(harness);
  expect(harness.read(resource).value?.thoughts).toEqual([b]);
  fireEvent.click(screen.getByRole('button', { name: 'Open' })); await ready('My retained text');
  fireEvent.click(await screen.findByRole('button', { name: 'freshness.conflictTakeTheirs' })); await settle();
  expect(screen.queryByLabelText('Thought')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
  expect(harness.read(resource).value?.thoughts).toEqual([b]); view.unmount();
});

it('refuses a placement when its outline destination was deleted after the form opened', async () => {
  const { harness, view } = setup('a'); await ready(a.text);
  fireEvent.change(screen.getByLabelText('Thought'), { target: { value: 'Retained placement text' } });
  fireEvent.click(screen.getByLabelText('editThought.outlinePointLabel'));
  fireEvent.click(screen.getByRole('button', { name: 'Main' })); await settle();
  harness.replace({ ...original, metadata: { ...original.metadata!, revision: 2 }, value: { ...original.value!,
    outline: { introduction: [{ id: 'intro', text: 'Introduction' }], main: [], conclusion: [] } } });
  await deliver(harness); await save(); await deliver(harness);
  expect(harness.read(resource).value?.thoughts).toEqual([a, b]);
  expect((await harness.commits.list('owner')).some(request => ['conflict', 'refused'].includes(request.state))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Open' })); await ready('Retained placement text');
  fireEvent.click(screen.getByLabelText('editThought.outlinePointLabel'));
  fireEvent.click(screen.getByRole('button', { name: 'Introduction' })); await settle();
  expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
  fireEvent.click(await screen.findByRole('button', { name: 'dataSync.keepLocal' })); await deliver(harness);
  expect(harness.read(resource).value?.thoughts).toEqual([{ ...a, text: 'Retained placement text', outlinePointId: 'intro', subPointId: null }, b]);
  view.unmount();
});

it('stages consecutive dictated fragments and tag changes without sending before Save', async () => {
  const { harness, view } = setup(); await ready('');
  const callbacks = jest.mocked(useTextDictation).mock.calls.at(-1)![0];
  await act(async () => { callbacks.onText('First'); callbacks.onText('Second'); await settleEngine(); });
  await ready('First\n\nSecond');
  fireEvent.click(screen.getByRole('button', { name: 'thought.addTagAria' })); await settle();
  expect(screen.getByRole('button', { name: 'thought.removeTagAria' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'thought.removeTagAria' })); await settle();
  expect(screen.queryByRole('button', { name: 'thought.removeTagAria' })).not.toBeInTheDocument();
  expect(harness.transport.send).not.toHaveBeenCalled(); await save(); await deliver(harness);
  expect(harness.read(resource).value?.thoughts).toEqual([expect.objectContaining({ text: 'First\n\nSecond', tags: [] }), a, b]);
  view.unmount();
});

it('reopens a refused creation with its own text and repairs that same thought identity', async () => {
  const { harness, view } = setup(); await ready('');
  fireEvent.change(screen.getByLabelText('Thought'), { target: { value: 'New misplaced thought' } });
  fireEvent.click(screen.getByLabelText('editThought.outlinePointLabel'));
  fireEvent.click(screen.getByRole('button', { name: 'Main' })); await settle();
  harness.replace({ ...original, metadata: { ...original.metadata!, revision: 2 }, value: { ...original.value!,
    outline: { introduction: [{ id: 'intro', text: 'Introduction' }], main: [], conclusion: [] } } });
  await deliver(harness); await save(); await deliver(harness);
  const projected = JSON.parse(screen.getByTestId('projection').textContent!) as typeof a[];
  const createdId = projected.find(item => item.text === 'New misplaced thought')!.id;
  fireEvent.click(screen.getByRole('button', { name: 'Open' })); await ready('');
  const choice = await screen.findByRole('option', { name: 'Sermon' });
  fireEvent.change(screen.getByLabelText('dataSync.recoveryLabel'), { target: { value: choice.getAttribute('value') } });
  expect(screen.getByText('New misplaced thought')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' })); await ready('New misplaced thought');
  fireEvent.click(screen.getByLabelText('editThought.outlinePointLabel'));
  fireEvent.click(screen.getByRole('button', { name: 'Introduction' })); await settle();
  fireEvent.click(await screen.findByRole('button', { name: 'dataSync.keepLocal' })); await deliver(harness);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(harness.read(resource).value?.thoughts).toEqual([expect.objectContaining({ id: createdId, text: 'New misplaced thought', outlinePointId: 'intro' }), a, b]);
  fireEvent.click(screen.getByRole('button', { name: 'Open' })); await ready(''); view.unmount();
});

it('creates a fresh second thought while the first saved creation is still offline', async () => {
  const { harness, view } = setup(); await ready('');
  const send = jest.mocked(harness.transport.send), online = send.getMockImplementation()!;
  send.mockRejectedValue(new Error('Offline'));
  fireEvent.change(screen.getByLabelText('Thought'), { target: { value: 'First offline thought' } }); await save(); await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Open' })); await ready('');
  fireEvent.change(screen.getByLabelText('Thought'), { target: { value: 'Second offline thought' } }); await save(); await settle();
  expect(harness.read(resource).value?.thoughts).toEqual([a, b]);
  const pending = JSON.parse(screen.getByTestId('projection').textContent!) as typeof a[];
  expect(pending.map(item => item.text)).toEqual(['Second offline thought', 'First offline thought', a.text, b.text]);
  expect(new Set(pending.map(item => item.id)).size).toBe(4);
  send.mockImplementation(online); await deliver(harness);
  expect(harness.read(resource).value?.thoughts).toEqual(pending); view.unmount();
});
