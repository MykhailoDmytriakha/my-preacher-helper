import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { EngineStructureWriterProvider } from '@/(pages)/(private)/sermons/[id]/components/EngineStructureWriterProvider';
import StructurePage from '@/(pages)/(private)/sermons/[id]/structure/page';
import PlanEditorModal from '@/components/plan-editor/PlanEditorModal';
import SermonOutline from '@/components/sermon/SermonOutline';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { EditorController } from '@/data-engine/controller';
import { applyCommand } from '@/data-engine/protocol';
import { DataDocumentProvider, DataEngineProvider, useDataDocument } from '@/data-engine/react.client';
import { UNANSWERED_SAID_AFTER_ATTEMPTS } from '@/data-engine/unanswered';
import { sortItemsWithAI } from '@/services/sortAI.service';
import { documentEngineHarness } from '@test-utils/documentEngineHarness';
import { TestProviders } from '@test-utils/test-providers';

import type { Sermon } from '@/models/models';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' }, loading: false }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/hooks/useRouteId', () => ({ useRouteId: () => 'sermon' }));
jest.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => require('@test-utils/aiUsage').aiUsageStub() }));
jest.mock('@/hooks/useTextDictation', () => ({ useTextDictation: () => ({
  captureAcceptance: () => async () => undefined, accept: async () => undefined, discard: async () => undefined,
}) }));
jest.mock('@/components/thought/ThoughtTextHeader', () => ({ ThoughtTextHeader: () => null }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({
  RichMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="Thought text" value={value} onChange={event => onChange(event.target.value)} />
  ),
}));
let mockFocus = false;
jest.mock('@/services/sortAI.service');
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockFocus ? 'mode=focus&section=main' : ''),
  usePathname: () => '/sermons/sermon/structure',
}));
jest.mock('@/components/ExportButtons', () => ({ __esModule: true, default: () => null }));

const original = 'Stored thought words';
const draft = 'Words from the refused save';
const thought = { id: 'thought', text: original, tags: ['main'], date: '2026-11-07' };
const structure = { introduction: [], main: [thought.id], conclusion: [], ambiguous: [] };
const resource = { collection: 'sermons', id: 'sermon' };

it.each(['edit', 'create'])('keeps the saved board after discarding a refused thought %s', async mode => {
  const harness = documentEngineHarness({
    resource,
    metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false },
    value: { userId: 'owner', title: 'Test sermon', verse: '', date: '2026-11-07', thoughts: [thought], structure,
      outline: { introduction: [], main: [{ id: 'point', text: 'Main point' }], conclusion: [] } },
  });
  jest.mocked(createBrowserDataEngine).mockImplementation(() => harness.createBrowser({ withCollections: true }));
  render(<TestProviders><DataEngineProvider><StructurePage /></DataEngineProvider></TestProviders>);
  expect(await screen.findByText(original)).toBeInTheDocument();
  fireEvent.click(screen.getByTitle(mode === 'edit' ? 'structure.editThought' : 'structure.addThoughtToPoint'));
  const editor = await screen.findByRole('textbox', { name: 'Thought text' });
  fireEvent.change(editor, { target: { value: draft } });
  const dialog = screen.getByRole('dialog');
  if (mode === 'create') expect(within(dialog).getByLabelText('editThought.outlinePointLabel')).toHaveTextContent('Main point');
  const save = within(dialog).getByRole('button', { name: 'buttons.save' });
  await waitFor(() => expect(save).toBeEnabled());
  let refused = false;
  harness.storage.writeFailureFor = (key, value) => {
    if (refused || !Array.isArray(key) || !['checkpoint', 'request'].includes(key[0]) || !JSON.stringify(value)?.includes(draft)) return false;
    refused = true;
    return true;
  };
  fireEvent.click(save);
  expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
  expect(refused).toBe(true);
  expect(editor).toHaveValue(draft);
  const cancel = within(dialog).getByRole('button', { name: 'buttons.cancel' });
  await waitFor(() => expect(cancel).toBeEnabled());
  fireEvent.click(cancel);
  fireEvent.click(await screen.findByRole('button', { name: 'common.discardChanges.confirm' }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  expect(harness.transport.send).not.toHaveBeenCalled();
  expect(harness.server).toMatchObject({ metadata: { revision: 1 }, value: { thoughts: [thought] } });
  expect(screen.queryByText(draft)).not.toBeInTheDocument();
  expect(screen.getByText(original)).toBeVisible();
});

afterEach(() => { mockFocus = false; });

it.each(['edit', 'create'])('shows a captured manual %s while the board still displays sorting proposals', async mode => {
  mockFocus = true;
  const first = { ...thought, outlinePointId: 'point' };
  const second = { ...first, id: 'second', text: 'Second thought' };
  const harness = documentEngineHarness({
    resource,
    metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false },
    value: { userId: 'owner', title: 'Test sermon', verse: '', date: '2026-11-07', thoughts: [first, second],
      structure: { ...structure, main: [first.id, second.id] },
      outline: { introduction: [], main: [{ id: 'point', text: 'Main point' }], conclusion: [] } },
  });
  jest.mocked(createBrowserDataEngine).mockImplementation(() => harness.createBrowser({ withCollections: true }));
  jest.mocked(sortItemsWithAI).mockImplementation(async (_section, items) => [...items].reverse());
  render(<TestProviders><DataEngineProvider><StructurePage /></DataEngineProvider></TestProviders>);
  await screen.findByText(original);
  fireEvent.click(screen.getByTitle('structure.aiSortPoint'));
  await waitFor(() => expect(screen.getAllByTitle('structure.keepChanges')).toHaveLength(2));
  if (mode === 'edit') {
    const card = screen.getByText(original).closest<HTMLElement>('[aria-roledescription="sortable"]');
    if (!card) throw new Error('The thought is not on a sortable card');
    fireEvent.click(within(card).getByTitle('structure.editThought'));
  } else {
    fireEvent.click(screen.getByTitle('structure.addThoughtToPoint'));
  }
  const editor = await screen.findByRole('textbox', { name: 'Thought text' });
  fireEvent.change(editor, { target: { value: 'Manually revised thought' } });
  const dialog = screen.getByRole('dialog');
  const save = within(dialog).getByRole('button', { name: 'buttons.save' });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  await waitFor(() => expect(harness.server.value?.thoughts).toContainEqual(expect.objectContaining({
    text: 'Manually revised thought', outlinePointId: 'point',
  })));
  expect(screen.getByText('Manually revised thought')).toBeVisible();
  expect(screen.getAllByTitle('structure.keepChanges')).toHaveLength(2);
  expect(harness.server.value?.structure).toMatchObject({
    main: mode === 'edit' ? [first.id, second.id] : [first.id, second.id, expect.any(String)],
  });
  fireEvent.click(screen.getByRole('button', { name: 'structure.rejectAllChanges' }));
  await waitFor(() => expect(screen.queryByTitle('structure.keepChanges')).not.toBeInTheDocument());
  expect(screen.getByText('Manually revised thought')).toBeVisible();
  expect(harness.server.value?.thoughts).toContainEqual(expect.objectContaining({ text: 'Manually revised thought' }));
});

