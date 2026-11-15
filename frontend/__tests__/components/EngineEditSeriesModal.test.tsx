import { closeHistory } from '@tiptap/pm/history';
import { markdown, mountedEditor, redo, typeAtEnd, undo } from '@test-utils/richMarkdownHistory';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { EngineEditSeriesModal } from '@/components/series/EngineEditSeriesModal';
import { actionClock } from '@/data-engine/actionClock.client';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataDocumentProvider, DataEngineProvider, useDataDocument } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '../../test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
let mockRealEditor = false;
jest.mock('@/components/ui/RichMarkdownEditor', () => ({ RichMarkdownEditor: (props: React.ComponentProps<typeof import('@/components/ui/RichMarkdownEditor').RichMarkdownEditor>) => {
  if (mockRealEditor) {
    const { RichMarkdownEditor } = jest.requireActual('@/components/ui/RichMarkdownEditor');
    return <RichMarkdownEditor {...props} />;
  }
  return <textarea aria-label="Description" value={props.value} onChange={event => props.onChange(event.target.value)} />;
} }));
const resource = { collection: 'series', id: 'series' };
function setup(theme = 'Opening title', description = 'Opening description', bookOrTopic = 'Romans', hasTitle = true) {
  const harness = documentEngineHarness({ resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
    value: { userId: 'owner', ...(hasTitle && { title: 'Opening title' }), theme, description, bookOrTopic,
      status: 'draft', items: [], sermonIds: [], seriesKind: 'sermon', createdAt: 'now', updatedAt: 'now' } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const onClose = jest.fn();
  function ParentStatus() {
    const document = useDataDocument(resource, { autoSave: false });
    return <output data-testid="parent-state">{JSON.stringify({ phase: document.status?.phase, draft: document.data, conflicts: document.state?.checkpoint.conflicts })}</output>;
  }
  function Workspace() {
    return <DataEngineProvider><DataDocumentProvider resource={resource} options={{ autoSave: false }}>
      <ParentStatus /><EngineEditSeriesModal seriesId={resource.id} onClose={onClose} />
    </DataDocumentProvider></DataEngineProvider>;
  }
  return { harness, Workspace, view: render(<Workspace />), onClose };
}
beforeEach(() => jest.clearAllMocks());
it('pins metadata before typing, stages locally, then refuses a conflicting remote title', async () => {
  const { harness, onClose, view } = setup();
  const title = await screen.findByDisplayValue('Opening title'); await waitFor(() => expect(title).toBeEnabled());
  await act(async () => { await harness.remote({ title: 'Other device title', theme: 'Other device title' }); });
  expect(title).toHaveValue('Opening title');
  fireEvent.change(title, { target: { value: 'My title' } });
  await act(async () => { await settleEngine(); }); expect(harness.transport.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.saveChanges' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.server.value?.title).toBe('Other device title');
  expect(screen.getByTestId('parent-state')).toHaveTextContent('conflict'); view.unmount();
});
it('preserves an unrelated remote field and sends only the explicit metadata edit', async () => {
  const { harness, onClose, view } = setup();
  const title = await screen.findByDisplayValue('Opening title'); await waitFor(() => expect(title).toBeEnabled());
  await act(async () => { await harness.remote({ description: 'Other device description' }); });
  fireEvent.change(title, { target: { value: 'My title' } }); await act(async () => { await settleEngine(); });
  fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.saveChanges' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.server.value).toMatchObject({ title: 'My title', theme: 'My title', description: 'Other device description', items: [] });
  expect(harness.transport.send).toHaveBeenCalledTimes(1); view.unmount();
});
it.each([false, true])('keeps a distinct legacy theme when the person changes only the status (title changed and restored: %s)', async restoreTitle => {
  const description = '  Opening description  ', bookOrTopic = '  Romans  ';
  const { harness, onClose, view } = setup('Legacy theme', description, bookOrTopic);
  const title = await screen.findByDisplayValue('Opening title');
  await waitFor(() => expect(title).toBeEnabled());
  if (restoreTitle) {
    fireEvent.change(title, { target: { value: 'Temporary title' } });
    fireEvent.change(title, { target: { value: 'Opening title' } });
  }
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'active' } });
  await act(async () => { await settleEngine(); });
  fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.saveChanges' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.server.value).toMatchObject({ title: 'Opening title', theme: 'Legacy theme', status: 'active', description, bookOrTopic });
  expect(harness.server.value).not.toHaveProperty('color');
  expect(harness.transport.send).toHaveBeenCalledWith(expect.objectContaining({
    changes: [expect.objectContaining({ path: ['status'] })],
  }));
  view.unmount();
});

