import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { EngineScratchWorkspace } from '@/(pages)/(private)/sermons/[id]/components/EngineScratchWorkspace';
import { useScratchDataDocument } from '@/(pages)/(private)/sermons/[id]/hooks/useScratchDataDocument';
import { SERMON_WORKSPACE_SLOT } from '@/(pages)/(private)/sermons/[id]/hooks/useSermonCoreDataDocument';
import { sermonConflictComparison } from '@/components/sermon/sermonConflictComparison';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { DataDocumentProvider, DataEngineProvider } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';
import { useTranslation } from '@locales/useTranslation';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'sermons', id: 'sermon-1' };
const note = { id: 'note-a', text: 'Opening words', createdAt: '2026-09-12' };
const sibling = { id: 'note-b', text: 'Another note', createdAt: '2026-09-13' };
const mine = 'Words typed in the open field';
const stored = 'Words saved by the other device';

const sketch = (noteId: string) => within(screen.getByTestId(`scratch-sketch-${noteId}`));
const scratchEditor = (noteId: string) => sketch(noteId).getByRole('textbox');

async function beginScratchEdit(noteId: string) {
  const card = within(await screen.findByTestId(`scratch-sketch-${noteId}`));
  const edit = card.getByRole('button', { name: 'scratch.card.edit' });
  await waitFor(() => expect(edit).toBeEnabled());
  fireEvent.click(edit);
  return card.findByRole('textbox');
}

function ScratchChronologyWorkspace() {
  const scratch = useScratchDataDocument(resource.id);
  const { t, language } = useTranslation();
  const checkpoint = scratch.state?.checkpoint;
  const comparison = checkpoint && sermonConflictComparison(checkpoint, t, language);
  return <>
    <output data-testid="confirmed-copy">{JSON.stringify(scratch.confirmed?.value?.scratch)}</output>
    <output data-testid="save-phase">{scratch.status?.phase}</output>
    <DataSyncStatus subject={scratch.recoveryIdentity} status={scratch.status} comparison={comparison}
      onKeepLocal={() => scratch.keepLocal(checkpoint)} onAcceptRemote={() => scratch.acceptRemote(checkpoint)} />
    <button type="button" onClick={async () => {
      const [copy] = await scratch.listRecoverable({ manualChoiceCopies: 'only' });
      if (copy) await scratch.recover(copy.id);
    }}>Recover queued edit</button>
    <EngineScratchWorkspace sermonId={resource.id} />
  </>;
}