it('retries the same admitted thought edit when the board is reopened after a lost acknowledgement', async () => {
  const harness = documentEngineHarness({
    resource,
    metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false },
    value: { userId: 'owner', title: 'Test sermon', verse: '', date: '2026-11-07', thoughts: [thought], structure,
      outline: { introduction: [], main: [{ id: 'point', text: 'Main point' }], conclusion: [] } },
  });
  const updated = 'The words committed before the reply was lost';
  const send = jest.mocked(harness.transport.send);
  const deliver = send.getMockImplementation()!;
  let receivedReply = false;
  send.mockImplementation(async command => {
    const answer = await deliver(command);
    if (!receivedReply) throw new TypeError('Failed to fetch');
    return answer;
  });
  jest.mocked(createBrowserDataEngine).mockImplementation(() => harness.createBrowser({ withCollections: true }));
  const board = (open: boolean) => <TestProviders><DataEngineProvider>{open ? <StructurePage /> : <p>List</p>}</DataEngineProvider></TestProviders>;
  const view = render(board(true));
  await screen.findByText(original);
  fireEvent.click(screen.getByTitle('structure.editThought'));
  const editor = await screen.findByRole('textbox', { name: 'Thought text' });
  fireEvent.change(editor, { target: { value: updated } });
  const dialog = screen.getByRole('dialog');
  const save = within(dialog).getByRole('button', { name: 'buttons.save' });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  await waitFor(() => expect(send).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'dataSync.retry' })).not.toBeInTheDocument();
  // Exhaust the silent retries without sleeping through production backoff.
  for (let attempt = 1; attempt < UNANSWERED_SAID_AFTER_ATTEMPTS; attempt++) {
    await act(async () => { await harness.engine.retry(resource).catch(() => undefined); });
  }
  await screen.findByRole('button', { name: 'dataSync.retry' });
  const operationId = send.mock.calls[0][0].operationId;
  expect(harness.server).toMatchObject({ metadata: { revision: 2 }, value: { thoughts: [{ ...thought, text: updated }] } });

  view.rerender(board(false));
  await screen.findByText('List');
  view.rerender(board(true));
  expect(await screen.findByText(updated)).toBeVisible();
  const retry = await screen.findByRole('button', { name: 'dataSync.retry' });
  const callsBeforeRetry = send.mock.calls.length;
  receivedReply = true;
  fireEvent.click(retry);
  await waitFor(() => expect(send.mock.calls.length).toBeGreaterThan(callsBeforeRetry));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'dataSync.retry' })).not.toBeInTheDocument());
  expect(new Set(send.mock.calls.map(([command]) => command.operationId))).toEqual(new Set([operationId]));
  expect(harness.server).toMatchObject({ metadata: { revision: 2 }, value: { thoughts: [{ ...thought, text: updated }] } });
  expect(screen.getByText(updated)).toBeVisible();
});

it.each(['edit', 'create'] as const)('keeps a blank %s draft out of the board without deleting the stored thought', async mode => {
  const harness = documentEngineHarness({
    resource,
    metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false },
    value: { userId: 'owner', title: 'Test sermon', verse: '', date: '2026-11-07', thoughts: [thought], structure,
      outline: { introduction: [], main: [{ id: 'point', text: 'Main point' }], conclusion: [] } },
  });
  jest.mocked(createBrowserDataEngine).mockImplementation(() => harness.createBrowser({ withCollections: true }));
  render(<TestProviders><DataEngineProvider><StructurePage /></DataEngineProvider></TestProviders>);
  await screen.findByText(original);
  fireEvent.click(screen.getByTitle(mode === 'edit' ? 'structure.editThought' : 'structure.addThoughtToPoint'));
  const editor = await screen.findByRole('textbox', { name: 'Thought text' });
  fireEvent.change(editor, { target: { value: '   ' } });
  const dialog = screen.getByRole('dialog');
  const save = within(dialog).getByRole('button', { name: 'buttons.save' });
  expect(save).toBeDisabled();
  expect(harness.transport.send).not.toHaveBeenCalled();
  expect(harness.server).toMatchObject({ metadata: { revision: 1 }, value: { thoughts: [thought] } });

  fireEvent.change(editor, { target: { value: 'Words after leaving the field blank' } });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  await waitFor(() => expect(harness.server.value?.thoughts).toHaveLength(mode === 'edit' ? 1 : 2));
  expect(harness.server.value?.thoughts).toContainEqual(expect.objectContaining({ text: 'Words after leaving the field blank' }));
});

