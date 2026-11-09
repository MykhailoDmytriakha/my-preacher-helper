import { relationRebaseHarness } from '@test-utils/relationRebaseHarness';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';

import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider, isOneShotRecord, useDataDocument, useDocumentActions } from '@/data-engine/react.client';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { editorIdentity } from '@/data-engine/editorIdentity';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import type { DocumentData } from '@/data-engine/types';
import type { CommitRequest } from '@/data-engine/commits';
import type { ManagedEditor } from '@/data-engine/engine';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let mockPathname = '/dashboard';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));

const ON_ENGINE = 'NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS';
const resource = { collection: 'studyNotes', id: 'note-1' };
const stored = { userId: 'owner', title: 'Grace', content: 'Opening text', scriptureRefs: [], tags: [], isDraft: true, type: 'note',
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
const confirmTextAction = async (label: string, confirmation = 'common.discardText.confirm') => {
  fireEvent.click(screen.getByText(label));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: confirmation }));
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });
  await act(async () => { await settleEngine(); await settleEngine(); });
};
const confirmDeleteAction = async (label: string) => {
  fireEvent.click(screen.getByText(label));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });
  await act(async () => { await settleEngine(); await settleEngine(); });
};
const waitForRemoteCandidate = async (harness: ReturnType<typeof documentEngineHarness>, content: string) => {
  await waitFor(async () => {
    const records = await harness.engine.listRecoverable();
    expect(records.some(({ record }) => record.checkpoint.remoteCandidate?.value?.content === content)).toBe(true);
  });
  // Let the banner's polling read publish the checkpoint just observed in the harness.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
};

let actions: ReturnType<typeof useDocumentActions> | null = null;
function Actions() { const current = useDocumentActions(); useEffect(() => { actions = current; }); return null; }

