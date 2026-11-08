import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { PREACH_DATE_SELECTION } from '@/components/calendar/preachDateForm';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { editorIdentity } from '@/data-engine/editorIdentity';
import { DataDocumentProvider, DataEngineProvider } from '@/data-engine/react.client';

import { documentEngineHarness, settleEngine } from '../../../../../../../test-utils/documentEngineHarness';
import { useSermonCoreDataDocument } from '../../hooks/useSermonCoreDataDocument';
import { EngineScratchWorkspace } from '../EngineScratchWorkspace';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/sermon/ScratchPanel', () => ({ __esModule: true, default: () => <div data-testid="scratch-panel" /> }));
jest.mock('@/components/sermon/EngineOutlineModal', () => ({ EngineOutlineModal: () => null }));

/**
 * ONE CONFLICT, ONE QUESTION (BUG-20261006-sermon-conflict-choice-shown-twice). On the sermon page the
 * header and the scratch workspace hold the same document — the page's provider hands both one editor —
 * so a conflict of the title form was offered twice in the scratch mode, where both are on screen.
 * The header speaks for the document's delivery; the workspace offers only its unfinished drafts.
 */
const resource = { collection: 'sermons', id: 's1' };
let core: ReturnType<typeof useSermonCoreDataDocument> | null = null;

function SermonPageStandIn() {
  core = useSermonCoreDataDocument('s1');
  // The header's own block, as SermonHeader renders it from the page's core editor.
  return <>
    <DataSyncStatus subject={core.syncSubject ?? core.recoveryIdentity} status={core.status} comparison={core.syncComparison} error={core.error}
      onKeepLocal={core.keepLocal} onAcceptRemote={core.acceptRemote} onRetry={core.retry} {...core.headerRecovery} />
    <EngineScratchWorkspace sermonId="s1" />
  </>;
}