it('uses the stored legacy theme when the series has no separate title', async () => {
  const { harness, onClose, view } = setup('Legacy theme', 'Opening description', 'Romans', false);
  const title = await screen.findByPlaceholderText('workspaces.series.form.titlePlaceholder');
  await waitFor(() => expect(title).toBeEnabled());
  expect(title).toHaveValue('Legacy theme');
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'active' } });
  await act(async () => { await settleEngine(); });
  fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.saveChanges' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.server.value).toMatchObject({ theme: 'Legacy theme', status: 'active' });
  expect(harness.server.value).not.toHaveProperty('title');
  view.unmount();
});

it('saves the displayed default color when the person actually chooses it', async () => {
  const { harness, onClose, view } = setup();
  const title = await screen.findByDisplayValue('Opening title');
  await waitFor(() => expect(title).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '#3B82F6' }));
  await act(async () => { await settleEngine(); });
  fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.saveChanges' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.server.value).toMatchObject({ color: '#3B82F6', status: 'draft' });
  view.unmount();
});

it('captures one explicit Save time for description and the other authored fields', async () => {
  const time = { earliestMs: 1_800_000_000_000, latestMs: 1_800_000_000_005 };
  const capture = jest.spyOn(actionClock, 'capture').mockReturnValue(time);
  const { harness, onClose, view } = setup();
  try {
    const title = await screen.findByDisplayValue('Opening title');
    await waitFor(() => expect(title).toBeEnabled());
    fireEvent.change(title, { target: { value: 'Revised series' } });
    fireEvent.change(screen.getByDisplayValue('Romans'), { target: { value: 'John' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'active' } });
    fireEvent.click(screen.getByRole('button', { name: '#10B981' }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Revised prose' } });
    await act(async () => { await settleEngine(); });
    expect(capture).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.saveChanges' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await act(async () => { await harness.engine.retry(); await settleEngine(); });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(harness.transport.send).toHaveBeenCalledWith(expect.objectContaining({ seriesFieldActions: {
      title: { observedRevision: 1, time, openingTheme: 'Opening title' }, bookOrTopic: { observedRevision: 1, time },
      status: { observedRevision: 1, time }, color: { observedRevision: 1, time },
      description: { observedRevision: 1, time },
    } }));
  } finally {
    capture.mockRestore();
    view.unmount();
  }
});

it('offers unsent metadata after restart and restores it only by explicit choice', async () => {
  const { harness, Workspace, view } = setup();
  const title = await screen.findByDisplayValue('Opening title'); await waitFor(() => expect(title).toBeEnabled());
  fireEvent.change(title, { target: { value: 'Recovered metadata' } }); await act(async () => { await settleEngine(); });
  view.unmount(); const restored = render(<Workspace />);
  const fresh = await screen.findByDisplayValue('Opening title'); await waitFor(() => expect(fresh).toBeEnabled());
  const choice = await screen.findByRole('option', { name: 'Opening title' });
  expect(harness.transport.send).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('dataSync.recoveryLabel'), { target: { value: choice.getAttribute('value') } });
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' }));
  await screen.findByDisplayValue('Recovered metadata'); expect(harness.transport.send).not.toHaveBeenCalled(); restored.unmount();
});