function setup(pollMs = 50) {
  const harness = documentEngineHarness({ resource, value: stored, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  render(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={pollMs} /></DataEngineProvider>);
  return harness;
}

it('shows both names when a single template rename needs a decision', async () => {
  process.env[ON_ENGINE] = 'planTemplates';
  actions = null;
  const template = { collection: 'planTemplates', id: 'template-1' };
  const structure = { introduction: [], main: [{ id: 'keep', text: 'Keep this point' }], conclusion: [] };
  const h = documentEngineHarness({ resource: template,
    value: { userId: 'owner', name: 'Opening template', structure, createdAt: '2026-11-08', updatedAt: '2026-11-08' },
    metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
  jest.mocked(createBrowserDataEngine).mockImplementation(h.createBrowser);
  try {
    render(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={50} /></DataEngineProvider>);
    await waitFor(() => expect(actions?.ready).toBe(true));
    h.silentRemote({ name: 'Saved template name' });
    await act(async () => {
      await actions!.commit(template, current => ({ ...current!, name: 'My template name' }));
      await settleEngine();
    });
    await screen.findByText('freshness.conflictTitle');
    expect(screen.getByRole('region', { name: 'dataSync.versionComparison' })).toBeInTheDocument();
    expect(screen.getByLabelText('dataSync.yourVersion')).toHaveTextContent('My template name');
    expect(screen.getByLabelText('dataSync.storedVersion')).toHaveTextContent('Saved template name');
    await confirmTextAction('dataSync.useStoredVersion', 'dataSync.confirmStoredField.confirm');
    expect(h.server.value).toMatchObject({ name: 'Saved template name', structure });
  } finally {
    delete process.env[ON_ENGINE];
  }
});

describe('a late conflict on a document no screen has open', () => {
  beforeEach(() => { process.env[ON_ENGINE] = 'studyNotes'; actions = null; });
  afterEach(() => { delete process.env[ON_ENGINE]; });

  const conflict = async (harness: ReturnType<typeof setup>) => {
    await waitFor(() => expect(actions?.ready).toBe(true));
    harness.silentRemote({ content: 'Written on the phone' });
    await act(async () => { await actions!.commit(resource, current => ({ ...current!, content: 'Written on the laptop' })); });
    await act(async () => { await settleEngine(); await settleEngine(); });
    await waitForRemoteCandidate(harness, 'Written on the phone');
  };

  it.each(['mine', 'stored'] as const)('refreshes a newly answered request before the first %s choice without waiting for the poll', async choice => {
    const harness = setup(60_000);
    await waitFor(() => expect(actions?.ready).toBe(true));
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const compareAndSet = harness.commits.compareAndSet.bind(harness.commits);
    let held = false;
    const transition = jest.spyOn(harness.commits, 'compareAndSet').mockImplementation(async (previous, next) => {
      if (!held && next.state === 'conflict') { held = true; await blocked; }
      return compareAndSet(previous, next);
    });
    try {
      harness.silentRemote({ content: 'Written on the phone' });
      await act(async () => { await actions!.commit(resource, current => ({ ...current!, content: 'Written on the laptop' })); await settleEngine(); });
      await waitFor(() => expect(screen.getByText('freshness.conflictTitle')).toBeInTheDocument());
      expect(held).toBe(true);
      await act(async () => { release(); await settleEngine(); await settleEngine(); });
      expect((await harness.commits.list('owner'))[0].state).toBe('conflict');
      if (choice === 'mine') {
        await act(async () => { fireEvent.click(screen.getByText('freshness.conflictKeepMine')); await settleEngine(); await settleEngine(); });
        await waitFor(() => expect(harness.server.value?.content).toBe('Written on the laptop'));
      } else {
        await confirmTextAction('freshness.conflictTakeTheirs');
        expect(harness.server.value?.content).toBe('Written on the phone');
      }
      await waitFor(() => expect(screen.queryByText('freshness.conflictTitle')).not.toBeInTheDocument());
      expect(await harness.engine.listRecoverable(resource)).toHaveLength(0);
      expect(await harness.engine.listPending()).toHaveLength(0);
    } finally { release(); transition.mockRestore(); }
  });

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
    await confirmTextAction('freshness.conflictTakeTheirs');
    await waitFor(() => expect(screen.queryByText('freshness.conflictTitle')).not.toBeInTheDocument());
    expect(harness.server.value?.content).toBe('Written on the phone');
  });

  it('withdraws acceptance when the same checkpoint has newer draft words at the final storage read', async () => {
    const harness = setup();
    await conflict(harness);
    await waitFor(() => expect(screen.getByText('freshness.conflictTakeTheirs')).toBeInTheDocument());
    fireEvent.click(screen.getByText('freshness.conflictTakeTheirs'));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    const [checkpoint] = await harness.engine.listRecoverable();
    if (!checkpoint) throw new Error('Expected the settled conflict checkpoint');
    const latestRead = [{ ...checkpoint, record: { ...checkpoint.record,
      checkpoint: { ...checkpoint.record.checkpoint,
        draft: { ...checkpoint.record.checkpoint.draft!, content: 'A newer draft from another editor' } } } }];
    const resolve = jest.spyOn(actions!, 'resolve');
    const readRecoverable = jest.spyOn(harness.engine, 'listRecoverable').mockResolvedValueOnce(latestRead);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'common.discardText.confirm' }));
      for (let index = 0; index < 20; index += 1) await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(resolve).not.toHaveBeenCalled();
    readRecoverable.mockRestore();
    resolve.mockRestore();
    const [retained] = await harness.engine.listRecoverable();
    expect(retained.record.checkpoint.draft?.content).toBe('Written on the laptop');
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
    expect(screen.getByText(/legacyRecovery\.field\.title: Refused title/)).toBeInTheDocument();
    expect(screen.getByText('freshness.copyTextAction')).toBeInTheDocument();
    await confirmTextAction('dataSync.acceptRemote');
    await waitFor(() => expect(screen.queryByText('dataSync.phase.refused')).not.toBeInTheDocument());
    expect(harness.server.value?.content).toBe('Opening text');
  });

  // BUG-20261107-outdated-tab-refusal-unexplained: the app-wide notice of a refusal says the way out on a tab older than the server.
  it('adds the reload way out to a refused change when this tab is older than the server', async () => {
    const originalVersion = process.env.NEXT_PUBLIC_APP_VERSION;
    const originalFetch = global.fetch;
    process.env.NEXT_PUBLIC_APP_VERSION = '391f890';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '9eac14b' }) }) as unknown as typeof fetch;
    try {
      setup();
      await waitFor(() => expect(actions?.ready).toBe(true));
      await act(async () => { await actions!.commit(resource, current => ({ ...current!, title: 'Refused title', content: 42 as never })); await settleEngine(); await settleEngine(); });
      await waitFor(() => expect(screen.getByText('dataSync.phase.refused')).toBeInTheDocument());
      expect(await screen.findByText('dataSync.outdatedTab.body')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'dataSync.outdatedTab.action' })).toBeInTheDocument();
      expect(screen.getByText('freshness.copyTextAction')).toBeInTheDocument();
    } finally {
      process.env.NEXT_PUBLIC_APP_VERSION = originalVersion;
      global.fetch = originalFetch;
    }
  });

  // Several refused drafts of one document are presented as `several`; the refusal still says the reload way out (Codex review, 07.11).
  it('adds the reload way out when several drafts of one document were all refused on an outdated tab', async () => {
    const originalVersion = process.env.NEXT_PUBLIC_APP_VERSION;
    const originalFetch = global.fetch;
    process.env.NEXT_PUBLIC_APP_VERSION = '391f890';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version: '9eac14b' }) }) as unknown as typeof fetch;
    try {
      const harness = setup();
      await waitFor(() => expect(actions?.ready).toBe(true));
      const send = jest.mocked(harness.transport.send);
      send.mockImplementation(async () => { throw Object.assign(new TypeError('Failed to fetch'), { code: 'unavailable' }); });
      for (const content of ['Offline one', 'Offline two']) {
        await act(async () => { await actions!.commit(resource, current => ({ ...current!, content })); await settleEngine(); });
      }
      send.mockImplementation(async command => ({ kind: 'refused', operationId: command.operationId, code: 'decision-required' }));
      await act(async () => { await harness.engine.retry(resource); await settleEngine(); await settleEngine(); });
      await waitFor(() => expect(screen.getByText('dataSync.severalDrafts')).toBeInTheDocument());
      expect(await screen.findByText('dataSync.outdatedTab.body')).toBeInTheDocument();
    } finally {
      process.env.NEXT_PUBLIC_APP_VERSION = originalVersion;
      global.fetch = originalFetch;
    }
  });

  it('asks before deleting a record another device changed, and keeps it when asked', async () => {
    const harness = setup();
    await waitFor(() => expect(actions?.ready).toBe(true));
    harness.silentRemote({ content: 'Three new paragraphs from the phone' });
    await act(async () => { await actions!.remove(resource); await settleEngine(); await settleEngine(); });
    await waitFor(() => expect(screen.getByText('dataSync.deleteConflictTitle')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/Three new paragraphs from the phone/)).toBeInTheDocument());
    expect(screen.queryByText('freshness.conflictKeepMine')).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('dataSync.keepRecord')); await settleEngine(); await settleEngine(); });
    await waitFor(() => expect(screen.queryByText('dataSync.deleteConflictTitle')).not.toBeInTheDocument());
    expect(harness.server.metadata?.deleted).toBe(false);
    expect(harness.server.value?.content).toBe('Three new paragraphs from the phone');
  });

  it('names a refused deletion as a refusal, not as another device, and deletes when retried', async () => {
    const harness = setup();
    await waitFor(() => expect(actions?.ready).toBe(true));
    jest.mocked(harness.transport.send).mockImplementationOnce(async command => ({ kind: 'refused', operationId: command.operationId, code: 'related-collection-not-enabled' }));
    await act(async () => { await actions!.remove(resource); await settleEngine(); await settleEngine(); });
    await waitFor(() => expect(screen.getByText('dataSync.deleteRefusedTitle')).toBeInTheDocument());
    expect(screen.queryByText('dataSync.deleteConflictTitle')).not.toBeInTheDocument();
    expect(screen.getByText('dataSync.keepRecord')).toBeInTheDocument();
    await confirmDeleteAction('dataSync.retryDelete');
    await waitFor(() => expect(screen.queryByText('dataSync.deleteRefusedTitle')).not.toBeInTheDocument());
    expect(harness.server.metadata?.deleted).toBe(true);
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
    await waitForRemoteCandidate(harness, 'Written on the phone');
    await waitFor(() => expect(screen.getByText('dataSync.severalDrafts')).toBeInTheDocument());
    expect(screen.getByText(/Offline one[\s\S]*Offline two/)).toBeInTheDocument();
    expect(screen.queryByText('freshness.conflictKeepMine')).not.toBeInTheDocument();
    await confirmTextAction('dataSync.acceptRemote');
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
    await confirmTextAction('freshness.discardAction');
    await waitFor(() => expect(screen.queryByText('freshness.deletedElsewhereTitle')).not.toBeInTheDocument());
  });
});

