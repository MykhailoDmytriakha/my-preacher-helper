import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

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