it('regression pin: keeps explicitly recovered series description text undoable in the mounted editor', async () => {
  const originalNow = Date.now;
  mockRealEditor = true;
  try {
    const { harness, Workspace, view } = setup();
    await waitFor(() => expect(screen.getByDisplayValue('Opening title')).toBeEnabled());
    typeAtEnd(mountedEditor(view.baseElement), ' Requested draft.');
    await act(async () => { await settleEngine(); });
    view.unmount();
    const restored = render(<Workspace />);
    await waitFor(() => expect(screen.getByDisplayValue('Opening title')).toBeEnabled());
    const editor = mountedEditor(restored.baseElement);
    const choice = await screen.findByRole('option', { name: 'Opening title' });
    fireEvent.change(screen.getByLabelText('dataSync.recoveryLabel'), { target: { value: choice.getAttribute('value') } });
    // Separate the requested restore from the initial load in production's 500 ms history group.
    const restoredAt = Date.now() + 1000;
    Date.now = () => restoredAt;
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' }));
    await waitFor(() => expect(markdown(editor)).toBe('Opening description Requested draft.'));
    expect(mountedEditor(restored.baseElement)).toBe(editor);
    expect(undo(editor)).toBe(true);
    expect(markdown(editor)).toBe('Opening description');
    expect(harness.transport.send).not.toHaveBeenCalled();
    restored.unmount();
  } finally { Date.now = originalNow; mockRealEditor = false; jest.restoreAllMocks(); }
});

it.each([false, true])('keeps the selected series description outside Undo (saved words returned to opening: %s)', async returned => {
  mockRealEditor = true;
  try {
    const { harness, Workspace, view } = setup();
    await waitFor(() => expect(screen.getByDisplayValue('Opening title')).toBeEnabled());
    typeAtEnd(mountedEditor(view.baseElement), ' Laptop.');
    fireEvent.change(screen.getByDisplayValue('Romans'), { target: { value: 'Independent book' } });
    await act(async () => { await settleEngine(); });
    const stored = returned ? 'Opening description' : 'Opening description PHONE.';
    await act(async () => {
      await harness.remote({ description: 'Opening description PHONE.' });
      if (returned) await harness.remote({ description: stored });
    });
    if (returned) jest.mocked(harness.transport.send).mockImplementationOnce(async command => ({
      kind: 'conflict', operationId: command.operationId, snapshot: harness.server,
      conflicts: [{ path: ['description'], base: { exists: true, value: stored }, mine: { exists: true, value: 'Opening description Laptop.' },
        theirs: { exists: true, value: stored } }],
    }));
    fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.saveChanges' }));
    await act(async () => { await settleEngine(); await harness.engine.retry(); await settleEngine(); });
    expect(screen.getByTestId('parent-state')).toHaveTextContent('conflict');
    view.unmount();

    const reopened = render(<Workspace />);
    await waitFor(() => expect(screen.getByDisplayValue('Opening title')).toBeEnabled());
    const editor = mountedEditor(reopened.baseElement);
    expect(markdown(editor)).toBe('Opening description Laptop.');
    const comparison = await screen.findByRole('region', { name: 'dataSync.versionComparison' });
    expect(comparison).toHaveTextContent('Opening description Laptop.');
    expect(within(comparison).getByLabelText('dataSync.storedVersion')).toHaveTextContent(stored);
    fireEvent.click(within(comparison).getByRole('button', { name: 'dataSync.useStoredVersion' }));
    fireEvent.click(await screen.findByRole('button', { name: 'dataSync.confirmStoredField.confirm' }));
    await waitFor(() => expect(markdown(editor)).toBe(stored));
    expect(mountedEditor(reopened.baseElement)).toBe(editor);
    await waitFor(() => expect(harness.server.value).toMatchObject({ description: stored, bookOrTopic: 'Independent book' }));
    expect(harness.transport.send).toHaveBeenLastCalledWith(expect.objectContaining({
      changes: [expect.objectContaining({ path: ['bookOrTopic'] })],
      seriesFieldActions: { bookOrTopic: { observedRevision: returned ? 3 : 2, time: null } },
    }));
    const undone = undo(editor);
    await act(async () => { await settleEngine(); });
    fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.saveChanges' }));
    await act(async () => { await settleEngine(); await harness.engine.retry(); await settleEngine(); });
    expect(undone).toBe(false);
    expect(markdown(editor)).toBe(stored);
    expect(harness.server.value).toMatchObject({ description: stored, bookOrTopic: 'Independent book' });
    reopened.unmount();
  } finally { mockRealEditor = false; jest.restoreAllMocks(); }
});

