import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
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
    <DataSyncStatus subject={core.recoveryIdentity} status={core.status} error={core.error}
      onKeepLocal={core.keepLocal} onAcceptRemote={core.acceptRemote} onRetry={core.retry} />
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
