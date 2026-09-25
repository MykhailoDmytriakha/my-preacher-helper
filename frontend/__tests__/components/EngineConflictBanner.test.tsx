import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';

import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider, useDocumentActions } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const ON_ENGINE = 'NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS';
const resource = { collection: 'studyNotes', id: 'note-1' };
const stored = { userId: 'owner', title: 'Grace', content: 'Opening text', scriptureRefs: [], tags: [], isDraft: true, type: 'note',
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };

let actions: ReturnType<typeof useDocumentActions> | null = null;
function Actions() { const current = useDocumentActions(); useEffect(() => { actions = current; }); return null; }

function setup() {
  const harness = documentEngineHarness({ resource, value: stored, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  render(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={50} /></DataEngineProvider>);
  return harness;
}

describe('a late conflict on a document no screen has open', () => {
  beforeEach(() => { process.env[ON_ENGINE] = 'studyNotes'; actions = null; });
  afterEach(() => { delete process.env[ON_ENGINE]; });

  const conflict = async (harness: ReturnType<typeof setup>) => {
    await waitFor(() => expect(actions?.ready).toBe(true));
    harness.silentRemote({ content: 'Written on the phone' });
    await act(async () => { await actions!.commit(resource, current => ({ ...current!, content: 'Written on the laptop' })); });
    await act(async () => { await settleEngine(); await settleEngine(); });
  };

  it('shows the words this device kept and saves them when kept', async () => {
    const harness = setup();
    await conflict(harness);
    await waitFor(() => expect(screen.getByText('freshness.conflictTitle')).toBeInTheDocument());
    expect(screen.getByText(/Written on the laptop/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('freshness.conflictKeepMine')); await settleEngine(); await settleEngine(); });
    await waitFor(() => expect(harness.server.value?.content).toBe('Written on the laptop'));
    await waitFor(() => expect(screen.queryByText('freshness.conflictTitle')).not.toBeInTheDocument());
  });

  it('takes the other version when asked and leaves nothing waiting', async () => {
    const harness = setup();
    await conflict(harness);
    await waitFor(() => expect(screen.getByText('freshness.conflictTakeTheirs')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByText('freshness.conflictTakeTheirs')); await settleEngine(); await settleEngine(); });
    await waitFor(() => expect(screen.queryByText('freshness.conflictTitle')).not.toBeInTheDocument());
    expect(harness.server.value?.content).toBe('Written on the phone');
  });

  it('stays silent for a change that is only waiting for the network', async () => {
    const harness = setup();
    await waitFor(() => expect(actions?.ready).toBe(true));
    jest.mocked(harness.transport.send).mockImplementation(async () => { throw Object.assign(new TypeError('Failed to fetch'), { code: 'unavailable' }); });
    await act(async () => { await actions!.commit(resource, current => ({ ...current!, content: 'Typed offline' })); await settleEngine(); });
    expect(screen.queryByText('freshness.conflictTitle')).not.toBeInTheDocument();
  });

  it('keeps a refused change copyable and replaces it with the stored version when asked', async () => {
    const harness = setup();
    await waitFor(() => expect(actions?.ready).toBe(true));
    await act(async () => { await actions!.commit(resource, current => ({ ...current!, title: 'Refused title', content: 42 as never })); await settleEngine(); await settleEngine(); });
    await waitFor(() => expect(screen.getByText('dataSync.phase.refused')).toBeInTheDocument());
    expect(screen.getByText(/title: Refused title/)).toBeInTheDocument();
    expect(screen.getByText('freshness.copyTextAction')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('dataSync.acceptRemote')); await settleEngine(); await settleEngine(); });
    await waitFor(() => expect(screen.queryByText('dataSync.phase.refused')).not.toBeInTheDocument());
    expect(harness.server.value?.content).toBe('Opening text');
  });

  it('asks before deleting a record another device changed, and keeps it when asked', async () => {
    const harness = setup();
    await waitFor(() => expect(actions?.ready).toBe(true));
    harness.silentRemote({ content: 'Three new paragraphs from the phone' });
    await act(async () => { await actions!.remove(resource); await settleEngine(); await settleEngine(); });
    await waitFor(() => expect(screen.getByText('dataSync.deleteConflictTitle')).toBeInTheDocument());
    expect(screen.getByText(/Three new paragraphs from the phone/)).toBeInTheDocument();
    expect(screen.queryByText('freshness.conflictKeepMine')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('dataSync.keepRecord')); await settleEngine(); await settleEngine(); });
    await waitFor(() => expect(screen.queryByText('dataSync.deleteConflictTitle')).not.toBeInTheDocument());
    expect(harness.server.metadata?.deleted).toBe(false);
    expect(harness.server.value?.content).toBe('Three new paragraphs from the phone');
  });

  it('shows every draft when several wait, and offers no pick among them', async () => {
    const harness = setup();
    await waitFor(() => expect(actions?.ready).toBe(true));
    const send = jest.mocked(harness.transport.send);
    const deliver = send.getMockImplementation()!;
    send.mockImplementation(async () => { throw Object.assign(new TypeError('Failed to fetch'), { code: 'unavailable' }); });
    for (const content of ['Offline one', 'Offline two']) {
      await act(async () => { await actions!.commit(resource, current => ({ ...current!, content })); await settleEngine(); });
    }
    harness.silentRemote({ content: 'Written on the phone' });
    send.mockImplementation(deliver);
    await act(async () => { await harness.engine.retry(resource); await settleEngine(); await settleEngine(); });
    await waitFor(() => expect(screen.getByText('dataSync.severalDrafts')).toBeInTheDocument());
    expect(screen.getByText(/Offline one[\s\S]*Offline two/)).toBeInTheDocument();
    expect(screen.queryByText('freshness.conflictKeepMine')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('dataSync.acceptRemote')); await settleEngine(); await settleEngine(); });
    await waitFor(() => expect(screen.queryByText('dataSync.severalDrafts')).not.toBeInTheDocument());
    expect(harness.server.value?.content).toBe('Written on the phone');
  });

  it('keeps the words of an edit to a record deleted elsewhere copyable, with no dead "keep mine"', async () => {
    const harness = setup();
    await waitFor(() => expect(actions?.ready).toBe(true));
    harness.silentRemoteDelete();
    await act(async () => { await actions!.commit(resource, current => ({ ...current!, content: 'Typed on the laptop' })); await settleEngine(); await settleEngine(); });
    await waitFor(() => expect(screen.getByText('freshness.deletedElsewhereTitle')).toBeInTheDocument());
    expect(screen.getByText(/Typed on the laptop/)).toBeInTheDocument();
    expect(screen.queryByText('freshness.conflictKeepMine')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('freshness.discardAction')); await settleEngine(); await settleEngine(); });
    await waitFor(() => expect(screen.queryByText('freshness.deletedElsewhereTitle')).not.toBeInTheDocument());
  });
});