it.each(['point', 'subpoint'])('offers the unsubmitted %s title after reopening when browser storage refuses the old backup', async kind => {
  const harness = documentEngineHarness({
    resource,
    metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false },
    value: { userId: 'owner', title: 'Test sermon', verse: '', date: '2026-11-07', thoughts: [thought], structure,
      outline: { introduction: [], main: [{ id: 'point', text: 'Main point', subPoints: [{ id: 'subpoint', text: 'A subpoint', position: 1000 }] }], conclusion: [] } },
  });
  jest.mocked(createBrowserDataEngine).mockImplementation(() => harness.createBrowser({ withCollections: true }));
  const originalWrite = Storage.prototype.setItem;
  const localWrite = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key.includes(':outline-title:')) throw new DOMException('Old outline backup was refused', 'QuotaExceededError');
    originalWrite.call(this, key, value);
  });
  const board = (open: boolean) => <TestProviders><DataEngineProvider>{open ? <StructurePage /> : <p>List</p>}</DataEngineProvider></TestProviders>;
  const view = render(board(true));
  const words = 'The exact title typed before leaving';
  const shown = kind === 'point' ? 'Main point' : 'A subpoint';
  try {
    if (kind === 'point') fireEvent.click(await screen.findByRole('heading', { name: shown }));
    else {
      const lane = await screen.findByTestId('sub-point-drop-subpoint');
      fireEvent.click(within(lane).getByRole('button', { name: 'common.edit' }));
    }
    const field = await screen.findByDisplayValue(shown);
    fireEvent.change(field, { target: { value: words } });
    expect(field).toHaveValue(words);
    expect(harness.transport.send).not.toHaveBeenCalled();
    view.rerender(board(false));
    await screen.findByText('List');
    view.rerender(board(true));
    expect(await screen.findByRole('heading', { name: 'Main point' })).toBeVisible();
    expect(await screen.findByDisplayValue(words)).toHaveAttribute('readonly');
    expect(harness.transport.send).not.toHaveBeenCalled();
    expect([...harness.storage.rows.values()]).toContainEqual(expect.objectContaining({ value: { target: { kind, id: kind }, text: words } }));
    expect(harness.server.value?.outline).toMatchObject({ main: [{ text: 'Main point' }] });
  } finally {
    view.unmount();
    localWrite.mockRestore();
  }
});

it('retains an inline outline rename on the sermon page when leaving without Enter', async () => {
  const outline = { introduction: [], main: [{ id: 'inline', text: 'Inline point' }], conclusion: [] };
  const sermon = { id: resource.id, userId: 'owner', title: 'Sermon', verse: '', date: '2026-11-07', thoughts: [], outline } satisfies Sermon;
  const harness = documentEngineHarness({ resource, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false }, value: sermon });
  jest.mocked(createBrowserDataEngine).mockImplementation(() => harness.createBrowser({ withCollections: true }));
  const board = (open: boolean) => <TestProviders><DataEngineProvider>{open ? <SermonOutline sermon={sermon} /> : <p>List</p>}</DataEngineProvider></TestProviders>;
  const view = render(board(true));
  await waitFor(() => expect(harness.engine).toBeDefined());
  fireEvent.doubleClick(await screen.findByText('Inline point'));
  const field = await screen.findByPlaceholderText('structure.editPointPlaceholder');
  const words = 'Exact unfinished words in the sermon outline';
  fireEvent.change(field, { target: { value: words } });
  expect(field).toHaveValue(words);
  expect(harness.transport.send).not.toHaveBeenCalled();
  view.rerender(board(false));
  await screen.findByText('List');
  view.rerender(board(true));
  expect(await screen.findByDisplayValue(words)).toHaveAttribute('readonly');
  expect(screen.getByText('Inline point')).toBeInTheDocument();
  expect(harness.transport.send).not.toHaveBeenCalled();
});

type NewOutlinePath = 'append' | 'insert' | 'subpoint' | 'inline' | 'modal';
const newOutlineWords = 'Exact text of a new outline item';

async function openNewOutlineField(path: NewOutlinePath) {
  const outline = { introduction: [], main: [
    { id: 'first', text: 'First point', subPoints: [{ id: 'existing-subpoint', text: 'Existing subpoint', position: 1000 }] },
    { id: 'second', text: 'Second point', subPoints: [] },
  ], conclusion: [] };
  const sermon = { id: resource.id, userId: 'owner', title: 'Unsubmitted creation', verse: '', date: '2026-11-07', thoughts: [thought], structure, outline } satisfies Sermon;
  const harness = documentEngineHarness({ resource, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false }, value: sermon });
  jest.mocked(createBrowserDataEngine).mockImplementation(() => harness.createBrowser({ withCollections: true }));
  const outlineEditor = path === 'inline' ? <SermonOutline sermon={sermon} />
    : path === 'modal' ? <PlanEditorModal isOpen sermon={sermon} onClose={() => undefined} /> : <StructurePage />;
  const board = (open: boolean) => <TestProviders><DataEngineProvider>{open ? outlineEditor : <p>List</p>}</DataEngineProvider></TestProviders>;
  const view = render(board(true));
  await waitFor(() => expect(harness.engine).toBeDefined());

  let placeholder = 'structure.newOutlinePointName';
  if (path === 'inline') {
    const section = await screen.findByTestId('outline-section-mainPart');
    fireEvent.click(within(section).getByRole('button', { name: 'structure.addPointButton' }));
    placeholder = 'structure.addPointPlaceholder';
  } else if (path === 'modal') {
    const modal = await screen.findByRole('dialog', { name: 'planEditor.title' });
    fireEvent.click((await within(modal).findAllByRole('button', { name: 'structure.addPointButton' }))[1]);
    placeholder = 'structure.addPointPlaceholder';
  } else {
    await screen.findByRole('heading', { name: 'Second point' });
    if (path === 'subpoint') {
      fireEvent.click(screen.getAllByRole('button', { name: 'structure.addSubPoint' }).find(button => button.textContent?.includes('structure.addSubPoint'))!);
      placeholder = 'structure.subPointPlaceholder';
    } else if (path === 'insert') {
      const divider = view.container.querySelector('[class*="group/divider"]');
      expect(divider).toBeInTheDocument();
      fireEvent.click(divider!);
    } else {
      fireEvent.click((await screen.findAllByRole('button', { name: 'structure.addOutlinePoint' }))[1]);
    }
  }

  const field = await screen.findByPlaceholderText(placeholder);
  fireEvent.change(field, { target: { value: newOutlineWords } });
  expect(field).toHaveValue(newOutlineWords);
  expect(harness.transport.send).not.toHaveBeenCalled();
  return { board, field, harness, outline, view };
}