describe('opening text of an inline scratch edit', () => {
  beforeEach(() => { process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons'; });
  afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

  async function open(legacy = false) {
    const harness = documentEngineHarness({ resource, value: { userId: 'owner', title: 'Sermon', verse: 'John 3:16',
      createdAt: '2026-09-01T00:00:00.000Z', thoughts: [], scratch: [note, sibling] },
      metadata: legacy ? null : { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    render(
      <DataEngineProvider>
        <DataDocumentProvider resource={resource} options={{ slot: SERMON_WORKSPACE_SLOT, readOnlyCopy: true }}>
          <ScratchChronologyWorkspace />
        </DataDocumentProvider>
      </DataEngineProvider>,
    );
    fireEvent.change(await beginScratchEdit(note.id), { target: { value: mine } });
    return harness;
  }

  it('holds both changed versions even when the stored text reached the editor before Enter', async () => {
    const harness = await open();
    await act(async () => { await harness.remote({ scratch: [{ ...note, text: stored }, sibling] }); });
    await waitFor(() => expect(screen.getByTestId('confirmed-copy')).toHaveTextContent(stored));
    expect(scratchEditor(note.id)).toHaveValue(mine);
    fireEvent.keyDown(scratchEditor(note.id), { key: 'Enter' });
    await waitFor(() => expect(harness.transport.send).toHaveBeenCalled());
    await act(settleEngine);

    expect(harness.server.value?.scratch).toEqual([{ ...note, text: stored }, sibling]);
    await waitFor(() => expect(screen.getByTestId('save-phase')).toHaveTextContent('conflict'));
    expect(screen.getByLabelText('dataSync.yourVersion')).toHaveTextContent(mine);
    expect(screen.getByLabelText('dataSync.storedVersion')).toHaveTextContent(stored);
  });

  it('keeps both versions if another device makes the first tracked save to an older sermon', async () => {
    const harness = await open(true);
    await act(async () => {
      const answer = await harness.transport.send({ protocol: 1, kind: 'update', operationId: 'first-save',
        owner: 'owner', resource, generation: null, dependsOn: [], changes: [{ path: ['scratch'],
          before: { exists: true, value: [note, sibling] }, after: { exists: true, value: [{ ...note, text: stored }, sibling] },
        }] });
      expect(answer.kind).toBe('acknowledged');
      await harness.engine.retry(resource);
    });
    await waitFor(() => expect(screen.getByTestId('confirmed-copy')).toHaveTextContent(stored));
    fireEvent.keyDown(scratchEditor(note.id), { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('save-phase')).toHaveTextContent('conflict'));
    expect(screen.getByLabelText('dataSync.yourVersion')).toHaveTextContent(mine);
    expect(screen.getByLabelText('dataSync.storedVersion')).toHaveTextContent(stored);
  });

  it.each(['my', 'saved'])('uses the %s version without losing independent saved words', async (choice) => {
    const harness = await open();
    const editedSibling = { ...sibling, text: 'Independent saved words' };
    await act(async () => { await harness.remote({ scratch: [{ ...note, text: stored }, editedSibling] }); });
    await waitFor(() => expect(screen.getByTestId('confirmed-copy')).toHaveTextContent(editedSibling.text));
    fireEvent.keyDown(scratchEditor(note.id), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: choice === 'my' ? 'dataSync.useLocalVersion' : 'dataSync.useStoredVersion' }));
    if (choice === 'saved') {
      const confirm = await screen.findByRole('dialog', { name: 'dataSync.confirmStoredField.title' });
      fireEvent.click(within(confirm).getByRole('button', { name: 'dataSync.confirmStoredField.confirm' }));
    }
    const kept = choice === 'my' ? mine : stored;
    await waitFor(() => expect(harness.server.value?.scratch).toEqual([{ ...note, text: kept }, editedSibling]));
    await waitFor(() => expect(screen.getByTestId('save-phase')).toHaveTextContent('saved'));
    expect(sketch(note.id).getByText(kept)).toBeVisible();
  });

  it('asks again for a separately queued note after choosing the saved text of the first note', async () => {
    const harness = await open();
    const secondMine = 'Second edit queued by the phone';
    const secondStored = 'Second edit saved on the desktop';
    await act(async () => harness.engine.setOnline(false));
    fireEvent.keyDown(scratchEditor(note.id), { key: 'Enter' });
    await waitFor(() => expect(sketch(note.id).queryByRole('textbox')).not.toBeInTheDocument());
    fireEvent.change(await beginScratchEdit(sibling.id), { target: { value: secondMine } });
    fireEvent.keyDown(scratchEditor(sibling.id), { key: 'Enter' });
    await waitFor(async () => expect(await harness.commits.list('owner')).toHaveLength(2));
    harness.silentRemote({ scratch: [{ ...note, text: stored }, { ...sibling, text: secondStored }] });
    await act(async () => { harness.engine.setOnline(true); await settleEngine(); });
    const saved = await screen.findByRole('button', { name: 'dataSync.useStoredVersion' });
    fireEvent.click(saved);
    const confirm = await screen.findByRole('dialog', { name: 'dataSync.confirmStoredField.title' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'dataSync.confirmStoredField.confirm' }));
    await waitFor(() => expect(screen.queryByLabelText('dataSync.yourVersion')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Recover queued edit' }));
    expect(await screen.findByLabelText('dataSync.yourVersion')).toHaveTextContent(secondMine);
    expect(screen.getByLabelText('dataSync.storedVersion')).toHaveTextContent(secondStored);
    expect(harness.server.value?.scratch).toEqual([{ ...note, text: stored }, { ...sibling, text: secondStored }]);
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.useLocalVersion' }));
    await waitFor(() => expect(harness.server.value?.scratch).toEqual([{ ...note, text: stored }, { ...sibling, text: secondMine }]));
  });

  it('keeps a different field on the same note and a neighboring note while saving the edited text', async () => {
    const harness = await open();
    const openedField = scratchEditor(note.id);
    const moved = { ...note, section: 'conclusion' };
    const editedSibling = { ...sibling, text: 'Independently updated note' };
    await act(async () => { await harness.remote({ scratch: [moved, editedSibling] }); });
    await waitFor(() => expect(screen.getByTestId('confirmed-copy')).toHaveTextContent(editedSibling.text));
    expect(scratchEditor(note.id)).toBe(openedField);
    expect(openedField).toHaveValue(mine);
    fireEvent.keyDown(openedField, { key: 'Enter' });
    await waitFor(() => expect(harness.server.value?.scratch).toEqual([{ ...moved, text: mine }, editedSibling]));
    const conclusion = screen.getByLabelText('structure.conclusion', { selector: 'div' });
    expect(await within(conclusion).findByText(mine)).toBeVisible();
  });

  it('shows the saved placement after cancelling the local text edit', async () => {
    const harness = await open();
    const moved = { ...note, section: 'conclusion' };
    await act(async () => { await harness.remote({ scratch: [moved, sibling] }); });
    await waitFor(() => expect(screen.getByTestId('confirmed-copy')).toHaveTextContent('conclusion'));
    const editor = scratchEditor(note.id);
    expect(editor).toHaveValue(mine);

    fireEvent.keyDown(editor, { key: 'Escape' });
    const conclusion = screen.getByLabelText('structure.conclusion', { selector: 'div' });
    expect(await within(conclusion).findByText(note.text)).toBeVisible();
    expect(sketch(note.id).queryByRole('textbox')).not.toBeInTheDocument();
    expect(harness.server.value?.scratch).toEqual([moved, sibling]);
    expect(harness.transport.send).not.toHaveBeenCalled();
  });
});