/**
 * A SERMON'S ONE-SHOT CHANGES WERE ANSWERED NOWHERE (BUG-20260813-late-refusal-silent-after-navigation).
 *
 * A link made from a note, a delete from the list, a sermon born from a note: each is a one-shot
 * action with no open editor, but the banner chose by a fixed list of collections that left
 * sermons out. It now chooses by what left the draft. A screen editor's draft of the same sermon
 * is that screen's to decide: the banner shows it with the way there, never settles it, and is
 * silent on that screen, which says it itself.
 */
describe('a late answer to a one-shot change of a sermon', () => {
  const sermon = { collection: 'sermons', id: 'sermon-1' };
  const storedSermon = { userId: 'owner', title: 'Grace', verse: 'John 1:14', date: '2026-09-01', thoughts: [],
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
  beforeEach(() => { process.env[ON_ENGINE] = 'sermons'; actions = null; mockPathname = '/dashboard'; });
  afterEach(() => { delete process.env[ON_ENGINE]; });

  const setupSermon = (value: DocumentData = storedSermon) => {
    const harness = documentEngineHarness({ resource: sermon, value, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    const view = render(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={50} /></DataEngineProvider>);
    return Object.assign(harness, { view });
  };

  it('is shown app-wide, like the other collections', async () => {
    const harness = setupSermon();
    await waitFor(() => expect(actions?.ready).toBe(true));
    harness.silentRemote({ title: 'Renamed on the phone' });
    await act(async () => { await actions!.commit(sermon, current => ({ ...current!, title: 'Renamed from the note' })); await settleEngine(); await settleEngine(); });
    await waitFor(() => expect(screen.getByText('freshness.conflictTitle')).toBeInTheDocument());
    expect(screen.getByText(/Renamed from the note/)).toBeInTheDocument();
  });

  /** The sermon page's own editor, refused (a date that is not a date) and closed before the answer was read. */
  const screenDraftLeftBehind = async (harness: ReturnType<typeof setupSermon>, suffix = 'page') => {
    const screenEditor = await harness.engine.openEditor(sermon, editorIdentity('test-tab', sermon, 'default', suffix));
    await act(async () => { await screenEditor.edit({ ...storedSermon, verse: 'Typed on the sermon page', date: 8 as never }); await screenEditor.save(); await settleEngine(); await settleEngine(); });
    screenEditor.close({ flush: false });
    await act(async () => { await settleEngine(); });
  };

  it('decides a one-shot change here and leaves the screen\'s own words to that screen', async () => {
    const harness = setupSermon();
    await waitFor(() => expect(actions?.ready).toBe(true));
    // A one-shot change the server will not take...
    await act(async () => { await actions!.commit(sermon, current => ({ ...current!, title: 'Renamed from the note', date: 7 as never })); await settleEngine(); await settleEngine(); });
    // ...and the sermon page's own editor, refused the same way, left before the answer.
    await screenDraftLeftBehind(harness);

    // The one-shot change is decided here first; the page's words are not taken as decided with it.
    await waitFor(() => expect(screen.getByText('dataSync.phase.refused')).toBeInTheDocument());
    expect(screen.getByText(/Renamed from the note/)).toBeInTheDocument();
    expect(screen.queryByText(/Typed on the sermon page/)).not.toBeInTheDocument();
    await confirmTextAction('dataSync.acceptRemote');
    await waitFor(() => expect(screen.queryByText(/Renamed from the note/)).not.toBeInTheDocument());

    const left = await harness.engine.listRecoverable(sermon);
    expect(left.map(({ record }) => record.checkpoint.draft?.verse)).toContain('Typed on the sermon page');
  });

  it('points to the screen that decides a draft refused after the person left it', async () => {
    const harness = setupSermon();
    await waitFor(() => expect(actions?.ready).toBe(true));
    await screenDraftLeftBehind(harness);

    await waitFor(() => expect(screen.getByText(/Typed on the sermon page/)).toBeInTheDocument());
    expect(screen.getByText('dataSync.phase.refused')).toBeInTheDocument();
    expect(screen.getByText('dataSync.screenDraftBody')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'dataSync.openToDecide' })).toHaveAttribute('href', '/sermons/sermon-1');
    // Keeping the words needs the screen's editor; taking the stored version does not (owner, 2026-10-13).
    expect(screen.getByText('dataSync.acceptRemote')).toBeInTheDocument();
    expect(screen.queryByText('freshness.conflictKeepMine')).not.toBeInTheDocument();
  });

  /** BUG-20261013-screen-draft-notice-offers-no-choice: the notice stood on every page with nothing to decide. */
  it('takes the stored version from any page, and the refused draft does not come back', async () => {
    const harness = setupSermon();
    await waitFor(() => expect(actions?.ready).toBe(true));
    await screenDraftLeftBehind(harness);
    await waitFor(() => expect(screen.getByText(/Typed on the sermon page/)).toBeInTheDocument());

    await confirmTextAction('dataSync.acceptRemote');
    await waitFor(() => expect(screen.queryByText(/Typed on the sermon page/)).not.toBeInTheDocument());
    expect(await harness.engine.listRecoverable(sermon)).toHaveLength(0);
    expect((await harness.engine.listPending()).filter(entry => entry.state === 'refused')).toHaveLength(0);

    // The screen opened again starts from the stored version, with nothing refused to answer.
    const reopened = await harness.engine.openEditor(sermon, editorIdentity('test-tab', sermon, 'default', 'after-choice'));
    await act(async () => { await settleEngine(); });
    expect(reopened.getState().checkpoint.draft?.verse).toBe('John 1:14');
    reopened.close({ flush: false });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)); });
    expect(screen.queryByText('dataSync.screenDraftBody')).not.toBeInTheDocument();
  });

  it('keeps the refused draft and engine journal until accepting the stored version is confirmed', async () => {
    const harness = setupSermon();
    await waitFor(() => expect(actions?.ready).toBe(true));
    await screenDraftLeftBehind(harness);
    await waitFor(() => expect(screen.getByText(/Typed on the sermon page/)).toBeInTheDocument());

    const refused = async () => (await harness.engine.listPending()).filter(entry => entry.state === 'refused');
    const retained = async () => (await harness.engine.listRecoverable(sermon))
      .some(({ record }) => record.checkpoint.draft?.verse === 'Typed on the sermon page');
    await waitFor(async () => expect(await retained()).toBe(true));
    expect(await refused()).toHaveLength(1);

    fireEvent.click(screen.getByText('dataSync.acceptRemote'));
    await act(async () => { await settleEngine(); });
    expect({
      retainedDraft: await retained(),
      refusedJournalEntries: (await refused()).length,
      confirmationTitle: screen.queryByRole('dialog')?.textContent ?? null,
    }).toEqual({
      retainedDraft: true,
      refusedJournalEntries: 1,
      confirmationTitle: expect.stringContaining('common.discardText.title'),
    });

    fireEvent.click(screen.getByRole('button', { name: 'common.discardText.keep' }));
    await act(async () => { await settleEngine(); });
    expect(await retained()).toBe(true);
    expect(await refused()).toHaveLength(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('dataSync.acceptRemote'));
    fireEvent.click(screen.getByRole('button', { name: 'common.discardText.confirm' }));
    await waitFor(async () => expect(await harness.engine.listRecoverable(sermon)).toHaveLength(0));
    expect(await refused()).toHaveLength(0);
  });

  it('says the same words once however many openings of the screen kept a copy of the draft', async () => {
    const harness = setupSermon();
    await waitFor(() => expect(actions?.ready).toBe(true));
    await screenDraftLeftBehind(harness);
    // The screen opened again and left again without a choice: one more copy of the same draft.
    for (const suffix of ['second-visit', 'third-visit']) {
      const visit = await harness.engine.openEditor(sermon, editorIdentity('test-tab', sermon, 'default', suffix));
      await act(async () => { await settleEngine(); });
      visit.close({ flush: false });
      await act(async () => { await settleEngine(); });
    }
    await waitFor(() => expect(screen.getByText(/Typed on the sermon page/)).toBeInTheDocument());
    const shown = screen.getByText(/Typed on the sermon page/).textContent ?? '';
    expect(shown.match(/Typed on the sermon page/g)).toHaveLength(1);
  });

  it('shows changed thoughts by their words, without ids, positions or the thoughts left as they were', async () => {
    const kept = { id: 'thought-kept-1', text: 'A thought nobody touched', tags: [], position: 1000, outlinePointId: null, date: '2026-09-01T00:00:00.000Z' };
    const harness = setupSermon({ ...storedSermon, thoughts: [kept] });
    await waitFor(() => expect(actions?.ready).toBe(true));
    const screenEditor = await harness.engine.openEditor(sermon, editorIdentity('test-tab', sermon, 'default', 'thoughts'));
    await act(async () => {
      await screenEditor.edit({ ...storedSermon, date: 8 as never, thoughts: [kept,
        { id: 'thought-new-7f2a', text: 'My new thought', tags: ['intro'], position: 2000, outlinePointId: 'op-1740984747334', date: '2026-09-02T00:00:00.000Z' }] });
      await screenEditor.save(); await settleEngine(); await settleEngine();
    });
    screenEditor.close({ flush: false });

    await waitFor(() => expect(screen.getByText(/My new thought/)).toBeInTheDocument());
    const shown = screen.getByText(/My new thought/).textContent ?? '';
    expect(shown).not.toMatch(/thought-new-7f2a|op-1740984747334|position|outlinePointId|"tags"/);
    expect(shown).not.toMatch(/A thought nobody touched/);
    // The field is named in the person's words, as on the list of legacy copies — not "thoughts:".
    expect(shown).toMatch(/legacyRecovery\.field\.thoughts: /);
    expect(shown).not.toMatch(/(^|\n)thoughts: /);
  });

  it('shows a plan\'s refused text as the text, without node ids or the mode it picked itself', async () => {
    const harness = setupSermon();
    await waitFor(() => expect(actions?.ready).toBe(true));
    const screenEditor = await harness.engine.openEditor(sermon, editorIdentity('test-tab', sermon, 'default', 'plan'));
    await act(async () => {
      await screenEditor.edit({ ...storedSermon, planMode: 'ai', planText: { 'node-1f3a': 'The paragraph I wrote' }, date: 8 as never });
      await screenEditor.save(); await settleEngine(); await settleEngine();
    });
    screenEditor.close({ flush: false });

    await waitFor(() => expect(screen.getByText(/The paragraph I wrote/)).toBeInTheDocument());
    const shown = screen.getByText(/The paragraph I wrote/).textContent ?? '';
    expect(shown).not.toMatch(/node-1f3a/);
    expect(shown).not.toMatch(/planMode/);
  });

  it('hands the notice to a screen opened after navigation without waiting for its poll', async () => {
    const harness = setupSermon();
    await waitFor(() => expect(actions?.ready).toBe(true));
    await screenDraftLeftBehind(harness);
    await screen.findByText('dataSync.screenDraftBody');
    mockPathname = '/sermons/sermon-1';
    harness.view.rerender(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={60_000} /></DataEngineProvider>);
    await act(async () => { await settleEngine(); });
    // The route alone cannot hide a draft: the screen has not opened its editor yet.
    expect(screen.getByText('dataSync.screenDraftBody')).toBeInTheDocument();
    const editor = await harness.engine.openEditor(sermon, editorIdentity('test-tab', sermon, 'default', 'late-screen'));
    await act(async () => { await settleEngine(); });
    await waitFor(() => expect(screen.queryByText('dataSync.screenDraftBody')).not.toBeInTheDocument(), { timeout: 250 });
    expect(editor.getState().checkpoint.draft?.verse).toBe('Typed on the sermon page');
    editor.close({ flush: false });
  });

  it('restores a waiting notice as soon as the answering editor closes, without a journal change', async () => {
    const harness = setupSermon();
    await waitFor(() => expect(actions?.ready).toBe(true));
    await screenDraftLeftBehind(harness);
    await screen.findByText('dataSync.screenDraftBody');
    mockPathname = '/sermons/sermon-1';
    const editor = await harness.engine.openEditor(sermon, editorIdentity('test-tab', sermon, 'default', 'closing-screen'));
    harness.view.rerender(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={60_000} /></DataEngineProvider>);
    await waitFor(() => expect(screen.queryByText('dataSync.screenDraftBody')).not.toBeInTheDocument());
    await act(async () => { editor.close({ flush: false }); await settleEngine(); });
    await waitFor(() => expect(screen.getByText('dataSync.screenDraftBody')).toBeInTheDocument(), { timeout: 250 });
    expect(screen.getByRole('link', { name: 'dataSync.openToDecide' })).toHaveAttribute('href', '/sermons/sermon-1');
  });

  it('is silent about a screen\'s draft on that screen once it holds the answer, which it then says itself', async () => {
    mockPathname = '/sermons/sermon-1/plan';
    const harness = setupSermon();
    await waitFor(() => expect(actions?.ready).toBe(true));
    await screenDraftLeftBehind(harness);
    const reopened = await harness.engine.openEditor(sermon, editorIdentity('test-tab', sermon, 'default', 'reopened'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)); await settleEngine(); });
    expect(screen.queryByText(/Typed on the sermon page/)).not.toBeInTheDocument();
    expect(screen.queryByText('dataSync.phase.refused')).not.toBeInTheDocument();
    reopened.close({ flush: false });
  });

  /** The offline shell's router stands at /~offline; the page the person opened is in the window. */
  it('is silent about a screen\'s draft on that screen when the offline shell renders it', async () => {
    mockPathname = '/~offline';
    window.history.replaceState(null, '', '/sermons/sermon-1/plan');
    try {
      const harness = setupSermon();
      await waitFor(() => expect(actions?.ready).toBe(true));
      await screenDraftLeftBehind(harness);
      const reopened = await harness.engine.openEditor(sermon, editorIdentity('test-tab', sermon, 'default', 'reopened'));
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)); await settleEngine(); });
      expect(screen.queryByText(/Typed on the sermon page/)).not.toBeInTheDocument();
      expect(screen.queryByText('dataSync.phase.refused')).not.toBeInTheDocument();
      reopened.close({ flush: false });
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  /** Codex, round 2: a screen opened before the request existed holds nothing and says nothing. */
  it('speaks on the screen when the editor open there does not hold the answer', async () => {
    mockPathname = '/sermons/sermon-1';
    const harness = setupSermon();
    await waitFor(() => expect(actions?.ready).toBe(true));
    const alreadyOpen = await harness.engine.openEditor(sermon, editorIdentity('test-tab', sermon, 'default', 'already-open'));
    await screenDraftLeftBehind(harness);
    await waitFor(() => expect(screen.getByText(/Typed on the sermon page/)).toBeInTheDocument());
    alreadyOpen.close({ flush: false });
  });

  it('goes once the screen opened again has decided', async () => {
    const harness = setupSermon();
    await waitFor(() => expect(actions?.ready).toBe(true));
    await screenDraftLeftBehind(harness);
    await waitFor(() => expect(screen.getByText(/Typed on the sermon page/)).toBeInTheDocument());

    const reopened = await harness.engine.openEditor(sermon, editorIdentity('test-tab', sermon, 'default', 'again'));
    await act(async () => {
      await reopened.acceptRemote();
      const { checkpoint } = reopened.getState();
      if (checkpoint.dirty) await reopened.edit(checkpoint.confirmed.value);
      await settleEngine(); await settleEngine();
    });
    await waitFor(() => expect(screen.queryByText(/Typed on the sermon page/)).not.toBeInTheDocument());
    expect(await harness.engine.listRecoverable(sermon)).toHaveLength(0);
    reopened.close({ flush: false });
  });

  it('offers the stored version, even on the screen, when no screen can decide between several drafts', async () => {
    mockPathname = '/sermons/sermon-1';
    const harness = setupSermon();
    await waitFor(() => expect(actions?.ready).toBe(true));
    const first = await harness.engine.openEditor(sermon, editorIdentity('test-tab', sermon, 'default', 'tab-one'));
    const second = await harness.engine.openEditor(sermon, editorIdentity('test-tab', sermon, 'default', 'tab-two'));
    await act(async () => {
      await first.edit({ ...storedSermon, title: 'Typed in one tab', date: 8 as never }); await first.save();
      await second.edit({ ...storedSermon, verse: 'Typed in another tab', date: 9 as never }); await second.save();
      await settleEngine(); await settleEngine();
      first.close({ flush: false }); second.close({ flush: false }); await settleEngine();
    });

    await waitFor(() => expect(screen.getByText('dataSync.screenDraftsUndecidable')).toBeInTheDocument());
    expect(screen.getByText(/Typed in one tab/)).toBeInTheDocument();
    expect(screen.getByText(/Typed in another tab/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'dataSync.openToDecide' })).not.toBeInTheDocument();
    await confirmTextAction('dataSync.acceptRemote');
    await waitFor(() => expect(screen.queryByText('dataSync.screenDraftsUndecidable')).not.toBeInTheDocument());
    expect(await harness.engine.listRecoverable(sermon)).toHaveLength(0);
  });

  /** A form's refused save is resolved by that form, as it always was; the banner stays out of it. */
  it('says nothing about a form\'s refused save', async () => {
    const harness = setupSermon();
    await waitFor(() => expect(actions?.ready).toBe(true));
    const editor = await harness.engine.openEditor(sermon, editorIdentity('test-tab', sermon, 'default', 'with-form'));
    const form = editor.form('date', [['date']]);
    await act(async () => {
      await form.begin(); await form.update(value => ({ ...value, date: 8 as never })); await form.save();
      await settleEngine(); await settleEngine();
    });
    editor.close({ flush: false });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)); await settleEngine(); });
    expect(screen.queryByText('dataSync.phase.refused')).not.toBeInTheDocument();
    expect(screen.queryByText('dataSync.screenDraftsUndecidable')).not.toBeInTheDocument();
  });

  it('keeps the one-shot slot out of reach of screen editors', () => {
    setupSermon();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    function ScreenOnActionSlot() { useDataDocument(sermon, { slot: 'action' }); return null; }
    expect(() => render(<DataEngineProvider><ScreenOnActionSlot /></DataEngineProvider>)).toThrow(/reserved for one-shot actions/);
    spy.mockRestore();
  });
});