it.each(['append', 'insert', 'subpoint', 'inline', 'modal'] as const)('keeps a new %s title before creating an outline item', async path => {
  const { board, harness, outline, view } = await openNewOutlineField(path);
  view.rerender(board(false));
  await screen.findByText('List');
  view.rerender(board(true));
  expect(await screen.findByDisplayValue(newOutlineWords)).toHaveAttribute('readonly');
  expect(harness.server.value?.outline).toEqual(outline);
  expect(harness.transport.send).not.toHaveBeenCalled();
});

it.each(['append', 'insert', 'subpoint'] as const)('creates the %s once using the captured draft identity, then retires its text', async path => {
  const { field, harness } = await openNewOutlineField(path);
  const retained = () => [...harness.storage.rows.values()].find(row =>
    (row as { value?: { text?: string } }).value?.text === newOutlineWords) as { value: { target: { id: string } } } | undefined;
  await waitFor(() => expect(retained()).toBeDefined());
  const { id } = retained()!.value.target;
  act(() => {
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.keyDown(field, { key: 'Enter' });
  });
  await waitFor(() => expect(harness.server.metadata?.revision).toBe(2));
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  const main = (harness.server.value?.outline as unknown as Sermon['outline'])!.main;
  const created = { id, text: newOutlineWords };
  if (path === 'subpoint') expect(main[0].subPoints).toEqual([{ id: 'existing-subpoint', text: 'Existing subpoint', position: 1000 },
    { ...created, position: 2000 }]);
  else expect(main.map(point => ({ id: point.id, text: point.text }))).toEqual(path === 'append'
    ? [{ id: 'first', text: 'First point' }, { id: 'second', text: 'Second point' }, created]
    : [{ id: 'first', text: 'First point' }, created, { id: 'second', text: 'Second point' }]);
  await waitFor(() => expect(retained()).toBeUndefined());
  expect(screen.queryByRole('region', { name: 'structure.unsubmittedTitle.heading' })).not.toBeInTheDocument();
});

it('cancels a new outline field explicitly without making a point or leaving a recovery copy', async () => {
  const { board, field, harness, outline, view } = await openNewOutlineField('insert');
  const retained = () => [...harness.storage.rows.values()].some(row => (row as { value?: { text?: string } }).value?.text === newOutlineWords);
  await waitFor(() => expect(retained()).toBe(true));
  fireEvent.keyDown(field, { key: 'Escape' });
  await waitFor(() => expect(retained()).toBe(false));
  view.rerender(board(false));
  view.rerender(board(true));
  expect(await screen.findByRole('heading', { name: 'First point' })).toBeVisible();
  expect(screen.queryByDisplayValue(newOutlineWords)).not.toBeInTheDocument();
  expect(harness.server.value?.outline).toEqual(outline);
  expect(harness.transport.send).not.toHaveBeenCalled();
});