beforeEach(() => { process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons'; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; core = null; });

it('asks once about a title conflict while the header and the scratch workspace are both on screen', async () => {
  const harness = documentEngineHarness({ resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
    value: { userId: 'owner', title: 'Base', scratch: [] } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  render(<DataEngineProvider><DataDocumentProvider resource={resource} options={{ slot: 'sermon', readOnlyCopy: true }}>
    <SermonPageStandIn />
  </DataDocumentProvider></DataEngineProvider>);
  await waitFor(() => expect(core?.titleForm.loading).toBe(false));
  await screen.findByTestId('scratch-panel');

  // His title, typed here, while another device saved a different one.
  await act(async () => { await core!.titleBinding.begin(); await core!.titleBinding.update('Mine'); });
  await act(async () => { await harness.remote({ title: 'Theirs' }); });
  await act(async () => { await core!.titleBinding.save('Mine').catch(() => undefined); await settleEngine(); });

  await waitFor(() => expect(screen.getAllByRole('button', { name: 'freshness.conflictKeepMine' })).toHaveLength(1));
  expect(screen.getAllByRole('button', { name: 'freshness.conflictTakeTheirs' })).toHaveLength(1);
});


it('offers explicit title recovery on a fresh sermon page after a saved offline change conflicts', async () => {
  const harness = documentEngineHarness({ resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
    value: { userId: 'owner', title: 'Base', scratch: [] } });
  const original = harness.createBrowser(), continuation = harness.createBrowser();
  original.engine.setOnline(false); original.engine.setOwner('owner');
  continuation.engine.setOnline(false); continuation.engine.setOwner('owner');
  try {
    const sourceEditor = await original.engine.openEditor(resource, editorIdentity('original-tab', resource, 'sermon', 'source'));
    const source = sourceEditor.form('title', [['title']]);
    await source.begin(); await source.save(value => ({ ...value, title: 'Mine' }));
    const second = await continuation.engine.openEditor(resource, editorIdentity('later-tab', resource, 'sermon', 'later'));
    const later = second.form('title', [['title']]);
    await later.begin(); await later.save(value => ({ ...value, title: 'Later draft' }));
    continuation.dispose();
    harness.silentRemote({ title: 'Theirs' });
    original.engine.setOnline(true); await original.engine.retry();
    await waitFor(() => expect(sourceEditor.getState().result?.kind).toBe('conflict'));
    original.dispose();

    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    render(<DataEngineProvider><DataDocumentProvider resource={resource} options={{ slot: 'sermon', readOnlyCopy: true }}>
      <SermonPageStandIn />
    </DataDocumentProvider></DataEngineProvider>);
    const picker = await screen.findByRole('combobox', { name: 'dataSync.recoveryLabel' });
    const option = await screen.findByRole('option', { name: 'Base' });
    expect(screen.queryByRole('button', { name: 'freshness.conflictKeepMine' })).not.toBeInTheDocument();
    fireEvent.change(picker, { target: { value: (option as HTMLOptionElement).value } });
    expect(screen.getByText('Mine')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' }));
    await screen.findByRole('region', { name: 'dataSync.versionComparison' });
    expect(screen.queryByRole('combobox', { name: 'dataSync.recoveryLabel' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'freshness.conflictKeepMine' }));
    await waitFor(() => expect(harness.server).toMatchObject({ value: { title: 'Mine' }, metadata: { revision: 3 } }));
    const preserved = await screen.findByRole('option', { name: 'Later draft' });
    expect(screen.getAllByRole('combobox', { name: 'dataSync.recoveryLabel' })).toHaveLength(1);
    fireEvent.change(screen.getByRole('combobox', { name: 'dataSync.recoveryLabel' }),
      { target: { value: (preserved as HTMLOptionElement).value } });
    expect(screen.getByRole('button', { name: 'dataSync.recover' })).toBeEnabled();
    expect(harness.server.value?.title).toBe('Mine');
  } finally { original.dispose(); continuation.dispose(); }
});


it('still offers an ordinary unsent sermon draft without changes in Scratch', async () => {
  const base = { resource, metadata: { protocol: 1 as const, generation: 'g', revision: 1, deleted: false },
    value: { userId: 'owner', title: 'Earlier sermon', scratch: [] } };
  const harness = documentEngineHarness(base);
  await harness.checkpoints.create({
    owner: 'owner', editorId: editorIdentity('original-tab', resource, 'sermon', 'ordinary-draft'),
    prepared: null, unfinalized: [],
    checkpoint: { confirmed: base, draft: { ...base.value, preparation: { thesis: 'Private preparation text' } },
      dirty: true, editGeneration: 1, remoteCandidate: null, conflicts: [], pending: {} },
  });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  render(<DataEngineProvider><DataDocumentProvider resource={resource} options={{ slot: 'sermon', readOnlyCopy: true }}>
    <SermonPageStandIn />
  </DataDocumentProvider></DataEngineProvider>);
  await screen.findByRole('option', { name: 'Earlier sermon' });
});


it.each(['local', 'stored', 'newer-stored'])('shows both preaching days and keeps the %s day without losing a note', async choice => {
  const date = { id: 'first', date: '2026-12-13', createdAt: '2026-11-08T00:00:00.000Z',
    status: 'planned', church: { id: 'chapel', name: 'Chapel' }, notes: 'Original note' };
  const other = { ...date, id: 'other', date: '2027-01-03' };
  const harness = documentEngineHarness({ resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
    value: { userId: 'owner', title: 'Sermon', preachDates: [date, other], scratch: [] } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  render(<DataEngineProvider><DataDocumentProvider resource={resource} options={{ slot: 'sermon', readOnlyCopy: true }}>
    <SermonPageStandIn />
  </DataDocumentProvider></DataEngineProvider>);
  await waitFor(() => expect(core?.titleForm.recoveryReady).toBe(true));
  const form = core!.getManualForm('preach-date:edit:first', PREACH_DATE_SELECTION);
  await act(async () => { await form.begin(); });
  const localNote = choice !== 'local' ? 'New note on this device' : date.notes;
  const storedNote = choice === 'local' ? 'New note from the other device' : date.notes;
  harness.silentRemote({ preachDates: [{ ...date, date: '2026-12-27', notes: storedNote }, other] });
  await act(async () => {
    await form.save(current => ({ ...current, preachDates: [{ ...date, date: '2026-12-20', notes: localNote }, other] }));
    await settleEngine();
  });

  const comparison = await screen.findByRole('region', { name: 'dataSync.versionComparison' });
  expect(comparison).toHaveTextContent('Dec 20, 2026');
  expect(comparison).toHaveTextContent('Dec 27, 2026');
  expect(comparison).not.toHaveTextContent('Jan 3, 2027');
  fireEvent.click(screen.getByRole('button', { name: choice === 'local' ? 'dataSync.useLocalVersion' : 'dataSync.useStoredVersion' }));
  if (choice === 'newer-stored') {
    await screen.findByRole('button', { name: 'dataSync.confirmStoredField.confirm' });
    await act(async () => { await harness.remote({ preachDates: [{ ...date, date: '2027-01-05' }, other] }); });
    await waitFor(() => expect(core!.remote?.value?.preachDates).toContainEqual(expect.objectContaining({ date: '2027-01-05' })));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'dataSync.confirmStoredField.confirm' })).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'dataSync.versionComparison' })).toHaveTextContent('Jan 5, 2027');
    expect(harness.server.value?.preachDates).toContainEqual(expect.objectContaining({ date: '2027-01-05', notes: 'Original note' }));
    expect(core!.state?.checkpoint.draft?.preachDates).toContainEqual(expect.objectContaining({ date: '2026-12-20', notes: localNote }));
    return;
  }
  if (choice === 'stored') fireEvent.click(await screen.findByRole('button', { name: 'dataSync.confirmStoredField.confirm' }));
  await waitFor(() => expect(harness.server.value?.preachDates).toEqual([
    { ...date, date: choice === 'local' ? '2026-12-20' : '2026-12-27', notes: choice === 'local' ? storedNote : localNote }, other,
  ]));
});


it.each([false, true])('shows the draft note when its preaching date was deleted (also marked as preached: %s)', async mark => {
  const date = { id: 'first', date: '2026-12-13', createdAt: '2026-11-08T00:00:00.000Z',
    status: 'planned', church: { id: 'chapel', name: 'Chapel' }, notes: 'Old note' };
  const other = { ...date, id: 'other', date: '2027-01-03' };
  const harness = documentEngineHarness({ resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
    value: { userId: 'owner', title: 'Sermon', preachDates: [date, other], isPreached: false, scratch: [] } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  render(<DataEngineProvider><DataDocumentProvider resource={resource} options={{ slot: 'sermon', readOnlyCopy: true }}>
    <SermonPageStandIn />
  </DataDocumentProvider></DataEngineProvider>);
  await waitFor(() => expect(core?.titleForm.recoveryReady).toBe(true));
  const form = core!.getManualForm(mark ? 'preach-date:mark:first' : 'preach-date:edit:first', PREACH_DATE_SELECTION);
  await act(async () => { await form.begin(); });
  harness.silentRemote({ preachDates: [other] });
  const note = 'My note on the deleted preaching date.';
  await act(async () => {
    await form.save(current => ({ ...current, isPreached: mark,
      preachDates: [{ ...date, notes: note, status: mark ? 'preached' : date.status }, other] }),
    mark ? { preachStatus: { status: 'preached', rowId: date.id, time: null } } : undefined);
    await settleEngine();
  });

  const comparison = await screen.findByRole('region', { name: 'dataSync.versionComparison' });
  expect(comparison).toHaveTextContent(note);
  expect(comparison).toHaveTextContent('calendar.preachingDateRemoved');
  expect(comparison).not.toHaveTextContent('Jan 3, 2027');
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.keepDraft' }));
  await screen.findByText('dataSync.failure.preachDateEditsRetained');
  expect(harness.server.value?.preachDates).toEqual([other]);
  expect(core!.state?.checkpoint.draft?.preachDates).toContainEqual(expect.objectContaining({ id: date.id, notes: note }));
});