/** Codex-style review 2026-10-13: a list's changed item must never lose the words the person typed. */
describe('a group\'s refused screen draft shows every word the person changed', () => {
  const group = { collection: 'groups', id: 'group-1' };
  const at = '2026-09-01T00:00:00.000Z';
  const prayer = { id: 'tpl-1', type: 'prayer', title: 'Opening prayer', summary: '', content: 'Old words', questions: [], status: 'draft', createdAt: at, updatedAt: at };
  const step = { id: 'flow-1', templateId: 'tpl-1', order: 1, durationMin: 5, instanceNotes: 'Old note' };
  const storedGroup = { userId: 'owner', title: 'Home group', description: '', status: 'active', templates: [prayer], flow: [step], meetingDates: [],
    createdAt: at, updatedAt: at };
  beforeEach(() => { actions = null; mockPathname = '/dashboard'; });

  const refusedGroupDraft = async (changes: Record<string, unknown>) => {
    const harness = documentEngineHarness({ resource: group, value: storedGroup, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    render(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={50} /></DataEngineProvider>);
    await waitFor(() => expect(actions?.ready).toBe(true));
    const editor = await harness.engine.openEditor(group, editorIdentity('test-tab', group, 'default', 'group-page'));
    // A title that is not text: the server refuses the whole change.
    await act(async () => { await editor.edit({ ...storedGroup, ...changes, title: 42 as never }); await editor.save(); await settleEngine(); await settleEngine(); });
    editor.close({ flush: false });
    await act(async () => { await settleEngine(); });
    await waitFor(() => expect(screen.getByText('dataSync.screenDraftBody')).toBeInTheDocument());
    return screen.getByText('dataSync.screenDraftBody').closest('[role="alert"]')?.querySelector('pre')?.textContent ?? '';
  };

  it('shows a block\'s rewritten content, with its title to say which block', async () => {
    const shown = await refusedGroupDraft({ templates: [{ ...prayer, content: 'The words I prayed over', updatedAt: '2026-09-02T00:00:00.000Z' }] });
    expect(shown).toMatch(/The words I prayed over/);
    expect(shown).toMatch(/Opening prayer/);
    expect(shown).not.toMatch(/tpl-1|Old words/);
  });

  it('shows a step\'s note, which has none of a thought\'s fields', async () => {
    const shown = await refusedGroupDraft({ flow: [{ ...step, instanceNotes: 'Ask about last week first' }] });
    expect(shown).toMatch(/Ask about last week first/);
    expect(shown).not.toMatch(/flow-1|templateId/);
  });

  it('shows a status choice with the same label as the group screen', async () => {
    const shown = await refusedGroupDraft({ status: 'completed' });
    expect(shown).toContain('legacyRecovery.field.status: workspaces.series.form.statuses.completed');
    expect(shown).not.toMatch(/status: completed/);
  });

  it('labels changed choices inside a block without rewriting its authored words', async () => {
    const shown = await refusedGroupDraft({ templates: [{ ...prayer, title: 'draft', status: 'filled', type: 'custom' }] });
    expect(shown).toContain('draft');
    expect(shown).toContain('groupFlow.status.filled');
    expect(shown).toContain('groupFlow.types.custom');
    expect(shown).not.toMatch(/\nfilled|\ncustom/);
  });

  it('never hides a changed item it has no words for: it is shown as stored', async () => {
    const shown = await refusedGroupDraft({ flow: [{ ...step, instanceNotes: undefined, durationMin: 12 }] });
    expect(shown).toMatch(/12/);
    expect(screen.getByText('freshness.copyTextAction')).toBeInTheDocument();
  });
});


describe('a screen request conflict after an acknowledged relation', () => {
  beforeEach(() => { process.env[ON_ENGINE] = 'series,sermons'; actions = null; mockPathname = '/settings/user'; });
  afterEach(() => { delete process.env[ON_ENGINE]; });

  it.each(['open', 'take'] as const)('finds the preserved title after leaving and can %s the request', async choice => {
    const h = await relationRebaseHarness();
    h.editor.close({ flush: true }); await settleEngine();
    jest.mocked(createBrowserDataEngine).mockImplementation(() => h.browser);
    render(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={50} /></DataEngineProvider>);
    const link = await screen.findByRole('link', { name: 'dataSync.openToDecide' });
    expect(link).toHaveAttribute('href', '/series/primary');
    expect(screen.getByText(/My title/)).toBeInTheDocument();
    if (choice === 'take') {
      await confirmTextAction('dataSync.acceptRemote');
      await waitFor(() => expect(screen.queryByText('dataSync.screenDraftBody')).not.toBeInTheDocument());
      expect((await h.commits.list('owner'))[0].state).toBe('cancelled');
      expect(h.transport.send).toHaveBeenCalledTimes(1);
    } else {
      mockPathname = '/series/primary';
      await act(async () => { await h.engine.openEditor(h.primary.resource, h.browser.editorId(h.primary.resource)); await settleEngine(); });
      await waitFor(() => expect(screen.queryByText('dataSync.screenDraftBody')).not.toBeInTheDocument());
    }
    expect(h.server.get(JSON.stringify(h.primary.resource))?.value).toMatchObject({ title: 'Remote title', sermonIds: ['member'] });
  });
});

describe('a failed participant in a council carry', () => {
  const council = { collection: 'councils', id: 'council-1' };
  const otherCouncil = { collection: 'councils', id: 'council-2' };
  const councilValue = { userId: 'owner', title: 'Council', theme: 'Romans', bookOrTopic: 'Romans', status: 'active', topics: [],
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
  beforeEach(() => { process.env[ON_ENGINE] = 'councils'; actions = null; mockPathname = '/settings/user'; });
  afterEach(() => { delete process.env[ON_ENGINE]; });

  it('keeps both later council drafts visible while their shared refusal is decided inline', async () => {
    const initial = { resource: council, value: councilValue, metadata: { protocol: 1 as const, generation: 'g1', revision: 1, deleted: false } };
    const h = documentEngineHarness(initial);
    jest.mocked(createBrowserDataEngine).mockImplementation(h.createBrowser);
    const transport = jest.mocked(h.transport.send);
    transport.mockImplementationOnce(async command => ({ kind: 'refused', operationId: command.operationId, code: 'receipt-too-large' }));
    function CouncilEditor() {
      const document = useDataDocument(council);
      return <section aria-label="Council editor">
        <button type="button" disabled={!document.data} onClick={() => { void document.commit(value => ({ ...value, title: 'Earlier refused title' })); }}>Save earlier title</button>
        <DataSyncStatus subject={document.recoveryIdentity} status={document.status} error={document.error}
          onKeepLocal={document.keepLocal} onAcceptRemote={document.acceptRemote} onRetry={document.retry} />
      </section>;
    }
    mockPathname = '/care/council/council-1';
    const tree = (open: boolean) => <DataEngineProvider>{open && <CouncilEditor />}<EngineConflictBanner pollMs={50} /></DataEngineProvider>;
    const view = render(tree(true));
    const save = screen.getByRole('button', { name: 'Save earlier title' });
    await waitFor(() => expect(save).toBeEnabled());
    await act(async () => { fireEvent.click(save); await settleEngine(); });
    await waitFor(() => expect(h.engine.getOpenAnswerScopes()[0]?.councilRefusal).toBeDefined());
    const [request] = await h.commits.list('owner');
    const earlier = await h.checkpoints.read('owner', request.editorId);
    if (!earlier) throw new Error('Missing earlier council checkpoint');
    expect(earlier.checkpoint.draft?.title).toBe('Earlier refused title');
    for (const [index, title] of ['First later title', 'Second later title'].entries()) {
      const { checkpoint } = earlier;
      await h.checkpoints.create({ ...earlier, editorId: editorIdentity('other-tab', council, 'default', `later-${index}`),
        checkpoint: { ...checkpoint, draft: { ...checkpoint.draft, title }, editGeneration: checkpoint.editGeneration + 1 } });
    }

    const drafts = await screen.findByText(/First later title/);
    expect(drafts).toHaveTextContent('Second later title');
    expect(screen.getAllByRole('button', { name: 'dataSync.acceptRemote' })).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Council editor' })).toContainElement(screen.getByRole('button', { name: 'dataSync.acceptRemote' }));
    expect(screen.getByRole('button', { name: 'freshness.copyTextAction' })).toBeInTheDocument();

    mockPathname = '/settings/user'; view.rerender(tree(false));
    await screen.findByRole('link', { name: 'dataSync.openToDecide' });
    expect(screen.getByRole('button', { name: 'dataSync.acceptRemote' })).toBeInTheDocument();
    expect(screen.getByText(/First later title/)).toHaveTextContent('Second later title');
  });

  it.each(['source', 'destination'] as const)('does not offer a participant-level choice for the closed %s checkpoint', async participant => {
    const initial = { resource: council, value: councilValue, metadata: { protocol: 1 as const, generation: 'g1', revision: 1, deleted: false } };
    const h = documentEngineHarness(initial);
    jest.mocked(createBrowserDataEngine).mockImplementation(h.createBrowser);
    render(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={50} /></DataEngineProvider>);
    await waitFor(() => expect(actions?.ready).toBe(true));

    const changed = { ...councilValue, topics: [{ id: 'topic-1', title: 'Carried words', content: 'The captured topic', carriedToCouncilId: otherCouncil.id }] };
    const target = { resource: otherCouncil, value: { ...councilValue, title: 'Destination' }, metadata: { protocol: 1 as const, generation: 'g2', revision: 1, deleted: false } };
    const atomic = { id: 'carry-primary', participants: ['carry-primary', 'carry-secondary'], kind: 'council-carry' as const };
    const command = { protocol: 1 as const, operationId: atomic.id, owner: 'owner', resource: council, generation: 'g1', dependsOn: [],
      kind: 'relation' as const, relation: 'council-carry' as const, edits: [] };
    const request = (id: string, editorId: string, baseline: typeof initial | typeof target, value: typeof changed | typeof target.value): CommitRequest => ({
      id, atomic, owner: 'owner', editorId, editGeneration: 1, baseline, value, predecessor: null, revision: 1, initialized: true,
      working: baseline, intended: value, command, submitted: value, sequence: 0, state: 'refused',
      result: { kind: 'refused', operationId: id, code: 'atomic-operation-conflict' }, unfinalized: [],
    });
    const requests = [request(atomic.participants[0], JSON.stringify(['tab-council', 'carry', 'topic-1', 'copy-1']), initial, changed),
      request(atomic.participants[1], JSON.stringify(['tab-council', 'carry-destination', 'copy-1']), target, target.value)];
    await h.commits.createBatch!(requests);
    const checkpointResource = participant === 'source' ? council : otherCouncil;
    const checkpointBaseline = participant === 'source' ? initial : target;
    const checkpointDraft = participant === 'source' ? changed : target.value;
    const participantRequest = requests[participant === 'source' ? 0 : 1];
    const editorId = editorIdentity('test-tab', checkpointResource, 'default', 'left-reader');
    await h.checkpoints.create({ owner: 'owner', editorId, prepared: null, unfinalized: [], checkpoint: {
      confirmed: checkpointBaseline, draft: checkpointDraft, dirty: true, editGeneration: 1, remoteCandidate: null, conflicts: [],
      pending: { [participantRequest.id]: { generation: 1, value: checkpointDraft } },
    } });

    expect(await h.engine.listRecoverable()).toEqual(expect.arrayContaining([
      expect.objectContaining({ actionResolutionRequired: true }),
    ]));
    if (participant === 'destination') {
      await waitFor(async () => expect(await h.engine.formWorkPending(otherCouncil)).toBe(true));
      expect(screen.queryByText('dataSync.screenDraftBody')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'dataSync.openToDecide' })).not.toBeInTheDocument();
      return;
    }
    await screen.findByText('dataSync.wholeActionDraftBody');
    expect(screen.getByRole('link', { name: 'dataSync.openToDecide' })).toHaveAttribute('href', '/care/council/council-1');
    expect(screen.getByRole('button', { name: 'freshness.copyTextAction' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'dataSync.acceptRemote' })).not.toBeInTheDocument();
  });
});

describe('a request refused locally before transport preparation', () => {
  beforeEach(() => { process.env[ON_ENGINE] = 'studyNotes'; actions = null; mockPathname = '/settings/user'; });
  afterEach(() => { delete process.env[ON_ENGINE]; });
  const refusedWithoutReceipt = async () => {
    const h = setup();
    await waitFor(() => expect(actions?.ready).toBe(true));
    await act(async () => { await actions!.commit(resource, current => ({ ...current!, materialIds: ['material'] })); await settleEngine(); });
    expect((await h.commits.list('owner'))[0]).toMatchObject({ state: 'refused', result: { kind: 'refused', code: 'relation-owner-required' } });
    expect(await h.engine.listPending()).toEqual([]);
    expect(h.transport.send).not.toHaveBeenCalled();
    return h;
  };

  it('names the saved refusal without claiming that another device changed the text', async () => {
    await refusedWithoutReceipt();
    await screen.findByText('dataSync.phase.refused');
    expect(screen.queryByText('freshness.conflictTitle')).not.toBeInTheDocument();
    await confirmTextAction('dataSync.acceptRemote');
    await waitFor(() => expect(screen.queryByText('dataSync.phase.refused')).not.toBeInTheDocument());
  });

  it('requires deciding the refused request before capturing a further one-shot edit', async () => {
    const h = await refusedWithoutReceipt();
    await expect(actions!.commit(resource, current => ({ ...current!, content: 'Next words' }))).rejects.toMatchObject({ code: 'decision-required' });
    expect(await h.commits.list('owner')).toHaveLength(1);
  });
});


/** A document may adopt a closed one-shot request; that is still one question for the person. */
describe('one-shot answers on their answering document screen', () => {
  beforeEach(() => { process.env[ON_ENGINE] = 'studyNotes'; actions = null; mockPathname = '/settings'; });
  afterEach(() => { delete process.env[ON_ENGINE]; mockPathname = '/dashboard'; });

  function AnsweringNote() {
    const document = useDataDocument(resource);
    return <section aria-label="Answering note">
      <h2>{String(document.data?.content ?? '')}</h2>
      <DataSyncStatus subject={document.recoveryIdentity} status={document.status} error={document.error}
        onKeepLocal={document.keepLocal} onAcceptRemote={document.acceptRemote} onRetry={document.retry} />
    </section>;
  }

  async function waitingAction(beforeCapture?: (h: ReturnType<typeof documentEngineHarness>) => Promise<void>) {
    const h = documentEngineHarness({ resource, value: stored, metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false } });
    jest.mocked(createBrowserDataEngine).mockImplementation(h.createBrowser);
    const tree = (open: boolean, pollMs: number) => <DataEngineProvider><Actions />{open && <AnsweringNote />}<EngineConflictBanner pollMs={pollMs} /></DataEngineProvider>;
    const view = render(tree(false, 50));
    await waitFor(() => expect(actions?.ready).toBe(true));
    if (beforeCapture) await beforeCapture(h);
    h.silentRemote({ content: 'Accepted phone words' });
    await act(async () => {
      await actions!.commit(resource, current => ({ ...current!, content: 'Saved action words' }));
      await settleEngine(); await settleEngine();
    });
    await screen.findByText(/Saved action words/);
    return { h, view, tree };
  }

  it('shows one decision after the document adopts the answered one-shot request and restores global discovery on leaving', async () => {
    const { h, view, tree } = await waitingAction();
    expect(screen.getAllByRole('button', { name: 'freshness.conflictKeepMine' })).toHaveLength(1);
    mockPathname = '/studies/note-1';
    view.rerender(tree(true, 60_000));
    await screen.findByRole('heading', { name: 'Saved action words' });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'freshness.conflictKeepMine' })).toHaveLength(1), { timeout: 300 });
    expect(h.engine.getOpenAnswers()).toEqual([resource]);
    mockPathname = '/settings';
    view.rerender(tree(false, 60_000));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'freshness.conflictKeepMine' })).toHaveLength(1), { timeout: 300 });
    expect(screen.getByText(/Saved action words/)).toBeInTheDocument();
    expect(await h.commits.list('owner')).toHaveLength(1);
    expect(h.server.value?.content).toBe('Accepted phone words');
    view.unmount();
  });

  it('keeps unseen words visible when the screen holds the same request but a different draft', async () => {
    const { h, view, tree } = await waitingAction();
    mockPathname = '/studies/note-1'; view.rerender(tree(true, 50));
    await screen.findByRole('heading', { name: 'Saved action words' });
    const saved = (await h.engine.listRecoverable(resource)).find(({ record }) => isOneShotRecord(record));
    if (!saved) throw new Error('Expected the saved action checkpoint');
    const reopened = await h.engine.openEditor(resource, saved.record.editorId);
    await act(async () => {
      await reopened.edit({ ...reopened.getState().checkpoint.draft!, content: 'Unseen ordinary words' });
      reopened.close({ flush: false }); await settleEngine();
    });
    await screen.findByText(/Unseen ordinary words/);
    expect(screen.getByRole('heading', { name: 'Saved action words' })).toBeInTheDocument();
    expect(await h.commits.list('owner')).toHaveLength(1);
    view.unmount();
  });

  it.each(['action', 'document'])('keeps an independent %s request visible while the screen holds only the earlier answer', async slot => {
    let late: ManagedEditor | null = null;
    const { h, view, tree } = await waitingAction(async harness => {
      late = await harness.engine.openEditor(resource, editorIdentity('test-tab', resource, slot, 'unseen'));
      await late.edit({ ...stored, content: 'Independent saved words' });
    });
    mockPathname = '/studies/note-1'; view.rerender(tree(true, 50));
    await screen.findByRole('heading', { name: 'Saved action words' });
    await act(async () => {
      await late!.save(); late!.close({ flush: false });
      await settleEngine(); await h.engine.retry(); await settleEngine();
    });
    const pending = await h.commits.list('owner');
    expect(pending).toHaveLength(2);
    expect(pending.map(request => request.state)).toEqual(['conflict', 'conflict']);
    await screen.findByText(/Independent saved words/);
    expect(screen.getByRole('heading', { name: 'Saved action words' })).toBeInTheDocument();
    view.unmount();
  });
});