it.each(['local', 'stored'])('reopens a confirmed title comparison and keeps the %s version without the old comparison backup', async choice => {
  const sibling = { id: 'neighbor', text: 'Unchanged sibling' };
  const before = { introduction: [], main: [{ id: 'point', text: 'Original title' }, sibling], conclusion: [] };
  const stored = { ...before, main: [{ id: 'point', text: 'Title saved on the other device' }, { ...sibling, text: 'Later sibling title' }] };
  const entered = 'Title confirmed here';
  const h = documentEngineHarness({ resource, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false },
    value: { userId: 'owner', title: 'Test sermon', verse: '', date: '2026-11-07', thoughts: [thought], structure, outline: before } });
  jest.mocked(createBrowserDataEngine).mockImplementation(() => h.createBrowser({ withCollections: true }));
  const originalWrite = Storage.prototype.setItem;
  const localWrite = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key.includes(':conflict%3AoutlineConflict:')) throw new DOMException('Legacy comparison storage refused', 'QuotaExceededError');
    originalWrite.call(this, key, value);
  });
  const board = (open: boolean) => <TestProviders><DataEngineProvider>{open ? <StructurePage /> : <p>List</p>}</DataEngineProvider></TestProviders>;
  const view = render(board(true));
  try {
    fireEvent.click(await screen.findByRole('heading', { name: 'Original title' }));
    const field = screen.getByDisplayValue('Original title');
    fireEvent.change(field, { target: { value: entered } });
    await act(async () => h.remote({ outline: stored }));
    expect(field).toHaveValue(entered);
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(field).not.toBeInTheDocument());
    expect(h.server.value?.outline).toEqual(stored);
    expect(h.transport.send).not.toHaveBeenCalled();

    view.rerender(board(false));
    await screen.findByText('List');
    view.rerender(board(true));
    expect(await screen.findByRole('heading', { name: stored.main[0].text })).toBeVisible();
    fireEvent.click(await screen.findByRole('button', { name: 'dataSync.reviewSavedChange' }));
    const comparison = await screen.findByRole('region', { name: 'dataSync.versionComparison' });
    expect(within(comparison).getByText(entered, { exact: true })).toBeVisible();
    expect(within(comparison).getByText(stored.main[0].text, { exact: true })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'structure.unsubmittedTitle.heading' })).not.toBeInTheDocument();
    if (choice === 'local') {
      fireEvent.click(within(comparison).getByRole('button', { name: 'dataSync.useLocalVersion' }));
      await waitFor(() => expect(h.server.value?.outline).toEqual({
        ...stored, main: [{ id: 'point', text: entered }, stored.main[1]],
      }));
      expect(h.transport.send).toHaveBeenCalledTimes(1);
    } else {
      fireEvent.click(within(comparison).getByRole('button', { name: 'dataSync.useStoredVersion' }));
      const confirm = await screen.findByRole('dialog');
      fireEvent.click(within(confirm).getByRole('button', { name: /dataSync.confirmStoredField.confirm|dataSync.useStoredVersion/ }));
      await waitFor(() => expect(comparison).not.toBeInTheDocument());
      expect(h.server.value?.outline).toEqual(stored);
      expect(h.transport.send).not.toHaveBeenCalled();
    }
  } finally {
    localWrite.mockRestore();
    view.unmount();
  }
});

it('shows the active comparison inside the plan editor and adopts the exact stored title there', async () => {
  const before = { introduction: [], main: [{ id: 'point', text: 'Original title' }], conclusion: [] };
  const stored = { ...before, main: [{ id: 'point', text: 'Title saved elsewhere' }] };
  const sermon = { id: resource.id, userId: 'owner', title: 'Test sermon', verse: '', date: '2026-11-07', thoughts: [thought], structure, outline: before } satisfies Sermon;
  const h = documentEngineHarness({ resource, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false }, value: sermon });
  jest.mocked(createBrowserDataEngine).mockImplementation(() => h.createBrowser({ withCollections: true }));
  render(<TestProviders><DataEngineProvider><DataDocumentProvider resource={resource}>
    <EngineStructureWriterProvider sermonId={resource.id}>
      <PlanEditorModal isOpen sermon={sermon} onClose={() => undefined} />
    </EngineStructureWriterProvider>
  </DataDocumentProvider></DataEngineProvider></TestProviders>);
  const modal = await screen.findByRole('dialog', { name: 'planEditor.title' });
  await waitFor(() => expect(h.engine).toBeDefined());
  await waitFor(() => expect(h.transport.read).toHaveBeenCalled());
  const inModal = within(modal);
  fireEvent.doubleClick(await inModal.findByText('Original title'));
  const field = inModal.getByDisplayValue('Original title');
  fireEvent.change(field, { target: { value: 'Different unsaved title' } });
  await act(async () => h.remote({ outline: stored }));
  fireEvent.keyDown(field, { key: 'Enter' });

  const comparison = await inModal.findByRole('region', { name: 'dataSync.versionComparison' });
  expect(within(comparison).getByText('Different unsaved title')).toBeVisible();
  expect(within(comparison).getByText('Title saved elsewhere')).toBeVisible();
  fireEvent.click(await within(comparison).findByRole('button', { name: 'dataSync.useStoredVersion' }));
  const confirm = await screen.findByRole('dialog', { name: 'dataSync.confirmStoredField.title' });
  fireEvent.click(within(confirm).getByRole('button', { name: /dataSync.confirmStoredField.confirm|dataSync.useStoredVersion/ }));
  await waitFor(() => expect(comparison).not.toBeInTheDocument());
  expect(inModal.getByText('Title saved elsewhere')).toBeVisible();
  expect(h.server.value?.outline).toEqual(stored);
  expect(h.transport.send).not.toHaveBeenCalled();
});