it('displays the requested series draft when recovery immediately follows native typing', async () => {
  mockRealEditor = true;
  try {
    const { harness, Workspace, view } = setup();
    await waitFor(() => expect(screen.getByDisplayValue('Opening title')).toBeEnabled());
    typeAtEnd(mountedEditor(view.baseElement), ' Recovered');
    await act(async () => { await settleEngine(); });
    view.unmount();
    const reopened = render(<Workspace />);
    await waitFor(() => expect(screen.getByDisplayValue('Opening title')).toBeEnabled());
    const editor = mountedEditor(reopened.baseElement);
    const draft = await screen.findByRole('option', { name: 'Opening title' });
    fireEvent.change(screen.getByLabelText('dataSync.recoveryLabel'), { target: { value: draft.getAttribute('value') } });
    typeAtEnd(editor, ' Current');
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' }));
    await act(async () => { await settleEngine(); });
    expect(markdown(editor)).toBe('Opening description Recovered');
    typeAtEnd(editor, ' Later');
    await act(async () => { await settleEngine(); });
    fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.saveChanges' }));
    await act(async () => { await settleEngine(); await harness.engine.retry(); await settleEngine(); });
    expect(harness.server.value?.description).toBe('Opening description Recovered Later');
    reopened.unmount();
  } finally { mockRealEditor = false; }
});

it('C30 explicit recovery to the opening description is one undoable action over current local text', async () => {
  const originalNow = Date.now;
  mockRealEditor = true;
  try {
    const { harness, Workspace, view } = setup();
    const title = await screen.findByDisplayValue('Opening title'); await waitFor(() => expect(title).toBeEnabled());
    fireEvent.change(title, { target: { value: 'Recovered title' } });
    await act(async () => { await settleEngine(); }); view.unmount();
    const restored = render(<Workspace />);
    await waitFor(() => expect(screen.getByDisplayValue('Opening title')).toBeEnabled());
    const editor = mountedEditor(restored.baseElement);
    const choice = await screen.findByRole('option', { name: 'Opening title' });
    typeAtEnd(editor, ' Current typed words.');
    await act(async () => { await settleEngine(); });
    const before = markdown(editor);
    fireEvent.change(screen.getByLabelText('dataSync.recoveryLabel'), { target: { value: choice.getAttribute('value') } });
    const restoredAt = Date.now() + 1000;
    Date.now = () => restoredAt;
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' }));
    await waitFor(() => expect(screen.getByDisplayValue('Recovered title')).toBeEnabled());
    const arrived = markdown(editor); const result = undo(editor); const afterUndo = markdown(editor);
    expect(arrived).toBe('Opening description');
    expect(result).toBe(true);
    expect(mountedEditor(restored.baseElement)).toBe(editor);
    expect(harness.transport.send).not.toHaveBeenCalled();
    expect(afterUndo).toBe(before); restored.unmount();
  } finally { Date.now = originalNow; mockRealEditor = false; jest.restoreAllMocks(); }
});

