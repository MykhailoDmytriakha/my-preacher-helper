import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';

import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider, useDataDocument, useDocumentActions } from '@/data-engine/react.client';
import { editorIdentity } from '@/data-engine/editorIdentity';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import type { DocumentData } from '@/data-engine/types';

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
    expect(screen.getByText(/legacyRecovery\.field\.title: Refused title/)).toBeInTheDocument();
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

  it('names a refused deletion as a refusal, not as another device, and deletes when retried', async () => {
    const harness = setup();
    await waitFor(() => expect(actions?.ready).toBe(true));
    jest.mocked(harness.transport.send).mockImplementationOnce(async command => ({ kind: 'refused', operationId: command.operationId, code: 'related-collection-not-enabled' }));
    await act(async () => { await actions!.remove(resource); await settleEngine(); await settleEngine(); });
    await waitFor(() => expect(screen.getByText('dataSync.deleteRefusedTitle')).toBeInTheDocument());
    expect(screen.queryByText('dataSync.deleteConflictTitle')).not.toBeInTheDocument();
    expect(screen.getByText('dataSync.keepRecord')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByText('dataSync.retryDelete')); await settleEngine(); await settleEngine(); });
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
    render(<DataEngineProvider><Actions /><EngineConflictBanner pollMs={50} /></DataEngineProvider>);
    return harness;
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
    await act(async () => { fireEvent.click(screen.getByText('dataSync.acceptRemote')); await settleEngine(); await settleEngine(); });
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

    await act(async () => { fireEvent.click(screen.getByText('dataSync.acceptRemote')); await settleEngine(); await settleEngine(); });
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
    await act(async () => { fireEvent.click(screen.getByText('dataSync.acceptRemote')); await settleEngine(); await settleEngine(); });
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

  it('never hides a changed item it has no words for: it is shown as stored', async () => {
    const shown = await refusedGroupDraft({ flow: [{ ...step, instanceNotes: undefined, durationMin: 12 }] });
    expect(shown).toMatch(/12/);
    expect(screen.getByText('freshness.copyTextAction')).toBeInTheDocument();
  });
});