it.each(['local', 'stored', 'failed-local', 'newer-stored'] as const)('reopens a whole-outline comparison and handles the %s choice', async side => {
  const before = { introduction: [], main: [{ id: 'point', text: 'Original point' }], conclusion: [] };
  const saved = { ...before, main: [{ id: 'point', text: 'Point rewritten on the other device' },
    { id: 'new', text: 'Point added on the other device' }] };
  const sermon = { id: resource.id, userId: 'owner', title: 'Test sermon', verse: '', date: '2026-11-07', thoughts: [], structure, outline: before } satisfies Sermon;
  const h = documentEngineHarness({ resource, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false }, value: sermon });
  jest.mocked(createBrowserDataEngine).mockImplementation(() => h.createBrowser({ withCollections: true }));
  const write = Storage.prototype.setItem;
  const guard = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key.includes(':conflict%3AoutlineConflict:')) throw new DOMException('Legacy comparison storage refused', 'QuotaExceededError');
    write.call(this, key, value);
  });
  const retain = jest.spyOn(EditorController.prototype, 'retainSermonOutlineReview');
  const choose = jest.spyOn(EditorController.prototype, 'chooseSermonOutlineReview');
  let serverOutline = before;
  const editor = (open: boolean) => <TestProviders><DataEngineProvider>{open ? <DataDocumentProvider resource={resource}>
    <EngineStructureWriterProvider sermonId={resource.id}>
      <PlanEditorModal isOpen sermon={{ ...sermon, outline: serverOutline }} onClose={() => undefined} />
    </EngineStructureWriterProvider>
  </DataDocumentProvider> : <p>List</p>}</DataEngineProvider></TestProviders>;
  const view = render(editor(true));
  const reopen = async () => {
    view.rerender(editor(false));
    await screen.findByText('List');
    serverOutline = saved;
    view.rerender(editor(true));
    const reopened = within(await screen.findByRole('dialog', { name: 'planEditor.title' }));
    fireEvent.click(await reopened.findByRole('button', { name: 'dataSync.reviewSavedChange' }));
    return reopened.findByRole('region', { name: 'dataSync.versionComparison' });
  };
  try {
    const modal = within(await screen.findByRole('dialog', { name: 'planEditor.title' }));
    await modal.findByText('Original point');
    await waitFor(() => expect(h.transport.read).toHaveBeenCalled());
    await act(async () => h.remote({ outline: saved, title: 'Latest sermon title' }));
    fireEvent.click(modal.getByRole('button', { name: 'planEditor.clear' }));
    const confirm = within(await screen.findByRole('dialog', { name: 'planEditor.clearConfirm.title' }));
    fireEvent.click(confirm.getByRole('button', { name: 'planEditor.clearConfirm.confirm' }));
    await modal.findByText(/freshness.conflictTitle|dataSync.versionComparison/);
    expect(h.server.value?.outline).toEqual(saved);
    expect(h.transport.send).not.toHaveBeenCalled();
    expect(retain).toHaveBeenCalledTimes(1);
    expect(retain.mock.results[0].value).toBeInstanceOf(Promise);
    const retainedCopy = await h.checkpoints.listRecoverable('owner', resource);
    expect(retainedCopy.some(copy => copy.record.checkpoint.conflicts.some(conflict =>
      conflict.code === 'sermon-outline-review'))).toBe(true);

    let comparison = within(await reopen());
    expect(comparison.getByLabelText('dataSync.storedVersion')).toHaveTextContent(saved.main[0].text);
    expect(comparison.getByLabelText('dataSync.yourVersion')).toHaveTextContent(saved.main[1].text);
    expect(comparison.getByLabelText('dataSync.yourVersion')).not.toHaveTextContent(saved.main[0].text);
    if (side === 'failed-local') {
      let refused = 0;
      h.storage.writeFailureFor = (key, row) => {
        const checkpoint = (row as { checkpoint?: { draft?: { outline?: typeof before } } } | undefined)?.checkpoint;
        if (!Array.isArray(key) || key[0] !== 'checkpoint' || checkpoint?.draft?.outline?.main.length !== 1) return false;
        if (checkpoint.draft.outline.main[0].id !== 'new') return false;
        refused += 1;
        return true;
      };
      fireEvent.click(comparison.getByRole('button', { name: 'dataSync.useLocalVersion' }));
      await waitFor(() => expect(refused).toBeGreaterThan(0));
      expect(h.server.value?.outline).toEqual(saved);
      expect(h.transport.send).not.toHaveBeenCalled();
      h.storage.writeFailureFor = undefined;
      const copies = await h.checkpoints.listRecoverable('owner', resource);
      expect(copies.some(copy => copy.record.checkpoint.conflicts.some(conflict => conflict.path[0] === 'outline'))).toBe(true);
      comparison = within(await reopen());
    }

    const later = { ...saved, main: [{ ...saved.main[0], text: 'An even later point title' }, saved.main[1]] };
    if (side === 'newer-stored') {
      await act(async () => h.remote({ outline: later }));
      await waitFor(() => expect(comparison.getByLabelText('dataSync.storedVersion')).toHaveTextContent(later.main[0].text));
    }
    if (side === 'stored' || side === 'newer-stored') {
      fireEvent.click(comparison.getByRole('button', { name: 'dataSync.useStoredVersion' }));
      const confirmation = within(await screen.findByRole('dialog', { name: 'dataSync.confirmStoredField.title' }));
      fireEvent.click(confirmation.getByRole('button', { name: /dataSync.confirmStoredField.confirm|dataSync.useStoredVersion/ }));
      await waitFor(() => expect(screen.queryByRole('region', { name: 'dataSync.versionComparison' })).not.toBeInTheDocument());
      expect(h.server.value?.outline).toEqual(side === 'newer-stored' ? later : saved);
      expect(h.transport.send).not.toHaveBeenCalled();
    } else {
      fireEvent.click(comparison.getByRole('button', { name: 'dataSync.useLocalVersion' }));
      await waitFor(() => expect(h.server.value?.outline).toEqual({ ...before, main: [saved.main[1]] }));
      expect(h.transport.send).toHaveBeenCalledTimes(1);
      const localChoices = choose.mock.calls.filter(([which]) => which === 'local');
      expect(localChoices).toHaveLength(side === 'failed-local' ? 2 : 1);
      expect(localChoices.at(-1)?.[1].checkpoint.conflicts).toEqual([
        expect.objectContaining({ code: 'sermon-outline-review' }),
      ]);
      expect(h.server.metadata?.revision).toBe(3);
      const [wire] = jest.mocked(h.transport.send).mock.calls[0];
      expect(wire).toMatchObject({ kind: 'update', resource,
        changes: expect.arrayContaining([expect.objectContaining({ path: ['outline'] })]) });
    }
    expect(h.server.value?.title).toBe('Latest sermon title');
    await waitFor(async () => {
      const copies = await h.checkpoints.listRecoverable('owner', resource);
      expect(copies.some(copy => copy.record.checkpoint.conflicts.some(conflict => conflict.path[0] === 'outline'))).toBe(false);
    });
    expect(guard.mock.calls.some(([key]) => key.includes(':conflict%3AoutlineConflict:'))).toBe(false);
  } finally {
    view.unmount();
    guard.mockRestore();
    retain.mockRestore();
    choose.mockRestore();
  }
});