it.each([false, true])('E16 own Series recovery stays visible through Undo, Redo, later typing and Save, overlap=%s', async overlap => {
  const originalNow = Date.now;
  mockRealEditor = true;
  try {
    const { harness, Workspace, view } = setup();
    await waitFor(() => expect(screen.getByDisplayValue('Opening title')).toBeEnabled());
    typeAtEnd(mountedEditor(view.baseElement), ' Recovered');
    await act(async () => { await settleEngine(); });
    view.unmount();
    const reopened = render(<Workspace />);
    await waitFor(() => expect(screen.getByDisplayValue('Opening title')).toBeEnabled());
    const editor = mountedEditor(reopened.baseElement);
    const choice = await screen.findByRole('option', { name: 'Opening title' });
    fireEvent.change(screen.getByLabelText('dataSync.recoveryLabel'), { target: { value: choice.getAttribute('value') } });
    const recoveredAt = Date.now() + 1000;
    Date.now = () => recoveredAt;
    typeAtEnd(editor, ' Current');
    if (!overlap) await act(async () => { await settleEngine(); });
    // Keep the requested recovery separate from the native event on production too.
    act(() => { editor.view.dispatch(closeHistory(editor.state.tr)); });
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' }));
    await act(async () => { await settleEngine(); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'workspaces.series.actions.saveChanges' })).toBeEnabled());
    expect(markdown(editor)).toBe('Opening description Recovered');
    expect(undo(editor)).toBe(true); await act(async () => { await settleEngine(); });
    expect(markdown(editor)).toBe('Opening description Current');
    expect(redo(editor)).toBe(true); await act(async () => { await settleEngine(); });
    expect(markdown(editor)).toBe('Opening description Recovered');
    act(() => { editor.view.dispatch(closeHistory(editor.state.tr)); });
    typeAtEnd(editor, ' Later'); await act(async () => { await settleEngine(); });
    expect(undo(editor)).toBe(true); await act(async () => { await settleEngine(); });
    expect(markdown(editor)).toBe('Opening description Recovered');
    expect(redo(editor)).toBe(true); await act(async () => { await settleEngine(); });
    expect(markdown(editor)).toBe('Opening description Recovered Later');
    expect(mountedEditor(reopened.baseElement)).toBe(editor);
    fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.saveChanges' }));
    await act(async () => { await settleEngine(); await harness.engine.retry(); await settleEngine(); });
    expect(harness.server.value?.description).toBe('Opening description Recovered Later');
    reopened.unmount();
  } finally { Date.now = originalNow; mockRealEditor = false; }
});

it.each([false, true])('E10 native Series typing and metadata preserve Undo, Redo and Save, separate=%s', async separate => {
  mockRealEditor = true;
  try {
    const { harness, view } = setup();
    const title = await screen.findByDisplayValue('Opening title');
    await waitFor(() => expect(title).toBeEnabled());
    const editor = mountedEditor(view.baseElement);
    // Initial production setContent can still share a history group with the first native event.
    act(() => { editor.view.dispatch(closeHistory(editor.state.tr)); });
    if (separate) {
      typeAtEnd(editor, ' A'); await act(async () => { await settleEngine(); });
      act(() => { editor.view.dispatch(closeHistory(editor.state.tr)); });
      typeAtEnd(editor, ' B');
    } else act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' A');
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' B');
    });
    await act(async () => { await settleEngine(); });
    fireEvent.change(title, { target: { value: 'Changed title' } });

    await act(async () => { await settleEngine(); });
    expect(markdown(editor)).toBe('Opening description A B');
    expect(undo(editor)).toBe(true); await act(async () => { await settleEngine(); });
    expect(markdown(editor)).toBe(separate ? 'Opening description A' : 'Opening description');
    expect(redo(editor)).toBe(true); await act(async () => { await settleEngine(); });
    expect(markdown(editor)).toBe('Opening description A B');
    expect(mountedEditor(view.baseElement)).toBe(editor);
    fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.saveChanges' }));
    await act(async () => { await settleEngine(); await harness.engine.retry(); await settleEngine(); });
    expect(harness.server.value).toMatchObject({ title: 'Changed title', description: 'Opening description A B' });
    view.unmount();
  } finally { mockRealEditor = false; }
});