it.each([
  { kind: 'point', arrivesBeforeEditing: false, moved: false },
  { kind: 'subpoint', arrivesBeforeEditing: false, moved: false },
  { kind: 'point', arrivesBeforeEditing: true, moved: false },
  { kind: 'point', arrivesBeforeEditing: false, moved: true },
] as const)('handles a competing $kind note in the structure editor (earlier arrival: $arrivesBeforeEditing, moved: $moved)', async ({ kind, arrivesBeforeEditing, moved }) => {
  const opening = 'Note text at the opening';
  const mine = 'Note typed in the editor';
  const saved = 'Note revised on the second device';
  const shownOutline = (words: string, childTitle: string) => ({ introduction: [], main: [
    { id: 'point', text: 'Parent point', ...(kind === 'point' && { note: words }),
      subPoints: [{ id: 'child', text: childTitle, position: 1, ...(kind === 'subpoint' && { note: words }) }] },
  ], conclusion: [] });
  const outline = shownOutline(opening, 'Child point');
  const fresh = moved
    ? { ...outline, main: [{ id: 'child', text: 'New parent of the original point',
      subPoints: [{ id: 'point', text: 'Parent point', position: 1, note: opening }] }] }
    : shownOutline(saved, 'New child title on the second device');
  const sermon = { id: resource.id, userId: 'owner', title: 'Test sermon', verse: '', date: '2026-11-07', thoughts: [thought], structure, outline } satisfies Sermon;
  const h = documentEngineHarness({ resource, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false }, value: sermon });
  jest.mocked(createBrowserDataEngine).mockImplementation(() => h.createBrowser({ withCollections: true }));
  const setItem = Storage.prototype.setItem;
  const oldBackup = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key.includes(':conflict%3AoutlineConflict:')) throw new DOMException('Legacy comparison storage refused', 'QuotaExceededError');
    setItem.call(this, key, value);
  });
  let shown = outline;
  function ReadyEditor() {
    const document = useDataDocument(resource);
    return document.state && <PlanEditorModal isOpen sermon={{ ...sermon, outline: shown }} onClose={() => undefined} />;
  }
  const workspace = (open: boolean) => <TestProviders><DataEngineProvider>{open ? <DataDocumentProvider resource={resource}>
    <EngineStructureWriterProvider sermonId={resource.id}><ReadyEditor /></EngineStructureWriterProvider>
  </DataDocumentProvider> : <p>List</p>}</DataEngineProvider></TestProviders>;
  const view = render(workspace(true));
  const dialog = async () => within(await screen.findByRole('dialog', { name: 'planEditor.title' }));
  try {
    const editor = await dialog();
    await editor.findByText(opening);
    await waitFor(() => expect(h.transport.read).toHaveBeenCalled());
    if (arrivesBeforeEditing) await act(async () => h.remote({ outline: fresh }));
    fireEvent.click(editor.getByText(opening));
    const note = editor.getByRole('textbox');
    fireEvent.change(note, { target: { value: mine } });
    if (!arrivesBeforeEditing) await act(async () => h.remote({ outline: fresh }));
    fireEvent.keyDown(note, { key: 'Enter' });
    await waitFor(() => expect(note).not.toBeInTheDocument());
    if (moved) {
      await waitFor(() => expect(h.server.value?.outline).toEqual({ ...fresh, main: [{ ...fresh.main[0],
        subPoints: [{ ...fresh.main[0].subPoints[0], note: mine }],
      }] }));
      expect(editor.queryByRole('region', { name: 'dataSync.versionComparison' })).not.toBeInTheDocument();
      return;
    }
    expect(h.server.value?.outline).toEqual(fresh);

    view.rerender(workspace(false));
    await screen.findByText('List');
    shown = fresh;
    view.rerender(workspace(true));
    const reopened = await dialog();
    const review = await waitFor(() => {
      const outcome = reopened.queryByRole('region', { name: 'dataSync.versionComparison' })
        ?? reopened.queryByRole('button', { name: 'dataSync.reviewSavedChange' });
      expect(outcome).not.toBeNull();
      return outcome!;
    });
    if (review.tagName === 'BUTTON') fireEvent.click(review);
    const comparison = within(await reopened.findByRole('region', { name: 'dataSync.versionComparison' }));
    expect(comparison.getByLabelText('dataSync.yourVersion')).toHaveTextContent(mine);
    expect(comparison.getByLabelText('dataSync.storedVersion')).toHaveTextContent(saved);
    if (kind === 'point') {
      fireEvent.click(comparison.getByRole('button', { name: 'dataSync.useLocalVersion' }));
      await waitFor(() => expect(h.server.value?.outline).toEqual({ ...fresh, main: [{ ...fresh.main[0], note: mine }] }));
    } else {
      fireEvent.click(comparison.getByRole('button', { name: 'dataSync.useStoredVersion' }));
      const confirm = within(await screen.findByRole('dialog', { name: 'dataSync.confirmStoredField.title' }));
      fireEvent.click(confirm.getByRole('button', { name: /dataSync.confirmStoredField.confirm|dataSync.useStoredVersion/ }));
      await waitFor(() => expect(reopened.queryByRole('region', { name: 'dataSync.versionComparison' })).not.toBeInTheDocument());
      expect(h.server.value?.outline).toEqual(fresh);
    }
    expect(oldBackup.mock.calls.some(([key]) => key.includes(':conflict%3AoutlineConflict:'))).toBe(false);
  } finally {
    view.unmount();
    oldBackup.mockRestore();
  }
});

it.each([
  { side: 'local', discardEarlier: false },
  { side: 'stored', discardEarlier: false },
  { side: 'local', discardEarlier: true },
] as const)('keeps the $side structure choice while a title save is still waiting (discard earlier: $discardEarlier)', async ({ side, discardEarlier }) => {
  const before = { introduction: [], main: [{ id: 'point', text: 'Original structure point' }], conclusion: [] };
  const saved = { ...before, main: [{ id: 'point', text: 'Structure point revised elsewhere' }] };
  const sermon = { id: resource.id, userId: 'owner', title: 'Original sermon title', verse: '', date: '2026-11-07', thoughts: [], structure, outline: before } satisfies Sermon;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const h = documentEngineHarness({ resource, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false }, value: sermon }, {
    apply: async (command, current) => {
      if (command.kind === 'update' && command.changes.some(change => change.path[0] === 'title')) {
        await held;
        if (discardEarlier) return { kind: 'refused', operationId: command.operationId, code: 'decision-changed' };
      }
      return applyCommand(command, current);
    },
  });
  jest.mocked(createBrowserDataEngine).mockImplementation(() => h.createBrowser({ withCollections: true }));
  const setItem = Storage.prototype.setItem;
  const oldBackup = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key.includes(':conflict%3AoutlineConflict:')) throw new DOMException('Legacy comparison storage refused', 'QuotaExceededError');
    setItem.call(this, key, value);
  });
  let shown = before;
  let queueTitle!: () => Promise<void>;
  let discardTitle!: () => Promise<void>;
  let phase: string | undefined;
  function ReadyEditor() {
    const document = useDataDocument(resource);
    queueTitle = () => document.commit(current => current && { ...current, title: 'Queued sermon title' });
    discardTitle = () => document.acceptRemote();
    phase = document.status?.phase;
    return document.state && <PlanEditorModal isOpen sermon={{ ...sermon, outline: shown }} onClose={() => undefined} />;
  }
  const app = (open: boolean) => <TestProviders><DataEngineProvider>{open ? <DataDocumentProvider resource={resource}>
    <EngineStructureWriterProvider sermonId={resource.id}><ReadyEditor /></EngineStructureWriterProvider>
  </DataDocumentProvider> : <p>List</p>}</DataEngineProvider></TestProviders>;
  const view = render(app(true));
  try {
    const modal = within(await screen.findByRole('dialog', { name: 'planEditor.title' }));
    await modal.findByText(before.main[0].text);
    await act(async () => h.remote({ outline: saved }));
    await act(async () => queueTitle());
    await waitFor(() => expect(h.transport.send).toHaveBeenCalledTimes(1));
    expect(h.server.value?.title).toBe(sermon.title);

    fireEvent.click(modal.getByRole('button', { name: 'planEditor.clear' }));
    const confirm = within(await screen.findByRole('dialog', { name: 'planEditor.clearConfirm.title' }));
    fireEvent.click(confirm.getByRole('button', { name: 'planEditor.clearConfirm.confirm' }));
    expect(await modal.findByText('planEditor.outlineReviewWaiting')).toBeVisible();
    expect(modal.queryByRole('button', { name: 'dataSync.reviewSavedChange' })).not.toBeInTheDocument();
    if (discardEarlier) {
      release();
      await waitFor(() => expect(phase).toBe('refused'));
      expect(modal.getByText('planEditor.outlineReviewWaiting')).toBeVisible();
      await act(async () => discardTitle());
      await waitFor(() => expect(phase).toBe('saved'));
    }
    view.rerender(app(false));
    await screen.findByText('List');
    release();
    const title = discardEarlier ? sermon.title : 'Queued sermon title';
    await waitFor(() => expect(h.server.value?.title).toBe(title));
    expect(h.server.value?.outline).toEqual(saved);
    shown = saved;
    view.rerender(app(true));
    const reopened = within(await screen.findByRole('dialog', { name: 'planEditor.title' }));
    fireEvent.click(await reopened.findByRole('button', { name: 'dataSync.reviewSavedChange' }));
    const comparison = within(await waitFor(() => within(screen.getByRole('dialog', { name: 'planEditor.title' }))
      .getByRole('region', { name: 'dataSync.versionComparison' })));
    expect(comparison.getByLabelText('dataSync.storedVersion')).toHaveTextContent(saved.main[0].text);
    expect(comparison.getByLabelText('dataSync.yourVersion')).toHaveTextContent('plan.draftRecoveryEmpty');
    expect(oldBackup.mock.calls.some(([key]) => key.includes(':conflict%3AoutlineConflict:'))).toBe(false);
    if (side === 'local') {
      fireEvent.click(comparison.getByRole('button', { name: 'dataSync.useLocalVersion' }));
      await waitFor(() => expect(h.server.value?.outline).toEqual({ ...before, main: [] }));
      expect(h.transport.send).toHaveBeenCalledTimes(2);
    } else {
      fireEvent.click(comparison.getByRole('button', { name: 'dataSync.useStoredVersion' }));
      const accept = within(await screen.findByRole('dialog', { name: 'dataSync.confirmStoredField.title' }));
      fireEvent.click(accept.getByRole('button', { name: /dataSync.confirmStoredField.confirm|dataSync.useStoredVersion/ }));
      await waitFor(() => expect(screen.queryByRole('region', { name: 'dataSync.versionComparison' })).not.toBeInTheDocument());
      expect(h.server.value?.outline).toEqual(saved);
      expect(h.transport.send).toHaveBeenCalledTimes(1);
    }
    expect(h.server.value?.title).toBe(title);
  } finally {
    release();
    view.unmount();
    oldBackup.mockRestore();
  }
});
