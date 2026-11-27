import { writeForeignEvidence } from '@test-utils/foreignContentEvidence';
import * as foreignContent from '@/components/ui/foreignContent';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import userEvent from '@testing-library/user-event';
import type { ManualConspectus } from '@/(pages)/(private)/sermons/[id]/plan/manual/useManualConspectus';
import { toast } from 'sonner';

import { generateNotePlanContent } from '@/(pages)/(private)/sermons/[id]/plan/planApi';
import { OrphanedPlanText } from '@/(pages)/(private)/sermons/[id]/plan/OrphanedPlanText';
import ManualConspectusPage from '@/(pages)/(private)/sermons/[id]/plan/manual/page';
import { PlanCellDocument, PlanCellEditor } from '@/(pages)/(private)/sermons/[id]/plan/PlanCellEditor';
import '@testing-library/jest-dom';

import { OUTBOX_CHANGED_EVENT } from '@/components/OutboxDrain';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider, useDataDocument } from '@/data-engine/react.client';
import { planCellOpening } from '@/data-engine/sermonPlanCellSession';
import { DataSession } from '@/data-engine/session';
import { enqueueWrite, listOutbox, removeFromOutbox } from '@/services/writeOutbox.client';
import { draftKey, listDraftKeys, readDraft, saveDraft } from '@/utils/durableDraft';

import { deferred } from '@test-utils/deferred';
import { markdown, mountedEditor, typeAtEnd, undo } from '@test-utils/richMarkdownHistory';

import { documentEngineHarness, settleEngine } from '../../test-utils/documentEngineHarness';

import type { CommitRequest } from '@/data-engine/commits';
import type { RecoveryPresencePort } from '@/data-engine/recoveryPresence';
import type { Sermon } from '@/models/models';

/**
 * THE HAND-WRITTEN PLAN HAS TO SAY WHEN THE SERVER HOLDS A NEWER ONE.
 *
 * Its twin had this and it did not, which made this the dangerous half of the pair: the text
 * here is typed BY HAND, so nothing can regenerate it. Someone writes on a phone in the
 * morning with this tab open from the night before, and the only sign is their paragraph
 * quietly disappearing on the next save.
 *
 * The interesting assertion is not that a banner renders — a hard-coded one would satisfy
 * that. It is WHAT THE SCREEN HANDS THE DETECTOR: the same projection its twin uses, which
 * tells a real edit apart from a sermon merely moving between storage shapes.
 */

let mockSermon: Sermon | null = null;
let mockNoteMode = false;
const mockPush = jest.fn();
let harness: ReturnType<typeof documentEngineHarness>;

jest.mock('@/components/ui/foreignContent', () => ({
  ...jest.requireActual('@/components/ui/foreignContent'), __esModule: true,
}));

jest.mock('@/hooks/useRouteId', () => ({ useRouteId: () => 'sermon-1' }));

// The page runs on the data engine: it opens the sermon document through the real engine,
// with only the server and the browser transport replaced.
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'user-1' }, loading: false }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockNoteMode ? 'source=note' : ''),
  usePathname: () => '/sermons/sermon-1/plan/manual',
}));

jest.mock('@/hooks/useSermonNoteLinks', () => ({ useSourceNotes: () => ({ notes: [], missingIds: [], loading: false }) }));
jest.mock('@/(pages)/(private)/sermons/[id]/plan/planApi', () => ({ generateNotePlanContent: jest.fn() }));

jest.mock('@/services/outline.service', () => ({ updateSermonOutline: jest.fn() }));
// The real module with only the write replaced: listing exports by hand meant every new
// helper the screen started using arrived here as `undefined`.
jest.mock('@/services/sermons.client', () => ({
  ...jest.requireActual('@/services/sermons.client'),
  savePlanTextViaClient: jest.fn(),
}));
jest.mock('@/services/thought.service', () => ({ updateThought: jest.fn() }));
jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() } }));

const sermon = (planText: Record<string, string>): Sermon => ({
  id: 'sermon-1',
  title: 'A sermon in progress',
  verse: '',
  date: new Date('2026-01-01').toISOString(),
  userId: 'user-1',
  thoughts: [],
  outline: {
    introduction: [{ id: 'p1', text: 'First point' }],
    main: [],
    conclusion: [],
  },
  planText,
} as unknown as Sermon);

/**
 * The page is mounted the way the app mounts it — inside the query cache and the data engine, on a
 * document the harness serves. The header asks react-query for the study this sermon was built on,
 * so a bare `render` here would fail on plumbing rather than on anything this file is about.
 */
const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const page = (client: QueryClient, showPlan = true, plan: React.ReactNode = <ManualConspectusPage />) => (
  <QueryClientProvider client={client}><DataEngineProvider>{showPlan && plan}</DataEngineProvider></QueryClientProvider>
);
/** Opens every cell of one point card for writing — each cell has its own switch with its text. */
const openPointCells = (index = 0) => {
  const card = screen.getAllByRole('heading', { level: 3 })[index].closest('div.rounded-lg') as HTMLElement;
  within(card).queryAllByTitle('plan.editMode').forEach(button => fireEvent.click(button));
};

const render = async (recoveryPresence?: RecoveryPresencePort, plan?: React.ReactNode) => {
  const { id: _id, ...stored } = mockSermon as unknown as Record<string, unknown>;
  harness = documentEngineHarness({
    resource: { collection: 'sermons', id: 'sermon-1' },
    metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false },
    value: JSON.parse(JSON.stringify(stored)),
  });
  jest.mocked(createBrowserDataEngine).mockImplementation(options => harness.createBrowser({ ...options, recoveryPresence }));
  const client = queryClient();
  const view = rtlRender(page(client, true, plan));
  await screen.findAllByText('A sermon in progress');
  return { ...view, showPlan: (visible: boolean) => view.rerender(page(client, visible, plan)) };
};
const markers = () => screen.queryAllByTestId('plan-progress-point');
const filled = () => markers().filter((marker) => marker.style.backgroundColor !== '');

describe('the hand-written plan and a newer copy on the server', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSermon = sermon({});
  });

  it('says nothing while the screen matches the server', async () => {
    await render();

    expect(screen.queryByText('freshness.title')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'freshness.refreshAction' })).not.toBeInTheDocument();
  });

  /**
   * On the engine nothing asks the person to reload: the document observer brings the newer copy in
   * (cells being typed into are left alone), so a paragraph written on a phone simply appears.
   */
  it('shows a paragraph written elsewhere without asking anything of the person', async () => {
    await render();
    expect(filled()).toHaveLength(0);

    await act(async () => { await harness.remote({ planText: { p1: 'Rewritten on the phone' } }); });

    await waitFor(() => expect(filled()).toHaveLength(1));
    expect(screen.queryByText('freshness.title')).not.toBeInTheDocument();
  });

  it('shows the same plan the same way when it is stored in the old shape', async () => {
    mockSermon = {
      ...sermon({}),
      plan: {
        introduction: { outline: '', outlinePoints: { p1: 'What this laptop has' } },
        main: { outline: '', outlinePoints: {} },
        conclusion: { outline: '', outlinePoints: {} },
      },
    } as unknown as Sermon;
    await render();

    await waitFor(() => expect(filled()).toHaveLength(1));
  });
});

/**
 * THE SAVE BUTTON MUST SAY WHETHER THE WORK IS STORED — the same signal the paired screen
 * gives. Two screens over one plan teaching different things about "is my work saved" is how
 * a card gets left behind.
 */
describe('the save button on the hand-written screen', () => {
  // Its own setup: this block sits outside the freshness describe and would otherwise render
  // the "could not load" state, where there is no card and no button to judge.
  beforeEach(() => {
    jest.clearAllMocks();
    mockSermon = sermon({ p1: 'What this laptop has' });
    window.localStorage.clear();
  });

  const saveButton = () => screen.getAllByRole('button', { name: 'plan.save' })[0];

  it('is quiet and unavailable while nothing is unsaved', async () => {
    await render();

    expect(saveButton()).toBeDisabled();
    expect(saveButton().className).toContain('bg-gray-200');
  });

  /**
   * Driven through a REAL user action that leaves a cell unsaved — taking back a recovered
   * draft. The rich editor does not expose a text box in jsdom, and reaching past it into the
   * hook would prove the mock rather than the screen.
   */
  it('shows the text a previous session left before offering it back', async () => {
    saveDraft(draftKey('user-1', 'sermon-1', 'plan:p1'), 'текст, который сервер не принял');

    await render();
    expect(await screen.findByText('текст, который сервер не принял')).toBeInTheDocument();
    expect(screen.getByText('plan.draftRecoveryFromDraft')).toBeInTheDocument();
  });

  it('keeps unsaved text in sight when its point is removed elsewhere', async () => {
    saveDraft(draftKey('user-1', 'sermon-1', 'plan:p1'), 'абзац, набранный здесь');
    await render();
    fireEvent.click(await screen.findByRole('button', { name: 'plan.draftRecoveryRestore' }));
    expect(screen.queryByText('plan.orphanedTitle')).not.toBeInTheDocument();

    // This older outline update has no proof about what was stored under the removed point.
    const savedText = (harness.server.value?.planText as Record<string, string>).p1;
    await act(async () => { await harness.remote({ outline: { introduction: [], main: [], conclusion: [] } }); });

    expect(await screen.findByText('plan.orphanedTitle')).toBeInTheDocument();
    const localCopy = screen.getByText('абзац, набранный здесь').closest('li')!;
    expect(screen.getByText(savedText)).toBeInTheDocument();
    fireEvent.click(within(localCopy).getByText('plan.orphanedDiscard'));
    fireEvent.click(await screen.findByRole('button', { name: 'common.discardText.confirm' }));
    await waitFor(() => expect(screen.queryByText('абзац, набранный здесь')).not.toBeInTheDocument());
    expect(screen.getByText(savedText)).toBeInTheDocument();
    expect(harness.transport.send).not.toHaveBeenCalled();
  });

  it('lights up in the section colour the moment something is unsaved', async () => {
    saveDraft(draftKey('user-1', 'sermon-1', 'plan:p1'), 'текст, который сервер не принял');

    await render();
    fireEvent.click(await screen.findByRole('button', { name: 'plan.draftRecoveryRestore' }));

    await waitFor(() => expect(saveButton()).toBeEnabled());
    // Introduction's tone — literal classes, because Tailwind cannot see a computed one.
    expect(saveButton().className).toContain('bg-amber-600');
  });
});


it('names a server-confirmed missing manual-plan sermon and leaves for the sermon list', async () => {
  harness = documentEngineHarness({ resource: { collection: 'sermons', id: 'sermon-1' }, value: null, metadata: null });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const client = queryClient();
  const view = rtlRender(page(client));
  expect(await screen.findByText('recordAvailability.notFound')).toBeVisible();
  expect(screen.getByRole('button', { name: 'common.back' })).toBeEnabled();
  expect(harness.transport.send).not.toHaveBeenCalled();
  view.unmount(); client.clear();
});


it('shows loading without an unavailable verdict while the first sermon read waits', async () => {
  window.localStorage.clear();
  harness = documentEngineHarness({ resource: { collection: 'sermons', id: 'sermon-1' }, value: null, metadata: null }, { cached: false });
  jest.mocked(harness.transport.read).mockImplementation(() => new Promise(() => undefined));
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const client = queryClient();
  const view = rtlRender(page(client));
  expect(await screen.findByRole('button', { name: 'common.back' })).toBeEnabled();
  expect(screen.queryByText('recordAvailability.notHereYet')).not.toBeInTheDocument();
  expect(view.container.querySelector('[data-page-loading]')).not.toBeNull();
  view.unmount(); client.clear();
});

it('keeps a previous manual-plan cell readable and unchanged while the missing sermon read waits', async () => {
  const key = draftKey('user-1', 'sermon-1', 'plan:kept-point');
  saveDraft(key, 'A paragraph kept before leaving');
  const stored = readDraft(key);
  harness = documentEngineHarness({ resource: { collection: 'sermons', id: 'sermon-1' }, value: null, metadata: null });
  jest.mocked(harness.transport.read).mockImplementation(() => new Promise(() => undefined));
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const client = queryClient();
  const view = rtlRender(page(client));
  expect(await screen.findByText('A paragraph kept before leaving')).toBeVisible();
  expect(within(screen.getByText('A paragraph kept before leaving').closest('li')!).getByRole('button', { name: 'plan.orphanedCopy' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'common.back' })).toBeEnabled();
  expect(screen.queryByText('recordAvailability.notFound')).not.toBeInTheDocument();
  view.unmount(); client.clear();
  expect(readDraft(key)).toEqual(stored);
});

it.each([
  { earlierTyping: false, laterTyping: false },
  { earlierTyping: true, laterTyping: false },
  { earlierTyping: true, laterTyping: true },
])('preserves a remotely refreshed manual cell through Undo, earlier typing=$earlierTyping, later typing=$laterTyping', async ({ earlierTyping, laterTyping }) => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Original manual paragraph.' });
  const view = await render();
  openPointCells();
  const editor = mountedEditor(view.container);
  if (earlierTyping) {
    typeAtEnd(editor, ' Laptop edit.');
    fireEvent.click(screen.getAllByRole('button', { name: 'plan.save' })[0]);
    await waitFor(() => expect(harness.server.value?.planText).toEqual({ p1: 'Original manual paragraph. Laptop edit.' }));
  }
  const adopted = markdown(editor) + '\n\nPhone paragraph.';
  await act(async () => { await harness.remote({ planText: { p1: adopted } }); });
  await waitFor(() => expect(markdown(editor)).toBe(adopted));
  expect(mountedEditor(view.container)).toBe(editor);
  if (laterTyping) typeAtEnd(editor, ' Later laptop text.');
  expect(undo(editor)).toBe(laterTyping);
  expect(markdown(editor)).toBe(adopted);
  expect(undo(editor)).toBe(false);
  expect(markdown(editor)).toBe(adopted);
  act(() => { expect(editor.commands.redo()).toBe(laterTyping); });
  expect(markdown(editor)).toBe(adopted + (laterTyping ? ' Later laptop text.' : ''));
  expect(harness.server.value?.planText).toEqual({ p1: adopted });
  expect(screen.queryByText('freshness.title')).not.toBeInTheDocument();
});

it('puts the read/write switch with each cell\'s text and opens only that cell', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Opening.', child: 'Child paragraph.' });
  mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
  const view = await render();
  await screen.findByText('Child paragraph.');
  const heading = screen.getAllByRole('heading', { level: 3 })[0];
  // Not in the point's header any more: one switch inside each cell's text.
  expect(within(heading).queryByTitle('plan.editMode')).not.toBeInTheDocument();
  const switches = screen.getAllByTitle('plan.editMode');
  expect(switches).toHaveLength(2);
  expect(switches[1].closest('div.rounded-md')).toHaveTextContent('Child paragraph.');
  fireEvent.click(switches[1]);
  expect(view.container.querySelectorAll('.tiptap')).toHaveLength(1);
  expect(screen.getByText('Opening.')).toBeInTheDocument();
  // While writing, the way back to reading stands at the end of that editor's toolbar.
  const back = screen.getByTitle('plan.viewMode');
  const toolbar = back.closest('.rounded-t-xl') as HTMLElement;
  expect(toolbar).not.toBeNull();
  expect(within(toolbar).getAllByRole('button').at(-1)).toBe(back);
  // The keyboard follows the switch both ways.
  expect(back).toHaveFocus();
  fireEvent.click(back);
  expect(view.container.querySelectorAll('.tiptap')).toHaveLength(0);
  expect(screen.getAllByTitle('plan.editMode')).toHaveLength(2);
  expect(screen.getAllByTitle('plan.editMode')[1]).toHaveFocus();
});

it('regression pin: keeps a second requested manual draft replacement undoable in the mounted editor', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Original manual paragraph.' });
  saveDraft(draftKey('user-1', 'sermon-1', 'plan:p1', 'first'), 'First requested words.', undefined, false, 1);
  saveDraft(draftKey('user-1', 'sermon-1', 'plan:p1', 'second'), 'Second requested words.', undefined, false, 2);
  const view = await render();
  fireEvent.click(await screen.findByRole('button', { name: 'plan.draftRecoveryRestore' }));
  await screen.findByTitle('plan.editMode');
  openPointCells();
  const editor = mountedEditor(view.container);
  const before = markdown(editor);
  fireEvent.click(await screen.findByRole('button', { name: 'plan.draftRecoveryRestore' }));
  expect(markdown(editor)).not.toBe(before);
  expect(mountedEditor(view.container)).toBe(editor);
  expect(undo(editor)).toBe(true);
  expect(markdown(editor)).toBe(before);
});

it('keeps typed plan text in the engine and creates no second local copy on page hide', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Stored words.' });
  const view = await render();
  openPointCells();
  typeAtEnd(mountedEditor(view.container), ' Kept on this device.');
  const resource = { collection: 'sermons', id: 'sermon-1' };
  await waitFor(async () => {
    const copies = await harness.checkpoints.listRecoverable('user-1', resource);
    expect(copies.some(({ record }) => record.checkpoint.planCellDrafts?.p1?.text === 'Stored words. Kept on this device.')).toBe(true);
  });
  fireEvent(window, new Event('pagehide'));
  expect(listDraftKeys()).toEqual([]);
  expect(harness.server.value?.planText).toEqual({ p1: 'Stored words.' });
});

it.each(['pagehide', 'close', 'owner change'] as const)('backs up an admitted plan edit before screen render (%s)', async departure => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Stored words.' });
  await render();
  const resource = { collection: 'sermons', id: 'sermon-1' };
  const editor = await harness.engine.openEditor(resource, 'independent-plan-opening');
  const opening = planCellOpening(editor.getState().checkpoint, 'p1', 'Stored words.')!;
  const writing = deferred();
  const put = harness.checkpoints.put;
  const newer = 'Words admitted before the screen could show them.';
  const hold = jest.spyOn(harness.checkpoints, 'put').mockImplementation(async record => {
    if (record.checkpoint.planCellDrafts?.p1?.text === newer) await writing.promise;
    return put(record);
  });
  let edit: Promise<void> | undefined;
  try {
    act(() => {
      edit = editor.editPlanCell(opening, newer);
      void edit.catch(() => undefined);
      if (departure === 'pagehide') window.dispatchEvent(new Event('pagehide'));
      if (departure === 'close') editor.close();
      if (departure === 'owner change') harness.engine.setOwner('another-owner');
    });
    expect(listDraftKeys().map(key => readDraft(key)?.value)).toEqual([newer]);

    await act(async () => { writing.resolve(); await Promise.allSettled([edit]); });
    await waitFor(() => expect(listDraftKeys()).toEqual([]));
    const copies = await harness.checkpoints.listRecoverable('user-1', resource);
    expect(copies.map(({ record }) => record.checkpoint.planCellDrafts?.p1?.text)).toContain(newer);
    expect(await harness.checkpoints.listRecoverable('another-owner', resource)).toEqual([]);
    expect(harness.server.value?.planText).toEqual({ p1: 'Stored words.' });
  } finally {
    writing.resolve();
    await Promise.allSettled([edit]);
    hold.mockRestore();
    editor.close();
  }
});

it('reopens a previously blank plan cell without the words erased behind a delayed device write', async () => {
  localStorage.clear();
  const initial = sermon({});
  delete initial.planText;
  mockSermon = initial;
  const view = await render();
  const phrase = 'Words I later erase.';
  let waiting = false;
  harness.storage.holdCompletionAfterCommit = (rows, mode) => {
    if (waiting || mode !== 'readwrite') return false;
    waiting = [...rows.values()].some(row =>
      (row as { checkpoint?: { planCellDrafts?: { p1?: { text: string } } } })?.checkpoint?.planCellDrafts?.p1?.text === phrase);
    return waiting;
  };
  const release = () => {
    harness.storage.holdCompletionAfterCommit = undefined;
    if (waiting) { waiting = false; harness.storage.finishCompletion(); }
  };
  try {
    openPointCells();
    const editor = mountedEditor(view.container);
    typeAtEnd(editor, phrase);
    await waitFor(() => expect(waiting).toBe(true));
    fireEvent(window, new Event('pagehide'));
    expect(listDraftKeys().map(key => readDraft(key)?.value)).toContain(phrase);

    act(() => { editor.commands.clearContent(); });
    expect(markdown(editor)).toBe('');
    await act(async () => { release(); await settleEngine(); });
    await waitFor(() => expect(listDraftKeys()).toEqual([]));
    const backups = await harness.checkpoints.listRecoverable('user-1', { collection: 'sermons', id: 'sermon-1' });
    expect(backups.map(copy => copy.record.checkpoint.planCellDrafts?.p1?.text)).not.toContain(phrase);
    expect(harness.server.value?.planText).toBeUndefined();

    view.showPlan(false);
    view.showPlan(true);
    await screen.findAllByText('A sermon in progress');
    expect(screen.queryByRole('button', { name: 'plan.draftRecoveryRestore' })).not.toBeInTheDocument();
  } finally { release(); }
});

it('leaves the existing offline Save in its queue when leaving the plan', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'The stored paragraph.' });
  mockSermon.planMode = 'manual';
  const queued = {
    id: 'old-plan-save', uid: 'user-1', collection: 'sermons', docId: 'sermon-1', aggregate: 'plan',
    patch: { 'planText.p1': 'Words queued by the earlier app.' },
    expectedBaseline: { 'planText.p1': 'The stored paragraph.' }, baseRevision: 1,
    savedAt: Date.now(), status: 'pending' as const,
  };
  expect(enqueueWrite(queued)).toBe(true);
  const view = await render();
  try {
    fireEvent(window, new Event(OUTBOX_CHANGED_EVENT));
    await waitFor(() => expect(mockConspectus.pendingNodeIds.has('p1')).toBe(true));
    fireEvent(window, new Event('pagehide'));
    await act(async () => { view.showPlan(false); await settleEngine(); });
    expect(listOutbox('user-1')).toEqual([queued]);
    expect(listDraftKeys()).toEqual([]);
    expect(harness.server.value?.planText).toEqual({ p1: 'The stored paragraph.' });
    view.showPlan(true);
    await screen.findAllByText('A sermon in progress');
    expect(screen.queryByRole('button', { name: 'plan.draftRecoveryRestore' })).not.toBeInTheDocument();
  } finally {
    view.unmount();
    removeFromOutbox(queued.id);
    localStorage.clear();
  }
});

it.each([
  { legacyTwin: false, restore: true }, { legacyTwin: true, restore: true }, { legacyTwin: true, restore: false },
])('shows the exact recovered plan words once after reopening, legacy twin=$legacyTwin restore=$restore', async ({ legacyTwin, restore }) => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Stored words.' });
  const words = 'Words from the previous plan editing session.';
  const previous = draftKey('user-1', 'sermon-1', 'plan:p1', 'previous-editor');
  saveDraft(previous, words);
  const view = await render({ held: async () => false, hold: () => () => undefined });
  const storage = harness.checkpoints;
  const resource = { collection: 'sermons', id: 'sermon-1' };
  fireEvent.click(await screen.findByRole('button', { name: 'plan.draftRecoveryRestore' }));
  await waitFor(async () => {
    const copies = await storage.listRecoverable('user-1', resource);
    expect(copies.some(({ record }) => record.checkpoint.planCellDrafts?.p1?.text === words)).toBe(true);
    expect(readDraft(previous)).toBeNull();
  });
  expect(harness.server.value?.planText).toEqual({ p1: 'Stored words.' });
  view.unmount();

  const twin = draftKey('user-1', 'sermon-1', 'plan:p1', 'older-build');
  if (legacyTwin) saveDraft(twin, words);
  const reopened = rtlRender(page(queryClient()));
  try {
    await screen.findByText(words);
    await act(settleEngine);
    const title = screen.getByText('plan.draftRecoveryTitle');
    const offer = within(title.closest('[role="status"]') as HTMLElement);
    expect(offer.getByText(words)).toBeInTheDocument();
    expect(offer.getByText('Stored words.')).toBeInTheDocument();
    expect(screen.getAllByText(words)).toHaveLength(1);
    expect(offer.getByRole('button', { name: 'plan.draftRecoveryDiscard' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'dataSync.recover' })).not.toBeInTheDocument();

    if (restore) {
      await userEvent.click(offer.getByRole('button', { name: 'plan.draftRecoveryRestore' }));
      await waitFor(() => expect(screen.getByTitle('plan.save')).toBeEnabled());
      expect(screen.getByText(words)).toBeInTheDocument();
    } else {
      await userEvent.click(offer.getByRole('button', { name: 'plan.draftRecoveryDiscard' }));
      await userEvent.click(await screen.findByRole('button', { name: 'common.discardText.confirm' }));
      await waitFor(async () => {
        expect(screen.queryByText(words)).not.toBeInTheDocument();
        const copies = await storage.listRecoverable('user-1', resource);
        expect(copies.some(({ record }) => record.checkpoint.planCellDrafts?.p1?.text === words)).toBe(false);
      });
    }
    expect(harness.server.value?.planText).toEqual({ p1: 'Stored words.' });
    expect(harness.transport.send).not.toHaveBeenCalled();
    expect(readDraft(twin)).toBeNull();
  } finally {
    reopened.unmount();
    localStorage.clear();
  }
});

it.each([
  { action: 'restore', versioned: true }, { action: 'discard', versioned: true }, { action: 'restore', versioned: false },
])('shows a fresh plan offer if the displayed copy changes before $action, versioned=$versioned', async ({ action, versioned }) => {
  mockSermon = sermon({ p1: 'Stored words.' });
  const shown = 'The previously shown plan draft.';
  const fresh = 'The draft changed before I decided.';
  const previous = draftKey('user-1', 'sermon-1', 'plan:p1', 'previous-editor');
  saveDraft(previous, shown);
  const view = await render({ held: async () => false, hold: () => () => undefined });
  const resource = { collection: 'sermons', id: 'sermon-1' };
  const storage = harness.checkpoints;
  await userEvent.click(await screen.findByRole('button', { name: 'plan.draftRecoveryRestore' }));
  await waitFor(() => expect(readDraft(previous)).toBeNull());
  view.unmount();

  const [{ record: original }] = await storage.listRecoverable('user-1', resource);
  if (!versioned) {
    const key = JSON.stringify(['checkpoint', original.owner, original.editorId]);
    harness.storage.rows.set(key, { ...original, recoveryVersion: undefined });
  }
  const reopened = rtlRender(page(queryClient()));
  try {
    await screen.findByText(shown);
    if (action === 'discard') {
      await userEvent.click(screen.getByRole('button', { name: 'plan.draftRecoveryDiscard' }));
    }
    const [{ record }] = await storage.listRecoverable('user-1', resource);
    const session = DataSession.restore(record.checkpoint);
    session.editPlanCell(planCellOpening(record.checkpoint, 'p1', shown)!, fresh);
    await storage.put({ ...record, checkpoint: session.checkpoint() });

    await userEvent.click(screen.getByRole('button', {
      name: action === 'restore' ? 'plan.draftRecoveryRestore' : 'common.discardText.confirm',
    }));
    const words = await screen.findByText(fresh);
    const banner = within(words.closest('[role="status"]') as HTMLElement);
    expect(banner.getByText('plan.draftRecoveryTitle')).toBeInTheDocument();
    expect(banner.queryByText(shown)).not.toBeInTheDocument();
    expect(screen.queryByTitle('plan.save')).not.toBeInTheDocument();
    expect(harness.transport.send).not.toHaveBeenCalled();
  } finally {
    reopened.unmount();
    localStorage.clear();
  }
});

it.each([
  { keep: true, departure: 'stay' },
  { keep: false, departure: 'stay' },
  { keep: true, departure: 'hide while writing' },
  { keep: false, departure: 'close after choosing' },
  { keep: false, departure: 'switch account after choosing' },
] as const)('holds composition as a native plan copy, keep=$keep, $departure', async ({ keep, departure }) => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Old paragraph.' });
  mockSermon.planMode = 'manual';
  const view = await render({ held: async () => false, hold: () => () => undefined });
  let delayed = false;
  if (departure !== 'stay') {
    harness.storage.holdCompletionAfterCommit = (rows, mode) => {
      if (delayed || mode !== 'readwrite') return false;
      delayed = [...rows.values()].some(value => Boolean((value as { planCellAlternative?: boolean })?.planCellAlternative));
      return delayed;
    };
  }
  try {
    openPointCells();
    const editor = mountedEditor(view.container);
    const typed = 'Old paragraph. Confirmed composition.';
    const newer = 'Different words from the phone.';
    fireEvent.compositionStart(editor.view.dom);
    typeAtEnd(editor, ' Confirmed composition.');
    await act(async () => { await harness.remote({ planText: { p1: newer } }); });
    await act(async () => {
      fireEvent.compositionEnd(editor.view.dom, { data: 'Confirmed composition.' });
    });
    const dialog = await screen.findByRole('dialog', { name: 'richEditor.compositionChoice.title' });
    expect(within(dialog).getByText(typed)).toBeVisible();
    expect(within(dialog).getByText(newer)).toBeVisible();
    const resource = { collection: 'sermons', id: 'sermon-1' };
    await waitFor(async () => {
      const copies = await harness.checkpoints.listRecoverable('user-1', resource);
      expect(copies.some(({ record }) => record.planCellAlternative && record.checkpoint.planCellDrafts?.p1?.text === typed)).toBe(true);
    });
    expect(listDraftKeys()).toEqual([]);
    if (departure === 'hide while writing') {
      expect(delayed).toBe(true);
      fireEvent(window, new Event('pagehide'));
      expect(listDraftKeys()).toHaveLength(1);
      await act(async () => { harness.storage.finishCompletion(); await settleEngine(); });
      expect(listDraftKeys()).toEqual([]);
    }
    fireEvent.click(within(dialog).getByRole('button', {
      name: keep ? 'richEditor.compositionChoice.keepTyped' : 'richEditor.compositionChoice.keepUpdated',
    }));
    if (departure === 'close after choosing' || departure === 'switch account after choosing') {
      expect(delayed).toBe(true);
      view.showPlan(false);
      if (departure === 'switch account after choosing') harness.engine.setOwner('another-owner');
      await act(async () => { harness.storage.finishCompletion(); await settleEngine(); });
    }
    await waitFor(async () => {
      const copies = await harness.checkpoints.listRecoverable('user-1', resource);
      expect(copies.some(({ record }) => record.planCellAlternative)).toBe(false);
      expect(copies.some(({ record }) => record.checkpoint.planCellDrafts?.p1?.text === typed)).toBe(keep);
    });
    expect(listDraftKeys()).toEqual([]);
    expect(await harness.checkpoints.listRecoverable('another-owner', resource)).toEqual([]);
    expect(harness.server.value?.planText).toEqual({ p1: newer });
  } finally {
    harness.storage.holdCompletionAfterCommit = undefined;
    if (delayed) harness.storage.finishCompletion();
    view.unmount();
  }
});

it('retries a composition backup when both device writes temporarily refuse it', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Old paragraph.' });
  mockSermon.planMode = 'manual';
  const view = await render();
  const gate = deferred(), started = jest.fn(), refused = jest.fn();
  const create = harness.checkpoints.create!;
  const write = jest.spyOn(harness.checkpoints, 'create').mockImplementation(async (record, origin) => {
    if (!record.planCellAlternative) return create(record, origin);
    started();
    await gate.promise;
    throw new Error('Device storage temporarily refused the alternative');
  });
  const setItem = Storage.prototype.setItem;
  let backingUp = false;
  const backup = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (backingUp && key.includes('plan%3Ap1')) {
      refused();
      throw new Error('Backup storage temporarily refused the alternative');
    }
    setItem.call(this, key, value);
  });
  try {
    openPointCells();
    const editor = mountedEditor(view.container);
    fireEvent.compositionStart(editor.view.dom);
    typeAtEnd(editor, ' Confirmed composition.');
    await act(async () => { await harness.remote({ planText: { p1: 'Different words from the phone.' } }); });
    await act(async () => { fireEvent.compositionEnd(editor.view.dom, { data: 'Confirmed composition.' }); });
    await screen.findByRole('dialog', { name: 'richEditor.compositionChoice.title' });
    await waitFor(() => expect(started).toHaveBeenCalled());

    backingUp = true;
    fireEvent(window, new Event('pagehide'));
    expect(refused).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve(); await settleEngine(); });
    expect(refused).toHaveBeenCalledTimes(2);
    expect(listDraftKeys()).toEqual([]);

    backingUp = false;
    fireEvent(window, new Event('pagehide'));
    const [key] = listDraftKeys();
    expect(key).toBeDefined();
    expect(readDraft(key)?.value).toBe('Old paragraph. Confirmed composition.');
  } finally {
    gate.resolve();
    write.mockRestore();
    backup.mockRestore();
    view.unmount();
  }
});

it('stages ordinary composition after earlier typing in the same plan cell', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Original paragraph.' });
  mockSermon.planMode = 'manual';
  const view = await render();
  try {
    openPointCells();
    const editor = mountedEditor(view.container);
    const resource = { collection: 'sermons', id: 'sermon-1' };
    const stored = async (words: string) => {
      const copies = await harness.checkpoints.listRecoverable('user-1', resource);
      expect(copies.some(({ record }) => record.checkpoint.planCellDrafts?.p1?.text === words)).toBe(true);
    };
    typeAtEnd(editor, ' First edit.');
    await waitFor(() => stored('Original paragraph. First edit.'));
    fireEvent.compositionStart(editor.view.dom);
    typeAtEnd(editor, ' Confirmed composition.');
    await act(async () => {
      fireEvent.compositionEnd(editor.view.dom, { data: 'Confirmed composition.' });
    });
    await waitFor(() => stored('Original paragraph. First edit. Confirmed composition.'));
    expect(listDraftKeys()).toEqual([]);
    expect(harness.server.value?.planText).toEqual({ p1: 'Original paragraph.' });
  } finally { view.unmount(); }
});

it('retains the selected older plan copy until the exact restored words are on disk', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Stored words.' });
  const previous = draftKey('user-1', 'sermon-1', 'plan:p1', 'earlier-opening');
  const words = 'The only copy of these words.';
  saveDraft(previous, words);
  const view = await render();
  const put = harness.checkpoints.put;
  const finishWithoutWrite = jest.fn();
  const write = jest.spyOn(harness.checkpoints, 'put').mockImplementation(async record => {
    if (record.checkpoint.planCellDrafts?.p1?.text === words) {
      finishWithoutWrite();
      return;
    }
    return put(record);
  });
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'plan.draftRecoveryRestore' }));
    await waitFor(() => expect(finishWithoutWrite).toHaveBeenCalled());
    expect(readDraft(previous)?.value).toBe(words);
    expect(harness.server.value?.planText).toEqual({ p1: 'Stored words.' });
  } finally { view.unmount(); write.mockRestore(); }
});

it('saves the selected old copy when a newer draft is already staged in the plan session', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Current saved words.' });
  const current = draftKey('user-1', 'sermon-1', 'plan:p1', 'same-copy');
  const older = draftKey('user-1', 'sermon-1', 'plan:p1', 'older-copy');
  saveDraft(current, 'Current saved words.', undefined, false, 2);
  saveDraft(older, 'Selected words from the old copy.', undefined, false, 1);
  const view = await render();
  fireEvent.change(await screen.findByLabelText('unsavedDraft.chooseCopy'), { target: { value: current } });
  fireEvent.click(screen.getByRole('button', { name: 'plan.draftRecoveryRestore' }));
  await screen.findByTitle('plan.editMode');
  openPointCells();
  const editor = mountedEditor(view.container);
  typeAtEnd(editor, ' More recent draft.');
  expect(markdown(editor)).toContain('More recent draft.');

  fireEvent.click(screen.getByRole('button', { name: 'plan.draftRecoveryRestore' }));
  await waitFor(() => expect(markdown(editor)).toBe('Selected words from the old copy.'));
  fireEvent.click(screen.getByRole('button', { name: 'plan.save' }));
  await waitFor(() => expect(harness.server.value?.planText).toEqual({ p1: 'Selected words from the old copy.' }));
});

it('regression pin: keeps an explicitly applied note-plan AI replacement undoable in the mounted manual cell', async () => {
  localStorage.clear();
  mockNoteMode = true;
  try {
    mockSermon = { ...sermon({ p1: 'Original manual paragraph.' }), sourceNoteIds: ['source-note'] };
    jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { p1: 'Requested AI text.' }, missingMaterial: {} });
    const view = await render();
    openPointCells();
    const editor = mountedEditor(view.container);
    fireEvent.click(screen.getByRole('button', { name: 'plan.refine.open' }));
    fireEvent.click(screen.getByRole('button', { name: 'plan.refine.presets.rewrite' }));
    fireEvent.click(screen.getByRole('button', { name: 'plan.refine.submit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'plan.fromNote.apply' }));
    expect(markdown(editor)).toBe('Requested AI text.');
    expect(mountedEditor(view.container)).toBe(editor);
    expect(undo(editor)).toBe(true);
    expect(markdown(editor)).toBe('Original manual paragraph.');
    view.unmount();
  } finally { mockNoteMode = false; }
});

it('keeps words typed after applying a note proposal while its Save is still offline', async () => {
  localStorage.clear();
  mockNoteMode = true;
  try {
    mockSermon = { ...sermon({ p1: 'Original words.' }), sourceNoteIds: ['source-note'] };
    const proposed = 'Requested words.\n\n';
    jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { p1: proposed }, missingMaterial: {} });
    const view = await render();
    openPointCells();
    const editor = mountedEditor(view.container);
    fireEvent.click(screen.getByRole('button', { name: 'plan.refine.open' }));
    fireEvent.click(screen.getByRole('button', { name: 'plan.refine.presets.rewrite' }));
    fireEvent.click(screen.getByRole('button', { name: 'plan.refine.submit' }));
    const apply = await screen.findByRole('button', { name: 'plan.fromNote.apply' });

    act(() => harness.engine.setOnline(false));
    fireEvent.click(apply);
    await waitFor(() => expect(markdown(editor)).toBe('Requested words.'));
    typeAtEnd(editor, ' My addition.');
    expect(harness.server.value?.planText).toEqual({ p1: 'Original words.' });
    await act(async () => { harness.engine.setOnline(true); await harness.engine.retry(); });
    await waitFor(() => expect(harness.server.value?.planText).toEqual({ p1: proposed }));
    expect(markdown(editor)).toBe('Requested words. My addition.');

    fireEvent.click(screen.getByRole('button', { name: 'plan.save' }));
    await waitFor(() => expect(harness.server.value?.planText).toEqual({ p1: 'Requested words. My addition.' }));
    view.unmount();
  } finally { mockNoteMode = false; }
});

it('keeps the rescued paragraph when text Undo cannot restore the deleted child', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Original manual paragraph.', child: 'Child paragraph.' });
  mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
  const view = await render();
  openPointCells();
  const editor = mountedEditor(view.container);
  fireEvent.click(screen.getByTitle('plan.deleteSubPoint'));
  fireEvent.click(screen.getByTitle('plan.deleteSubPointConfirm'));
  await waitFor(() => expect(screen.queryByTitle('plan.deleteSubPoint')).not.toBeInTheDocument());
  const transferred = 'Original manual paragraph.\n\nChild paragraph.';
  expect(markdown(editor)).toBe(transferred);
  expect(mountedEditor(view.container)).toBe(editor);
  expect(undo(editor)).toBe(false);
  expect(markdown(editor)).toBe(transferred);
  typeAtEnd(editor, ' Then another edit.');
  expect(undo(editor)).toBe(true);
  expect(markdown(editor)).toBe(transferred);
  expect(harness.server.value?.planText).toMatchObject({ p1: transferred });
  view.unmount();
});

it('stores a subpoint transfer and its removal in one command', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Opening.', child: 'Child paragraph.' });
  mockSermon.planMode = 'manual';
  mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
  const view = await render();
  try {
    fireEvent.click(screen.getByTitle('plan.deleteSubPoint'));
    fireEvent.click(screen.getByTitle('plan.deleteSubPointConfirm'));
    await waitFor(() => expect(harness.server.value?.outline).toMatchObject({ introduction: [{ subPoints: [] }] }));
    const updates = jest.mocked(harness.transport.send).mock.calls.flatMap(([command]) =>
      command.kind === 'update' && command.resource.collection === 'sermons' ? [command.changes.map(change => change.path[0]).sort()] : []);
    expect(updates).toEqual([['outline', 'planText']]);
    expect(harness.server.value?.planText).toMatchObject({ p1: 'Opening.\n\nChild paragraph.', child: '' });
  } finally { view.unmount(); }
});

it.each(['before the native write', 'after the native write'] as const)('recovers the confirmed removal when navigation closes the editor %s', async boundary => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Opening.', child: 'Child paragraph.' });
  mockSermon.planMode = 'manual';
  mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
  const view = await render();
  act(() => { harness.engine.setOnline(false); });
  const capture = harness.commits.createWithCheckpoint!;
  const gate = deferred();
  let reached = false;
  const isTransfer = (request: CommitRequest | undefined) => request?.planTextEvidence?.planSubpointTransfer?.subPointId === 'child';
  const held = boundary === 'before the native write'
    ? jest.spyOn(harness.commits, 'createWithCheckpoint').mockImplementation(async (request, project) => {
      if (!reached && isTransfer(request)) { reached = true; await gate.promise; }
      return capture(request, project);
    })
    : undefined;
  if (!held) harness.storage.holdCompletionAfterCommit = (rows, mode) => {
    if (reached || mode !== 'readwrite' || ![...rows.values()].some(row => isTransfer(row as CommitRequest))) return false;
    reached = true;
    return true;
  };
  const release = () => {
    gate.resolve();
    harness.storage.holdCompletionAfterCommit = undefined;
    if (!held && reached) harness.storage.finishCompletion();
  };
  let reopened: ReturnType<typeof rtlRender> | undefined;
  try {
    fireEvent.click(screen.getByTitle('plan.deleteSubPoint'));
    fireEvent.click(screen.getByTitle('plan.deleteSubPointConfirm'));
    await waitFor(() => expect(reached).toBe(true));
    view.unmount();
    release();
    const transferred = 'Opening.\n\nChild paragraph.';
    await waitFor(async () => {
      const requests = await harness.commits.list('user-1');
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        value: { outline: { introduction: [{ subPoints: [] }] }, planText: { p1: transferred } },
        planTextEvidence: { planSubpointTransfer: { pointId: 'p1', subPointId: 'child' } },
      });
    });
    reopened = rtlRender(page(queryClient()));
    await screen.findAllByText('A sermon in progress');
    await act(async () => { harness.engine.setOnline(true); await harness.engine.retry(); });
    await waitFor(() => expect(harness.server.value).toMatchObject({
      outline: { introduction: [{ subPoints: [] }] },
      planText: { p1: transferred, child: '' },
    }));
  } finally {
    release();
    held?.mockRestore();
    reopened?.unmount();
    view.unmount();
  }
});

it('moves the child once when its exact paragraph is already in the parent', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Opening.\n\nChild paragraph.\n\nClosing.', child: 'Child paragraph.' });
  mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
  const view = await render();
  openPointCells();
  const editor = mountedEditor(view.container);
  typeAtEnd(editor, ' Already typed.');
  const opening = markdown(editor);
  fireEvent.click(screen.getByTitle('plan.deleteSubPoint'));
  fireEvent.click(screen.getByTitle('plan.deleteSubPointConfirm'));
  await waitFor(() => expect(screen.queryByTitle('plan.deleteSubPoint')).not.toBeInTheDocument());
  expect(markdown(editor)).toBe(opening);
  expect(harness.server.value?.planText).toMatchObject({ p1: opening, child: '' });
  expect(undo(editor)).toBe(false);
  expect(screen.getByRole('button', { name: 'plan.save' })).toBeDisabled();
  view.unmount();
});

let mockFailNextRescue = false;
let mockRejectRescueOutline: (() => Promise<never>) | undefined;
let mockWaitForRescue: (() => Promise<void>) | undefined;
const mockRemoveSubPoint = jest.fn();
let mockBeforePlanTextWrite: (() => Promise<void>) | null = null;
let mockBeforeOutlineWrite: (() => Promise<void>) | null = null;
const mockPlanTextWrites = jest.fn();
jest.mock('@/(pages)/(private)/sermons/[id]/plan/useEnginePlanWriter', () => {
  const actual = jest.requireActual('@/(pages)/(private)/sermons/[id]/plan/useEnginePlanWriter');
  return { ...actual, useEnginePlanWriter: (...args: unknown[]) => {
    const result = actual.useEnginePlanWriter(...args);
    const waitForOutline = async () => {
      const beforeWrite = mockBeforeOutlineWrite;
      mockBeforeOutlineWrite = null;
      await beforeWrite?.();
    };
    return { ...result, writer: { ...result.writer,
      updateSermonOutline: async (...params: unknown[]) => {
        await waitForOutline();
        return result.writer.updateSermonOutline(...params);
      },
      removeSubPoint: async (...params: unknown[]) => {
        mockRemoveSubPoint(...params);
        if (params[3]) {
          mockPlanTextWrites(...params);
          const beforeWrite = mockBeforePlanTextWrite;
          mockBeforePlanTextWrite = null;
          if (beforeWrite) await beforeWrite();
          if (mockFailNextRescue) { mockFailNextRescue = false; throw new Error('Injected pre-write storage refusal'); }
        }
        const pause = mockWaitForRescue;
        mockWaitForRescue = undefined;
        if (pause) await pause();
        const refuse = mockRejectRescueOutline;
        mockRejectRescueOutline = undefined;
        if (refuse) return refuse();
        await waitForOutline();
        return result.writer.removeSubPoint(...params);
      },
      savePlanText: async (...params: unknown[]) => {
        return result.writer.savePlanText(...params);
      },
    } };
  } };
});

it('holds the overlapping AI proposal while the subpoint transfer is pending', async () => {
  localStorage.clear();
  mockNoteMode = true;
  let view: Awaited<ReturnType<typeof render>> | undefined;
  let release: (() => void) | undefined;
  try {
    mockSermon = { ...sermon({ p1: 'Opening.', child: 'Child paragraph.' }), sourceNoteIds: ['source-note'] };
    mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
    jest.mocked(generateNotePlanContent).mockResolvedValue({
      contentByNodeId: { p1: 'Requested AI words.', child: 'Requested child words.' },
      missingMaterial: {},
    });
    view = await render();
    const [parentRefinement] = await screen.findAllByRole('button', { name: 'plan.refine.open' });
    fireEvent.click(parentRefinement);
    fireEvent.click(screen.getByRole('button', { name: 'plan.refine.presets.rewrite' }));
    fireEvent.click(screen.getByRole('button', { name: 'plan.refine.submit' }));
    const apply = await screen.findByRole('button', { name: 'plan.fromNote.apply' });
    expect(apply).toBeEnabled();
    mockWaitForRescue = () => new Promise(resolve => { release = resolve; });
    fireEvent.click(screen.getByTitle('plan.deleteSubPoint'));
    fireEvent.click(screen.getByTitle('plan.deleteSubPointConfirm'));
    await waitFor(() => expect(release).toBeDefined());
    expect(apply).toBeDisabled();
    expect(screen.getAllByText('Requested AI words.')).toHaveLength(1);
    await act(async () => { release!(); });
    await waitFor(() => expect(screen.queryByTitle('plan.deleteSubPoint')).not.toBeInTheDocument());
    expect(harness.server.value?.planText).toMatchObject({ p1: 'Opening.\n\nChild paragraph.' });
    expect(screen.getByText('Requested AI words.')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('plan.fromNote.contextChanged');
    expect(apply).toBeDisabled();
  } finally {
    release?.();
    mockWaitForRescue = undefined;
    mockNoteMode = false;
    view?.unmount();
  }
});

it('leaves both cells intact when the combined transfer is refused', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Opening.', child: 'Child paragraph.' });
  mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
  const view = await render();
  let refuse: ((error: Error) => void) | undefined;
  try {
    openPointCells();
    const parent = mountedEditor(view.container);
    mockRejectRescueOutline = () => new Promise((_resolve, reject) => { refuse = reject; });
    fireEvent.click(screen.getByTitle('plan.deleteSubPoint'));
    fireEvent.click(screen.getByTitle('plan.deleteSubPointConfirm'));
    await waitFor(() => expect(refuse).toBeDefined());
    await act(async () => { refuse!(new Error('Injected refusal of combined deletion')); });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('errors.failedToSavePoint'));
    expect(screen.getByTitle('plan.deleteSubPoint')).toBeInTheDocument();
    expect(markdown(parent)).toBe('Opening.');
    const child = view.container.querySelectorAll<HTMLElement & { editor: typeof parent }>('.tiptap')[1].editor;
    expect(markdown(child)).toBe('Child paragraph.');
    expect(harness.server.value?.planText).toMatchObject({ p1: 'Opening.', child: 'Child paragraph.' });
  } finally {
    refuse?.(new Error('Test ended'));
    mockRejectRescueOutline = undefined;
    view.unmount();
  }
});

it('keeps a parent deleted after its child transfer began', async () => {
  localStorage.clear();
  mockRemoveSubPoint.mockClear();
  mockSermon = sermon({ p1: 'Opening.', child: 'Child paragraph.', other: 'Other child paragraph.' });
  mockSermon.outline!.introduction[0].subPoints = [
    { id: 'child', text: 'Child heading', position: 0 },
    { id: 'other', text: 'Other child heading', position: 1 },
  ];
  const view = await render();
  let release: (() => void) | undefined;
  mockWaitForRescue = () => new Promise(resolve => { release = resolve; });
  try {
    openPointCells();
    fireEvent.click(screen.getAllByTitle('plan.deleteSubPoint')[0]);
    fireEvent.click(screen.getByTitle('plan.deleteSubPointConfirm'));
    await waitFor(() => expect(release).toBeDefined());
    await act(async () => { await harness.remote({ outline: { introduction: [], main: [], conclusion: [] },
      planText: { p1: '', child: '', other: '' } }); });
    await waitFor(() => expect(screen.queryByTitle('plan.deletePoint')).not.toBeInTheDocument());
    const sendsBeforeCompletion = jest.mocked(harness.transport.send).mock.calls.length;
    await act(async () => { release!(); });
    expect(mockRemoveSubPoint).toHaveBeenCalledWith('sermon-1', 'p1', 'child', expect.any(Object));
    for (const [command] of jest.mocked(harness.transport.send).mock.calls.slice(sendsBeforeCompletion)) {
      expect(command.kind === 'update' && command.changes.some(change => change.path[0] === 'outline')).toBe(false);
    }
    expect(harness.server.value?.outline).toMatchObject({ introduction: [] });
    expect(screen.queryByTitle('plan.deletePoint')).not.toBeInTheDocument();
  } finally {
    release?.();
    mockWaitForRescue = undefined;
    view.unmount();
  }
});

it('shows transferred words when the child heading was already removed elsewhere', async () => {
  localStorage.clear();
  mockRemoveSubPoint.mockClear();
  mockSermon = sermon({ p1: 'Opening.', child: 'Child paragraph.' });
  mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
  const view = await render();
  let release: (() => void) | undefined;
  mockWaitForRescue = () => new Promise(resolve => { release = resolve; });
  try {
    openPointCells();
    const editor = mountedEditor(view.container);
    fireEvent.click(screen.getByTitle('plan.deleteSubPoint'));
    fireEvent.click(screen.getByTitle('plan.deleteSubPointConfirm'));
    await waitFor(() => expect(release).toBeDefined());
    await act(async () => { await harness.remote({ outline: {
      introduction: [{ id: 'p1', text: 'First point', subPoints: [] }], main: [], conclusion: [],
    }, planText: { p1: 'Opening.\n\nChild paragraph.', child: '' } }); });
    await waitFor(() => expect(screen.queryByTitle('plan.deleteSubPoint')).not.toBeInTheDocument());
    await act(async () => { release!(); });
    expect(mockRemoveSubPoint).toHaveBeenCalledWith('sermon-1', 'p1', 'child', expect.any(Object));
    expect(markdown(editor)).toBe('Opening.\n\nChild paragraph.');
    for (const [command] of jest.mocked(harness.transport.send).mock.calls) {
      expect(command.kind === 'update' && command.changes.some(change => change.path[0] === 'outline')).toBe(false);
    }
  } finally {
    release?.();
    mockWaitForRescue = undefined;
    view.unmount();
  }
});

it.each(['child', 'parent'] as const)('keeps the last visible copy when the %s was removed without transferring the child words', async removed => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Opening.', child: 'Child paragraph.' });
  mockSermon.planMode = 'manual';
  mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
  const view = await render({ held: async () => false, hold: () => () => undefined });
  const gate = deferred();
  let reached = false;
  mockWaitForRescue = () => { reached = true; return gate.promise; };
  let reopened: ReturnType<typeof rtlRender> | undefined;
  const resource = { collection: 'sermons', id: 'sermon-1' };
  try {
    fireEvent.click(screen.getByTitle('plan.deleteSubPoint'));
    fireEvent.click(screen.getByTitle('plan.deleteSubPointConfirm'));
    await waitFor(() => expect(reached).toBe(true));
    const introduction = removed === 'parent' ? [] : [{ id: 'p1', text: 'First point', subPoints: [] }];
    const planText = { p1: removed === 'parent' ? '' : 'Opening.', child: '' };
    await act(async () => { await harness.remote({ outline: { introduction, main: [], conclusion: [] }, planText }); });
    await waitFor(() => expect(screen.queryByTitle('plan.deleteSubPoint')).not.toBeInTheDocument());
    jest.mocked(harness.transport.send).mockClear();
    await act(async () => { gate.resolve(); await gate.promise; });
    const dialog = await screen.findByRole('status', { name: 'plan.orphanedTitle' });
    expect(within(dialog).getByText('Child paragraph.')).toBeVisible();
    const copies = await harness.checkpoints.listRecoverable('user-1', resource);
    expect(copies.some(({ record }) => record.checkpoint.planCellDrafts?.child?.text === 'Child paragraph.')).toBe(true);
    expect(listDraftKeys()).toEqual([]);
    expect(harness.server.value).toMatchObject({ outline: { introduction }, planText });
    view.unmount();
    const independent = draftKey('user-1', 'sermon-1', 'plan:child', 'other-opening');
    saveDraft(independent, 'Child paragraph from the other opening.');
    reopened = rtlRender(page(queryClient()));
    const retained = await screen.findByText('Child paragraph.');
    expect(retained).toBeVisible();
    expect(screen.queryByTitle('plan.deleteSubPoint')).not.toBeInTheDocument();
    const leaving = new Event('beforeunload', { cancelable: true });
    fireEvent(window, leaving);
    expect(leaving.defaultPrevented).toBe(false);
    fireEvent.click(within(retained.closest('li')!).getByRole('button', { name: 'plan.orphanedDiscard' }));
    fireEvent.click(await screen.findByRole('button', { name: 'common.discardText.confirm' }));
    await waitFor(async () => {
      expect(screen.queryByText('Child paragraph.')).not.toBeInTheDocument();
      expect(await harness.checkpoints.listRecoverable('user-1', resource)).toHaveLength(0);
    });
    expect(readDraft(independent)?.value).toBe('Child paragraph from the other opening.');
    expect(harness.transport.send).not.toHaveBeenCalled();
  } finally {
    gate.resolve();
    mockWaitForRescue = undefined;
    reopened?.unmount();
    view.unmount();
  }
});

it('retains typed plan text separately when a remote deletion clears the card and its saved text', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Opening words.' });
  mockSermon.planMode = 'manual';
  const view = await render();
  const words = 'Opening words. Kept on this device.';
  const resource = { collection: 'sermons', id: 'sermon-1' };
  try {
    openPointCells();
    typeAtEnd(mountedEditor(view.container), ' Kept on this device.');
    await act(async () => { await settleEngine(); });

    await act(async () => {
      await harness.remote({ outline: { introduction: [], main: [], conclusion: [] }, planText: { p1: '' } });
    });

    const panel = await screen.findByRole('status', { name: 'plan.orphanedTitle' });
    expect(within(panel).getAllByText(words, { exact: true })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'First point' })).not.toBeInTheDocument();

    view.showPlan(false);
    await act(async () => { await settleEngine(); });
    view.showPlan(true);
    const reopened = await screen.findByRole('status', { name: 'plan.orphanedTitle' });
    expect(within(reopened).getAllByText(words, { exact: true })).toHaveLength(1);
    expect((await harness.checkpoints.listRecoverable('user-1', resource)).some(({ record }) =>
      record.planCellAlternative && record.checkpoint.planCellDrafts?.p1?.text === words)).toBe(true);
    expect(listDraftKeys()).toEqual([]);
    expect(harness.transport.send).not.toHaveBeenCalled();
  } finally {
    view.unmount();
  }
});

it('keeps only the latest keystrokes when the shown cell has no verified opening', async () => {
  localStorage.clear();
  const shown = 'Words still shown from an earlier view.';
  const saved = 'Newer words already observed by the engine.';
  const latest = shown + ' First letters and the rest.';
  const resource = { collection: 'sermons', id: 'sermon-1' };
  mockSermon = sermon({ p1: saved });
  mockSermon.planMode = 'manual';

  const saveRefusal = jest.fn();
  function UnverifiedView() {
    const document = useDataDocument(resource);
    const [text, setText] = React.useState(shown);
    if (!document.state) return null;
    return <PlanCellDocument.Provider value={document}>
      <h1>A sermon in progress</h1>
      <PlanCellEditor nodeId="p1" value={text} onChange={setText} />
      <button onClick={() => void document.savePlanCells(['p1']).catch(saveRefusal)}>Save</button>
    </PlanCellDocument.Provider>;
  }

  const view = await render(undefined, <UnverifiedView />);
  const editor = mountedEditor(view.container);
  expect(editor.isEditable).toBe(true);
  expect(markdown(editor)).toBe(shown);
  const retained = async () => (await harness.checkpoints.listRecoverable('user-1', resource))
    .map(({ record }) => record.checkpoint).filter(checkpoint => checkpoint.planCellDrafts?.p1);
  jest.mocked(harness.transport.send).mockClear();

  typeAtEnd(editor, ' First letters');
  typeAtEnd(editor, ' and the rest.');
  expect(markdown(editor)).toBe(latest);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await act(async () => { view.showPlan(false); await settleEngine(); });

  await waitFor(async () => expect((await retained()).map(copy => copy.planCellDrafts?.p1?.text)).toEqual([latest]));
  const [copy] = await retained();
  expect(copy.conflicts).toEqual([{ path: ['planText', 'p1'], base: { exists: true, value: shown },
    mine: { exists: true, value: latest }, theirs: { exists: true, value: saved } }]);
  expect(saveRefusal).toHaveBeenCalledWith(expect.objectContaining({ code: 'resolve-version-first' }));
  expect(harness.server.value?.planText).toEqual({ p1: saved });
  expect(harness.transport.send).not.toHaveBeenCalled();
});

it.each(['append', 'clear'] as const)('respects the latest action while the removed card is being set aside (%s)', async action => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Opening words.' });
  mockSermon.planMode = 'manual';
  const view = await render();
  const first = 'Opening words. First addition.';
  const last = first + ' Last letters.';
  const resource = { collection: 'sermons', id: 'sermon-1' };
  const started = deferred();
  const release = deferred();
  const nativeCreate = harness.checkpoints.create;
  const storage = jest.spyOn(harness.checkpoints, 'create').mockImplementation(async (record, source) => {
    await nativeCreate(record, source);
    if (record.planCellAlternative && record.checkpoint.planCellDrafts?.p1?.text === first) {
      started.resolve();
      await release.promise;
    }
  });
  let arrival: Promise<void> | undefined;
  try {
    openPointCells();
    const editor = mountedEditor(view.container);
    typeAtEnd(editor, ' First addition.');
    await act(async () => { await settleEngine(); });

    await act(async () => {
      arrival = harness.remote({ outline: { introduction: [], main: [], conclusion: [] }, planText: { p1: '' } });
      await started.promise;
    });
    if (action === 'append') typeAtEnd(editor, ' Last letters.');
    else act(() => { editor.commands.clearContent(); });
    await act(async () => { release.resolve(); await arrival; });

    const retainedWords = async () => (await harness.checkpoints.listRecoverable('user-1', resource))
      .filter(({ record }) => record.planCellAlternative).map(({ record }) => record.checkpoint.planCellDrafts?.p1?.text);
    const expected = action === 'append' ? [last] : [];
    await waitFor(async () => expect(await retainedWords()).toEqual(expected));
    const recoveryText = () => screen.queryByRole('status', { name: 'plan.orphanedTitle' });
    const checkWords = () => {
      const panel = recoveryText();
      if (action === 'clear') expect(panel).not.toBeInTheDocument();
      else {
        expect(within(panel!).getAllByText(last, { exact: true })).toHaveLength(1);
        expect(within(panel!).queryByText(first, { exact: true })).not.toBeInTheDocument();
      }
    };
    await waitFor(checkWords);
    expect(screen.queryByRole('heading', { name: 'First point' })).not.toBeInTheDocument();

    view.showPlan(false);
    await act(async () => { await settleEngine(); });
    view.showPlan(true);
    await screen.findByText('A sermon in progress');
    await waitFor(checkWords);
    expect(await retainedWords()).toEqual(expected);
    expect(listDraftKeys()).toEqual([]);
    expect(harness.transport.send).not.toHaveBeenCalled();
  } finally {
    release.resolve();
    await arrival;
    storage.mockRestore();
    view.unmount();
  }
});

it('keeps one native orphan copy if the plan closes during its durable write', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Opening.', child: 'Child paragraph.' });
  mockSermon.planMode = 'manual';
  mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
  const view = await render();
  const gate = deferred();
  let atRemoval = false, atReceipt = false;
  mockWaitForRescue = () => { atRemoval = true; return gate.promise; };
  harness.storage.holdCompletionAfterCommit = (rows, mode) => {
    if (atReceipt || mode !== 'readwrite') return false;
    atReceipt = [...rows.values()].some(value => Boolean((value as { planCellAlternative?: boolean })?.planCellAlternative));
    return atReceipt;
  };
  try {
    fireEvent.click(screen.getByTitle('plan.deleteSubPoint'));
    fireEvent.click(screen.getByTitle('plan.deleteSubPointConfirm'));
    await waitFor(() => expect(atRemoval).toBe(true));
    await act(async () => { await harness.remote({ outline: { introduction: [], main: [], conclusion: [] }, planText: { p1: '', child: '' } }); });
    await waitFor(() => expect(screen.queryByTitle('plan.deleteSubPoint')).not.toBeInTheDocument());
    await act(async () => { gate.resolve(); await gate.promise; });
    await waitFor(() => expect(atReceipt).toBe(true));

    view.showPlan(false);
    await act(async () => { harness.storage.finishCompletion(); await settleEngine(); });

    expect(listDraftKeys()).toEqual([]);
    view.showPlan(true);
    expect(await screen.findByText('Child paragraph.')).toBeVisible();
  } finally {
    gate.resolve();
    harness.storage.holdCompletionAfterCommit = undefined;
    if (atReceipt) harness.storage.finishCompletion();
    mockWaitForRescue = undefined;
    view.unmount();
  }
});

it.each(['stay', 'close'] as const)('offers the exact orphan reserve when its IndexedDB write refuses (%s)', async departure => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Opening.', child: 'Child words for recovery.' });
  mockSermon.planMode = 'manual';
  mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
  const view = await render();
  const removing = deferred();
  const writing = deferred();
  let removalStarted = false;
  mockWaitForRescue = () => { removalStarted = true; return removing.promise; };
  const create = harness.checkpoints.create;
  const started = jest.fn();
  const storage = jest.spyOn(harness.checkpoints, 'create').mockImplementation(async (record, source) => {
    if (!record.planCellAlternative) return create(record, source);
    started();
    await writing.promise;
    throw new Error('The device refused this independent checkpoint');
  });
  try {
    fireEvent.click(screen.getByTitle('plan.deleteSubPoint'));
    fireEvent.click(screen.getByTitle('plan.deleteSubPointConfirm'));
    await waitFor(() => expect(removalStarted).toBe(true));
    await act(async () => {
      await harness.remote({ outline: { introduction: [], main: [], conclusion: [] }, planText: {} });
    });
    await waitFor(() => expect(screen.queryByTitle('plan.deleteSubPoint')).not.toBeInTheDocument());
    await act(async () => { removing.resolve(); await removing.promise; });
    await waitFor(() => expect(started).toHaveBeenCalled());

    if (departure === 'close') {
      view.showPlan(false);
      expect(listDraftKeys().map(key => readDraft(key)?.value)).toEqual(['Child words for recovery.']);
      view.showPlan(true);
      expect(await screen.findByText('Child words for recovery.')).toBeVisible();
    }
    await act(async () => { writing.resolve(); await settleEngine(); });
    const panel = await screen.findByRole('status', { name: 'plan.orphanedTitle' });
    expect(within(panel).getAllByText('Child words for recovery.')).toHaveLength(1);
    expect(listDraftKeys().map(key => readDraft(key)?.value)).toEqual(['Child words for recovery.']);
    expect(harness.server.value?.planText).toEqual({});
  } finally {
    removing.resolve();
    writing.resolve();
    storage.mockRestore();
    mockWaitForRescue = undefined;
    view.unmount();
  }
});

it('reveals each delete with its heading until that cell opens for writing', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Opening.', child: 'Child paragraph.' });
  mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
  const view = await render();
  try {
    const deletePoint = screen.getByTitle('plan.deletePoint');
    const deleteChild = screen.getByTitle('plan.deleteSubPoint');
    expect(deletePoint.closest('h3')).toHaveClass('row');
    expect(deleteChild.closest('h4')).toHaveClass('row');
    expect(deletePoint).toHaveClass('actions');
    expect(deleteChild).toHaveClass('actions');

    fireEvent.click(screen.getAllByTitle('plan.editMode')[0]);
    expect(deletePoint).not.toHaveClass('actions');
    expect(deleteChild).toHaveClass('actions');

    fireEvent.click(deleteChild);
    const armed = screen.getByTitle('plan.deleteSubPointConfirm');
    expect(armed).toBe(deleteChild);
    fireEvent.blur(armed);
    expect(deleteChild).toHaveAttribute('title', 'plan.deleteSubPoint');
    expect(harness.server.value?.outline).toMatchObject({ introduction: [{ subPoints: [{ id: 'child' }] }] });
  } finally {
    view.unmount();
  }
});

it('can delete the whole point after deleting one of its children', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Opening.', child: 'Child paragraph.' });
  mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
  const view = await render();
  try {
    const title = screen.getByRole('button', { name: 'plan.renamePoint' });
    fireEvent.click(title);
    fireEvent.change(screen.getByRole('textbox', { name: 'plan.renamePoint' }), { target: { value: 'Renamed point' } });
    fireEvent.blur(screen.getByRole('textbox', { name: 'plan.renamePoint' }));
    await waitFor(() => expect(harness.server.value?.outline).toMatchObject({ introduction: [{ text: 'Renamed point' }] }));
    openPointCells();
    fireEvent.click(screen.getByTitle('plan.deleteSubPoint'));
    fireEvent.click(screen.getByTitle('plan.deleteSubPointConfirm'));
    await waitFor(() => expect(harness.server.value?.outline).toMatchObject({ introduction: [{ subPoints: [] }] }));
    fireEvent.click(screen.getByTitle('plan.deletePoint'));
    fireEvent.click(screen.getByTitle('plan.deletePointConfirm'));
    await waitFor(() => expect(harness.server.value?.outline).toMatchObject({ introduction: [] }));
  } finally {
    view.unmount();
  }
});

let mockConspectus: ManualConspectus;
jest.mock('@/(pages)/(private)/sermons/[id]/plan/manual/useManualConspectus', () => {
  const actual = jest.requireActual('@/(pages)/(private)/sermons/[id]/plan/manual/useManualConspectus');
  return { ...actual, useManualConspectus: (...args: unknown[]) => {
    mockConspectus = actual.useManualConspectus(...args);
    return mockConspectus;
  } };
});

let mockGeneration: ReturnType<typeof import('@/(pages)/(private)/sermons/[id]/plan/manual/useNotePlanGeneration').useNotePlanGeneration>;
jest.mock('@/(pages)/(private)/sermons/[id]/plan/manual/useNotePlanGeneration', () => {
  const actual = jest.requireActual('@/(pages)/(private)/sermons/[id]/plan/manual/useNotePlanGeneration');
  return { ...actual, useNotePlanGeneration: (...args: unknown[]) => {
    mockGeneration = actual.useNotePlanGeneration(...args);
    return mockGeneration;
  } };
});

describe('manual deletion locks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockBeforePlanTextWrite = null;
    mockBeforeOutlineWrite = null;
    mockFailNextRescue = false;
    mockNoteMode = false;
    mockSermon = sermon({ p1: 'Opening.', child: 'Child words.', other: 'Other.' });
    mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
    mockSermon.outline!.main = [{ id: 'other', text: 'Other heading' }];
  });

  const removeChild = () => {
    fireEvent.click(screen.getByTitle('plan.deleteSubPoint'));
    fireEvent.click(screen.getByTitle('plan.deleteSubPointConfirm'));
  };
  const begin = async () => {
    const view = await render();
    screen.getAllByRole('button', { name: 'plan.editMode' }).forEach(button => fireEvent.click(button));
    const editors = Array.from(view.container.querySelectorAll<HTMLElement>('.tiptap'))
      .map(element => mountedEditor(element.parentElement!));
    const gate = deferred();
    const before = jest.fn(() => gate.promise);
    mockBeforePlanTextWrite = before;
    const actions = mockConspectus;
    removeChild();
    await waitFor(() => expect(before).toHaveBeenCalledTimes(1));
    return { view, parent: editors[0], child: editors[1], other: editors[2], gate, actions };
  };
  const attemptTyping = async (editor: ReturnType<typeof mountedEditor>) => {
    act(() => { editor.view.dom.focus(); });
    await userEvent.type(editor.view.dom, ' Later typing', { skipClick: true });
  };

  it('uses the offline transfer for a durable child without creating a second draft', async () => {
    mockSermon!.planMode = 'manual';
    const view = await render();
    let reopened: ReturnType<typeof rtlRender> | undefined;
    try {
      openPointCells();
      const child = view.container.querySelectorAll<HTMLElement>('.tiptap')[1];
      typeAtEnd(mountedEditor(child.parentElement!), ' Written on this device.');
      const words = 'Child words. Written on this device.';
      const resource = { collection: 'sermons', id: 'sermon-1' };
      await waitFor(async () => {
        const copies = await harness.checkpoints.listRecoverable('user-1', resource);
        expect(copies.some(({ record }) => record.checkpoint.planCellDrafts?.child?.text === words)).toBe(true);
      });
      act(() => { harness.engine.setOnline(false); });

      removeChild();

      await waitFor(() => expect(screen.queryByTitle('plan.deleteSubPoint')).not.toBeInTheDocument());
      expect(listDraftKeys()).toEqual([]);
      expect(harness.server.value?.planText).toMatchObject({ child: 'Child words.' });
      await waitFor(async () => {
        const requests = await harness.commits.list('user-1');
        const transfer = requests.find(request => request.planTextEvidence?.planSubpointTransfer?.subPointId === 'child');
        expect(transfer).toMatchObject({
          value: expect.objectContaining({ planText: expect.objectContaining({ p1: 'Opening.\n\n' + words }) }),
        });
        expect(['prepared', 'queued']).toContain(transfer?.state);
      });
      view.unmount();
      reopened = rtlRender(page(queryClient()));
      await screen.findAllByText('A sermon in progress');
      await act(async () => { harness.engine.setOnline(true); await harness.engine.retry(); });
      await waitFor(() => expect(harness.server.value?.planText).toMatchObject({ p1: 'Opening.\n\n' + words, child: '' }));
    } finally { reopened?.unmount(); view.unmount(); }
  });

  it.each([false, true])('transfers the restored child from the engine and retains the independent copy (token=%s)', async token => {
    mockSermon!.planMode = 'manual';
    const words = 'Words restored from a previous opening.';
    const chosen = draftKey('user-1', 'sermon-1', 'plan:child', token ? 'chosen-opening' : undefined);
    const independent = draftKey('user-1', 'sermon-1', 'plan:child', 'independent-opening');
    saveDraft(chosen, words, undefined, token);
    const view = await render();
    try {
      fireEvent.click(await screen.findByRole('button', { name: 'plan.draftRecoveryRestore' }));
      await waitFor(() => {
        expect(mockConspectus.contentByNodeId.child).toBe(words);
        expect(readDraft(chosen)).toBeNull();
      });
      saveDraft(independent, words, undefined, true);
      act(() => { harness.engine.setOnline(false); });
      removeChild();
      await waitFor(() => expect(screen.queryByTitle('plan.deleteSubPoint')).not.toBeInTheDocument());
      expect(harness.server.value?.planText).toMatchObject({ child: 'Child words.' });
      await act(async () => { harness.engine.setOnline(true); await harness.engine.retry(); });
      await waitFor(() => expect(harness.server.value?.planText).toMatchObject({ p1: 'Opening.\n\n' + words, child: '' }));
      expect(readDraft(independent)?.value).toBe(words);
    } finally { view.unmount(); }
  });

  it.each([
    ['other', 'stay'], ['p1', 'stay'], ['child', 'stay'], ['p1', 'leave'], ['child', 'leave'], ['child', 'keep typing'],
    ['p1', 'rename the point'], ['child', 'rename the point'],
  ] as const)('completes removal behind an earlier %s Save with a held local callback when you %s', async (nodeId, departure) => {
    mockSermon!.planMode = 'manual';
    const view = await render();
    const opening = { p1: 'Opening.', child: 'Child words.', other: 'Other.' };
    const updated = { ...opening, [nodeId]: opening[nodeId] + ' Typed before removal.' };
    let reached = false;
    let waiting = false;
    harness.storage.holdCompletionAfterCommit = (rows, mode) => {
      if (reached || mode !== 'readwrite') return false;
      const save = [...rows.values()].some(value => {
        const request = value as CommitRequest | undefined;
        const plan = request?.value?.planText as Record<string, string> | undefined;
        return request?.state === 'queued' && !request.planTextEvidence?.planSubpointTransfer && plan?.[nodeId] === updated[nodeId];
      });
      if (save) reached = waiting = true;
      return save;
    };
    const release = () => {
      harness.storage.holdCompletionAfterCommit = undefined;
      if (waiting) { waiting = false; harness.storage.finishCompletion(); }
    };
    let reopened: ReturnType<typeof rtlRender> | undefined;
    let transferredBackup: string | undefined;
    const independentBackup = draftKey('user-1', 'sermon-1', `plan:${nodeId}`, 'separate-opening');
    try {
      const pointIndex = nodeId === 'other' ? 1 : 0;
      openPointCells(pointIndex);
      const editorRoot = view.container.querySelectorAll<HTMLElement>('.tiptap')[nodeId === 'child' ? 1 : 0];
      const editor = mountedEditor(editorRoot.parentElement!);
      typeAtEnd(editor, ' Typed before removal.');
      if (departure === 'leave') {
        fireEvent(window, new Event('pagehide'));
        transferredBackup = listDraftKeys().find(key => readDraft(key)?.value === updated[nodeId]);
        expect(transferredBackup).toBeDefined();
        saveDraft(independentBackup, updated[nodeId]);
      }
      fireEvent.click(screen.getAllByTitle('plan.save')[pointIndex]);
      await waitFor(() => expect(reached).toBe(true));
      if (departure === 'keep typing') typeAtEnd(editor, ' Typed after Save.');
      if (departure === 'rename the point') {
        fireEvent.click(screen.getAllByRole('button', { name: 'plan.renamePoint' })[0]);
        const title = screen.getByRole('textbox', { name: 'plan.renamePoint' });
        fireEvent.change(title, { target: { value: 'Renamed during Save' } });
        fireEvent.blur(title);
        await screen.findByText('Renamed during Save');
      }
      removeChild();
      await waitFor(() => expect(mockRemoveSubPoint).toHaveBeenCalledTimes(1));
      if (departure === 'leave') {
        await waitFor(() => expect(screen.queryByTitle('plan.deleteSubPoint')).not.toBeInTheDocument());
        view.unmount();
      }
      await act(async () => { release(); });
      if (departure === 'leave') {
        reopened = rtlRender(page(queryClient()));
        await screen.findAllByText('A sermon in progress');
        await act(async () => { await harness.engine.retry(); });
      }
      const parent = updated.p1 + '\n\n' + updated.child + (departure === 'keep typing' ? ' Typed after Save.' : '');
      await waitFor(() => expect(harness.server.value).toMatchObject({
        outline: { introduction: [{ text: departure === 'rename the point' ? 'Renamed during Save' : 'First point', subPoints: [] }] },
        planText: { p1: parent, child: '', other: updated.other },
      }));
      expect(toast.error).not.toHaveBeenCalled();
      if (transferredBackup) {
        await waitFor(() => expect(readDraft(transferredBackup!)).toBeNull());
        expect(readDraft(independentBackup)?.value).toBe(updated[nodeId]);
      }
    } finally { release(); reopened?.unmount(); view.unmount(); }
  });

  it('waits for a pending sub-point deletion when leaving through Back to sermon', async () => {
    const { view, gate } = await begin();
    try {
      const warning = new Event('beforeunload', { cancelable: true });
      fireEvent(window, warning);
      expect(warning.defaultPrevented).toBe(true);
      fireEvent.click(screen.getByTestId('plan-header-back'));
      expect(mockPush).not.toHaveBeenCalled();

      await act(async () => { gate.resolve(); });
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/sermons/sermon-1'));
      await waitFor(() => expect(harness.server.value?.outline).toMatchObject({ introduction: [{ subPoints: [] }] }));
      const settled = new Event('beforeunload', { cancelable: true });
      fireEvent(window, settled);
      expect(settled.defaultPrevented).toBe(false);
    } finally {
      gate.resolve();
      view.unmount();
    }
  });

  it('stays in the plan when a pending deletion refuses while leaving', async () => {
    const { view, gate } = await begin();
    try {
      const nav = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      fireEvent(screen.getByTestId('plan-header-back'), nav);
      expect(nav.defaultPrevented).toBe(true);
      await act(async () => { gate.reject(new Error('Injected device write refusal')); });
      expect(mockPush).not.toHaveBeenCalled();
      expect(screen.getByTitle('plan.deleteSubPoint')).toBeEnabled();
      expect(toast.error).toHaveBeenCalled();
    } finally {
      gate.resolve();
      view.unmount();
    }
  });

  it('prevents orphan Discard confirmation during deletion and clears text and dirty state after refusal', async () => {
    const view = await render();
    openPointCells();
    typeAtEnd(mountedEditor(view.container), ' Unsaved local words.');
    const gate = deferred();
    const before = jest.fn(() => gate.promise);
    mockBeforeOutlineWrite = before;
    fireEvent.click(screen.getAllByTitle('plan.deletePoint')[0]);
    fireEvent.click(screen.getByTitle('plan.deletePointConfirm'));
    await waitFor(() => expect(before).toHaveBeenCalledTimes(1));
    await act(async () => {
      await harness.remote({ outline: { introduction: [], main: [], conclusion: [] } });
    });
    const localCopy = () => screen.getByText('Opening. Unsaved local words.').closest('li')!;
    const discard = within(localCopy()).getByRole('button', { name: 'plan.orphanedDiscard' });
    expect(discard).toBeDisabled();
    fireEvent.click(discard);
    expect(screen.queryByRole('button', { name: 'common.discardText.confirm' })).not.toBeInTheDocument();
    expect(mockConspectus.contentByNodeId.p1).toBe('Opening. Unsaved local words.');
    expect(mockConspectus.modifiedNodeIds.p1).toBe(true);

    await act(async () => {
      gate.reject(new Error('Injected deletion refusal'));
    });
    await waitFor(() => expect(mockConspectus.busyNodeIds.size).toBe(0));
    fireEvent.click(within(localCopy()).getByRole('button', { name: 'plan.orphanedDiscard' }));
    fireEvent.click(await screen.findByRole('button', { name: 'common.discardText.confirm' }));
    await waitFor(() => {
      expect(mockConspectus.contentByNodeId.p1).toBeUndefined();
      expect(mockConspectus.modifiedNodeIds.p1).toBeUndefined();
    });
    expect(screen.queryByText('Opening. Unsaved local words.')).not.toBeInTheDocument();
  });

  it('withdraws an open orphan Discard confirmation when its cell becomes busy', async () => {
    const cells = [{ id: 'p1', text: 'Unsaved orphan words.' }];
    const onDiscard = jest.fn();
    const view = rtlRender(<OrphanedPlanText cells={cells} onDiscard={onDiscard} busyNodeIds={new Set()} />);
    fireEvent.click(screen.getByRole('button', { name: 'plan.orphanedDiscard' }));
    expect(screen.getByRole('button', { name: 'common.discardText.confirm' })).toBeInTheDocument();
    view.rerender(<OrphanedPlanText cells={cells} onDiscard={onDiscard} busyNodeIds={new Set(['p1'])} />);
    expect(screen.queryByRole('button', { name: 'common.discardText.confirm' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'plan.orphanedDiscard' })).toBeDisabled();
    expect(onDiscard).not.toHaveBeenCalled();
    view.rerender(<OrphanedPlanText cells={cells} onDiscard={onDiscard} busyNodeIds={new Set()} />);
    fireEvent.click(screen.getByRole('button', { name: 'plan.orphanedDiscard' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.discardText.confirm' }));
    await waitFor(() => expect(onDiscard).toHaveBeenCalledWith(cells));
  });

  it('locks both rescued cells through the outline write and leaves another point editable', async () => {
    const { parent, child, other, gate } = await begin();
    expect(parent.isEditable).toBe(false);
    expect(child.isEditable).toBe(false);
    expect(screen.getAllByTitle('plan.save')[0]).toBeDisabled();
    await attemptTyping(parent);
    await attemptTyping(child);
    expect(markdown(parent)).toBe('Opening.');
    expect(markdown(child)).toBe('Child words.');
    expect(other.isEditable).toBe(true);
    typeAtEnd(other, ' Still editable');
    const outlineGate = deferred();
    const beforeOutline = jest.fn(() => outlineGate.promise);
    mockBeforeOutlineWrite = beforeOutline;
    await act(async () => { gate.resolve(); });
    await waitFor(() => expect(beforeOutline).toHaveBeenCalledTimes(1));
    expect(parent.isEditable).toBe(false);
    expect(child.isEditable).toBe(false);
    await act(async () => { outlineGate.resolve(); });
    await waitFor(() => expect(parent.isEditable).toBe(true));
    expect(markdown(parent)).toBe('Opening.\n\nChild words.');
    expect(markdown(other)).toBe('Other. Still editable');
    expect(mockPlanTextWrites).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(harness.server.value?.planText).toMatchObject({ p1: 'Opening.\n\nChild words.', child: '' }));
  });

  it.each(['refused', 'queued'] as const)('releases the rescue lock after a %s text write', async outcome => {
    const { parent, child, gate } = await begin();
    expect(parent.isEditable).toBe(false);
    expect(child.isEditable).toBe(false);
    if (outcome === 'queued') {
      act(() => { harness.engine.setOnline(false); });
      await act(async () => { gate.resolve(); });
    } else {
      await act(async () => { gate.reject(new Error('Injected refusal')); });
    }
    await waitFor(() => expect(parent.isEditable).toBe(true));
    if (outcome === 'refused') {
      expect(child.isEditable).toBe(true);
      expect(markdown(parent)).toBe('Opening.');
      expect(markdown(child)).toBe('Child words.');
      expect(screen.getByTitle('plan.deleteSubPoint')).toBeEnabled();
      expect(harness.server.value?.planText).toMatchObject({ p1: 'Opening.', child: 'Child words.' });
    } else {
      expect(screen.queryByTitle('plan.deleteSubPoint')).not.toBeInTheDocument();
      expect(markdown(parent)).toBe('Opening.\n\nChild words.');
      expect((harness.server.value?.planText as Record<string, string>).p1).toBe('Opening.');
      await act(async () => { harness.engine.setOnline(true); await harness.engine.retry(); });
      await waitFor(() => expect((harness.server.value?.outline as Sermon['outline'])!.introduction[0].subPoints).toEqual([]));
      expect((harness.server.value?.planText as Record<string, string>).p1).toBe('Opening.\n\nChild words.');
      expect(toast.error).not.toHaveBeenCalled();
    }
  });

  it('U66-03 rejects stale editor callbacks and draft writes at the door during rescue', async () => {
    const { parent, child, gate, actions } = await begin();
    act(() => {
      actions.setNodeContent('p1', 'Typing during rescue.');
      actions.setNodeContent('child', 'Child typing during rescue.');
    });
    expect(mockConspectus.contentByNodeId.p1).toBe('Opening.');
    expect(mockConspectus.contentByNodeId.child).toBe('Child words.');
    act(() => {
      expect(actions.restoreCells({ p1: 'Recovered words.', other: 'Other draft.' })).toBe(false);
      actions.discardCells(['p1']);
    });
    expect(mockConspectus.contentByNodeId.p1).toBe('Opening.');
    expect(mockConspectus.contentByNodeId.child).toBe('Child words.');
    expect(mockConspectus.contentByNodeId.other).toBe('Other.');
    expect(mockConspectus.modifiedNodeIds.p1).not.toBe(true);
    await attemptTyping(parent);
    await attemptTyping(child);
    await act(async () => { gate.resolve(); });
    await waitFor(() => expect(parent.isEditable).toBe(true));
    expect(markdown(parent)).toBe('Opening.\n\nChild words.');
    expect((harness.server.value?.planText as Record<string, string>).p1).toBe('Opening.\n\nChild words.');
  });

  it('holds text actions synchronously before the deletion state renders', async () => {
    await render();
    await waitFor(() => expect(mockConspectus.contentByNodeId.p1).toBe('Opening.'));
    const actions = mockConspectus;
    const gate = deferred();
    mockBeforePlanTextWrite = () => gate.promise;
    let deletion: Promise<void>;
    act(() => {
      deletion = actions.deleteSubPoint('p1', 'child');
      actions.setNodeContent('p1', 'Same tick typing.');
      expect(actions.restoreCells({ child: 'Same tick AI.' })).toBe(false);
    });
    expect(mockConspectus.contentByNodeId.p1).toBe('Opening.');
    expect(mockConspectus.contentByNodeId.child).toBe('Child words.');
    await act(async () => { gate.resolve(); await deletion; });
    expect(mockConspectus.busyNodeIds.size).toBe(0);
  });

  it.each(['point', 'sub-point'] as const)('R02/R04 shows incoming text during a pending %s outline write and preserves it on the next Save', async deletion => {
    const view = await render();
    openPointCells();
    const parent = mountedEditor(view.container);
    const gate = deferred();
    const before = jest.fn(() => gate.promise);
    mockBeforeOutlineWrite = before;
    if (deletion === 'point') {
      fireEvent.click(screen.getAllByTitle('plan.deletePoint')[0]);
      fireEvent.click(screen.getByTitle('plan.deletePointConfirm'));
    } else removeChild();
    await waitFor(() => expect(before).toHaveBeenCalledTimes(1));
    await act(async () => { await harness.remote({ planText: { p1: 'Phone words.', child: deletion === 'point' ? 'Child words.' : '', other: 'Other.' } }); });
    // This display/Save history also passes on production. Busy must never hide observations.
    expect(markdown(parent)).toBe('Phone words.');
    await act(async () => { gate.reject(new Error('Injected outline refusal')); });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(markdown(parent)).toBe('Phone words.');
    await act(async () => { await mockConspectus.savePoint('p1', 'introduction', ['p1', 'child']); });
    expect((harness.server.value?.planText as Record<string, string>).p1).toBe('Phone words.');
    typeAtEnd(parent, ' New edit.');
    fireEvent.click(screen.getAllByTitle('plan.save')[0]);
    await waitFor(() => expect((harness.server.value?.planText as Record<string, string>).p1).toBe('Phone words. New edit.'));
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('shows an incoming version immediately in the read-only editor during the outline wait', async () => {
    const { parent, gate } = await begin();
    const outlineGate = deferred();
    const before = jest.fn(() => outlineGate.promise);
    mockBeforeOutlineWrite = before;
    await act(async () => { gate.resolve(); });
    await waitFor(() => expect(before).toHaveBeenCalledTimes(1));
    expect(parent.isEditable).toBe(false);
    await act(async () => { await harness.remote({ planText: { p1: 'Phone words.', child: '', other: 'Other.' } }); });
    expect(markdown(parent)).toBe('Phone words.');
    expect(parent.isEditable).toBe(false);
    await act(async () => { outlineGate.reject(new Error('Injected outline refusal')); });
    await waitFor(() => expect(parent.isEditable).toBe(true));
    expect(markdown(parent)).toBe('Phone words.');
  });

  it.each(['p1', 'child'])('A01 holds a proposal for busy %s and applies it after the deletion ends', async nodeId => {
    mockNoteMode = true;
    try {
      mockSermon!.sourceNoteIds = ['source-note'];
      jest.mocked(generateNotePlanContent).mockResolvedValue({
        contentByNodeId: nodeId === 'p1' ? { p1: 'Requested AI words.', child: 'Child words.' } : { child: 'Requested AI words.' }, missingMaterial: {},
      });
      const view = await render();
      openPointCells();
      const parent = mountedEditor(view.container);
      fireEvent.click(screen.getAllByRole('button', { name: 'plan.refine.open' })[nodeId === 'p1' ? 0 : 1]);
      fireEvent.click(screen.getByRole('button', { name: 'plan.refine.presets.rewrite' }));
      fireEvent.click(screen.getByRole('button', { name: 'plan.refine.submit' }));
      const apply = await screen.findByRole('button', { name: 'plan.fromNote.apply' });
      const accept = mockGeneration.accept;
      const gate = deferred();
      mockBeforePlanTextWrite = () => gate.promise;
      removeChild();
      expect(apply).toBeDisabled();
      screen.getAllByRole('button', { name: 'plan.refine.open' }).slice(0, 2).forEach(button => expect(button).toBeDisabled());
      fireEvent.click(apply);
      act(() => { expect(accept(nodeId)).toBe(false); });
      expect(mockConspectus.contentByNodeId[nodeId]).toBe(nodeId === 'p1' ? 'Opening.' : 'Child words.');
      expect(mockGeneration.proposals[nodeId]).toBeDefined();
      await act(async () => { gate.reject(new Error('Injected text refusal')); });
      await waitFor(() => expect(apply).toBeEnabled());
      fireEvent.click(apply);
      expect(mockConspectus.contentByNodeId[nodeId]).toBe('Requested AI words.');
      await waitFor(() => expect(mockGeneration.proposals[nodeId]).toBeUndefined());
      expect(parent.isEditable).toBe(true);
    } finally { mockNoteMode = false; }
  });

  it('keeps an AI result arriving during deletion as a proposal until the door opens', async () => {
    mockNoteMode = true;
    try {
      mockSermon!.sourceNoteIds = ['source-note'];
      const answer = deferred<Awaited<ReturnType<typeof generateNotePlanContent>>>();
      jest.mocked(generateNotePlanContent).mockReturnValue(answer.promise);
      await render();
      fireEvent.click((await screen.findAllByRole('button', { name: 'plan.refine.open' }))[0]);
      fireEvent.click(screen.getByRole('button', { name: 'plan.refine.presets.rewrite' }));
      fireEvent.click(screen.getByRole('button', { name: 'plan.refine.submit' }));
      const gate = deferred();
      mockBeforePlanTextWrite = () => gate.promise;
      removeChild();
      await act(async () => { answer.resolve({ contentByNodeId: { p1: 'Arriving AI.', child: 'Child words.' }, missingMaterial: {} }); });
      const apply = await screen.findByRole('button', { name: 'plan.fromNote.apply' });
      expect(apply).toBeDisabled();
      act(() => { expect(mockGeneration.accept('p1')).toBe(false); });
      expect(mockConspectus.contentByNodeId.p1).toBe('Opening.');
      await act(async () => { gate.reject(new Error('Injected text refusal')); });
      await waitFor(() => expect(apply).toBeEnabled());
      fireEvent.click(apply);
      expect(mockConspectus.contentByNodeId.p1).toBe('Arriving AI.');
    } finally { mockNoteMode = false; }
  });

  it('releases a refused rescue and adopts the version that arrived during its text write', async () => {
    const { parent, child, gate } = await begin();
    await act(async () => { await harness.remote({ planText: { p1: 'Phone words.', child: 'Phone child.', other: 'Other.' } }); });
    await act(async () => { gate.resolve(); });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(parent.isEditable).toBe(true);
    expect(child.isEditable).toBe(true);
    expect(markdown(parent)).toBe('Phone words.');
    expect(markdown(child)).toBe('Phone child.');
    expect(mockConspectus.busyNodeIds.size).toBe(0);
    screen.getAllByTitle('plan.deletePoint').forEach(button => expect(button).toBeEnabled());
  });

  it.each(['point', 'sub-point'] as const)('does not retain busy cells on a new visit after unmount during %s deletion', async deletion => {
    const view = await render();
    await waitFor(() => expect(mockConspectus.contentByNodeId.p1).toBe('Opening.'));
    const gate = deferred();
    const before = jest.fn(() => gate.promise);
    if (deletion === 'point') {
      mockBeforeOutlineWrite = before;
      fireEvent.click(screen.getAllByTitle('plan.deletePoint')[0]);
      fireEvent.click(screen.getByTitle('plan.deletePointConfirm'));
    } else {
      mockBeforePlanTextWrite = before;
      removeChild();
    }
    await waitFor(() => expect(before).toHaveBeenCalledTimes(1));
    expect(mockConspectus.busyNodeIds.has('p1')).toBe(true);
    view.unmount();
    await act(async () => { gate.resolve(); });
    const reopened = await render();
    openPointCells();
    expect(mountedEditor(reopened.container).isEditable).toBe(true);
    expect(mockConspectus.busyNodeIds.size).toBe(0);
    screen.getAllByTitle('plan.deletePoint').forEach(button => expect(button).toBeEnabled());
  });

  it('releases all busy cells after an offline-queued point deletion and single flight holds until settlement', async () => {
    await render();
    await waitFor(() => expect(mockConspectus.contentByNodeId.p1).toBe('Opening.'));
    const actions = mockConspectus;
    const gate = deferred();
    const before = jest.fn(() => gate.promise);
    mockBeforeOutlineWrite = before;
    let deletion: Promise<void>;
    act(() => { deletion = actions.deletePoint('p1'); });
    await waitFor(() => expect(before).toHaveBeenCalledTimes(1));
    expect([...mockConspectus.busyNodeIds].sort()).toEqual(['child', 'p1']);
    await act(async () => {
      await actions.deletePoint('other');
      await actions.deleteSubPoint('p1', 'child');
    });
    expect(mockPlanTextWrites).not.toHaveBeenCalled();
    expect(before).toHaveBeenCalledTimes(1);
    act(() => { harness.engine.setOnline(false); });
    await act(async () => { gate.resolve(); await deletion; });
    expect(mockConspectus.busyNodeIds.size).toBe(0);
    screen.getAllByTitle('plan.deletePoint').forEach(button => expect(button).toBeEnabled());
    await act(async () => { harness.engine.setOnline(true); await harness.engine.retry(); });
    await waitFor(() => expect((harness.server.value?.outline as Sermon['outline'])!.introduction).toEqual([]));
    expect((harness.server.value?.outline as Sermon['outline'])!.main).toHaveLength(1);
  });

  it('M13 ignores double confirmation and stale callback re-entry, rescuing one copy', async () => {
    const { parent, gate, actions } = await begin();
    expect(screen.getByTitle('plan.deleteSubPoint')).toBeDisabled();
    fireEvent.click(screen.getByTitle('plan.deleteSubPoint'));
    await act(async () => { await actions.deleteSubPoint('p1', 'child'); });
    expect(mockPlanTextWrites).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve(); });
    await waitFor(() => expect(screen.queryByTitle('plan.deleteSubPoint')).not.toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle('plan.save')[0]);
    expect(markdown(parent).match(/Child words\./g)).toHaveLength(1);
    await waitFor(() => expect((harness.server.value?.planText as Record<string, string>).p1).toBe('Opening.\n\nChild words.'));
    expect(mockPlanTextWrites).toHaveBeenCalledTimes(1);
  });

  it('M10 blocks child typing before outline refusal and retry cannot duplicate the rescue', async () => {
    const { parent, child, gate } = await begin();
    expect(child.isEditable).toBe(false);
    await attemptTyping(child);
    expect(markdown(child)).toBe('Child words.');
    mockBeforeOutlineWrite = () => Promise.reject(new Error('Injected outline refusal'));
    await act(async () => { gate.resolve(); });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(parent.isEditable).toBe(true);
    expect(child.isEditable).toBe(true);
    expect(screen.getByTitle('plan.deleteSubPoint')).toBeEnabled();
    removeChild();
    await waitFor(() => expect(screen.queryByTitle('plan.deleteSubPoint')).not.toBeInTheDocument());
    expect(markdown(parent)).toBe('Opening.\n\nChild words.');
    await waitFor(() => expect((harness.server.value?.planText as Record<string, string>).p1.match(/Child words\./g)).toHaveLength(1));
    expect(mockPlanTextWrites).toHaveBeenCalledTimes(2);
  });

  it('M04 blocks every deletion during rescue then allows point deletion without resurrection', async () => {
    const { gate, actions } = await begin();
    screen.getAllByTitle('plan.deletePoint').forEach(button => {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    });
    await act(async () => { await actions.deletePoint('p1'); });
    expect(screen.getAllByTitle('plan.deletePoint')).toHaveLength(2);
    await act(async () => { gate.resolve(); });
    await waitFor(() => expect(screen.getAllByTitle('plan.deletePoint')[0]).toBeEnabled());
    fireEvent.click(screen.getAllByTitle('plan.deletePoint')[0]);
    fireEvent.click(screen.getByTitle('plan.deletePointConfirm'));
    await waitFor(() => expect((harness.server.value?.outline as Sermon['outline'])!.introduction).toEqual([]));
    await act(async () => { await harness.engine.retry(); });
    expect(screen.getAllByTitle('plan.deletePoint')).toHaveLength(1);
    expect((harness.server.value?.outline as Sermon['outline'])!.introduction).toEqual([]);
  });

  it.each(['p1', 'other'])('holds draft restore only when it targets a busy cell: %s', async nodeId => {
    saveDraft(draftKey('user-1', 'sermon-1', `plan:${nodeId}`, 'first'), 'First draft.', undefined, false, 1);
    saveDraft(draftKey('user-1', 'sermon-1', `plan:${nodeId}`, 'second'), 'Second draft.', undefined, false, 2);
    await render();
    fireEvent.click(await screen.findByRole('button', { name: 'plan.draftRecoveryRestore' }));
    const restore = await screen.findByRole('button', { name: 'plan.draftRecoveryRestore' });
    const gate = deferred();
    mockBeforePlanTextWrite = () => gate.promise;
    removeChild();
    if (nodeId === 'p1') {
      expect(restore).toBeDisabled();
      expect(screen.getAllByTitle('plan.save')[0]).toBeDisabled();
      fireEvent.click(restore);
      expect(mockConspectus.contentByNodeId.p1).toBe('First draft.');
    } else {
      expect(restore).toBeEnabled();
      fireEvent.click(restore);
      expect(mockConspectus.contentByNodeId.other).toBe('Second draft.');
    }
    await act(async () => { gate.resolve(); });
    await waitFor(() => expect(screen.queryByTitle('plan.deleteSubPoint')).not.toBeInTheDocument());
    if (nodeId === 'p1') expect(restore).toBeEnabled();
    else expect(mockConspectus.contentByNodeId.other).toBe('Second draft.');
  });

  it('locks a deleted point and all its children until a refused outline write finishes', async () => {
    const view = await render();
    openPointCells();
    const parent = mountedEditor(view.container);
    const child = mountedEditor(view.container.querySelectorAll<HTMLElement>('.tiptap')[1].parentElement!);
    const gate = deferred();
    mockBeforeOutlineWrite = () => gate.promise;
    fireEvent.click(screen.getAllByTitle('plan.deletePoint')[0]);
    fireEvent.click(screen.getByTitle('plan.deletePointConfirm'));
    expect(parent.isEditable).toBe(false);
    expect(child.isEditable).toBe(false);
    await attemptTyping(parent);
    await attemptTyping(child);
    await act(async () => { gate.reject(new Error('Injected outline refusal')); });
    await waitFor(() => expect(parent.isEditable).toBe(true));
    expect(child.isEditable).toBe(true);
    expect(markdown(parent)).toBe('Opening.');
    expect(markdown(child)).toBe('Child words.');
  });
});

it('B80 a refused local child deletion must not opt a later remote rescue into Undo and erase it on Save', async () => {
  localStorage.clear();
  const original = 'Original manual paragraph.';
  const child = 'Child paragraph.';
  const remote = original + '\n\n' + child;
  mockSermon = sermon({ p1: original, child });
  mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
  const view = await render();
  openPointCells();
  const editor = mountedEditor(view.container);
  mockFailNextRescue = true;
  fireEvent.click(screen.getByTitle('plan.deleteSubPoint'));
  fireEvent.click(screen.getByTitle('plan.deleteSubPointConfirm'));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(markdown(editor)).toBe(original);
  expect(harness.server.value?.planText).toEqual({ p1: original, child });
  // The phone independently completed the same rescue: parent receives the child's words, child is removed.
  await act(async () => { await harness.remote({ planText: { p1: remote, child: '' }, outline: { introduction: [{ id: 'p1', text: 'First point', subPoints: [] }], main: [], conclusion: [] } }); });
  await waitFor(() => expect(markdown(editor)).toBe(remote));
  expect(mountedEditor(view.container)).toBe(editor);
  expect(undo(editor)).toBe(false);
  const afterUndo = markdown(editor);
  fireEvent.click(screen.getAllByRole('button', { name: 'plan.save' })[0]);
  await waitFor(() => expect((harness.server.value?.planText as Record<string, string>).p1).toBe(afterUndo));
  expect(afterUndo).toBe(remote);
  expect((harness.server.value?.planText as Record<string, string>).p1).toBe(remote);
});

it('C13 manual plan saves the arriving table without changing its shape', async () => {
  localStorage.clear();
  const original = '| A | B |\n| --- | --- |\n| abcdef | Keep |';
  mockSermon = sermon({ p1: original }); const view = await render();
  openPointCells();
  const editor = mountedEditor(view.container);
  act(() => { editor.commands.setTextSelection(4); editor.view.focus(); });
  fireEvent.click(screen.getAllByRole('button', { name: 'plan.save' })[0]);
  await waitFor(() => expect((harness.server.value?.planText as Record<string, string>).p1.trim()).toBe(markdown(editor).trim()));
  const remote = '| A | B |\n| --- | --- |\n| abef | Keep |';
  await act(async () => { await harness.remote({ planText: { p1: remote } }); });
  // The active table remains available until the user leaves its editing place.
  expect(markdown(editor).trim()).toBe(original);
  await act(async () => { editor.view.dom.blur(); });
  await waitFor(() => expect(markdown(editor).trim()).toBe(remote));
  const arrived = { text: markdown(editor), tables: editor.view.dom.querySelectorAll('table').length };
  expect(undo(editor)).toBe(false);
  act(() => { expect(editor.commands.redo()).toBe(false); });
  typeAtEnd(editor, ' Own.');
  fireEvent.click(screen.getAllByRole('button', { name: 'plan.save' })[0]);
  await waitFor(() => expect((harness.server.value?.planText as Record<string, string>).p1).toContain('Own.'));
  expect(arrived.tables).toBe(1); expect(arrived.text.trim()).toBe(remote);
  expect(mountedEditor(view.container)).toBe(editor);
  expect(undo(editor)).toBe(true);
  expect(markdown(editor).trim()).toBe(remote);
  fireEvent.click(screen.getAllByRole('button', { name: 'plan.save' })[0]);
  await waitFor(() => expect((harness.server.value?.planText as Record<string, string>).p1.trim()).toBe(remote));
});


it('keeps the manual plan caret and next character in an unchanged paragraph', async () => {
  localStorage.clear();
  const initial = 'Alpha abcdef END\n\nMiddle unchanged\n\nTail';
  mockSermon = sermon({ p1: initial });
  const view = await render();
  openPointCells();
  const editor = mountedEditor(view.container);
  const arrivalPath = jest.spyOn(foreignContent, 'applyForeignContent');
  act(() => { editor.commands.setTextSelection(10); editor.view.focus(); });
  const adopted = initial.replace('Tail', 'PHONE Tail');
  await act(async () => { await harness.remote({ planText: { p1: adopted } }); });
  await waitFor(() => expect(markdown(editor)).toBe(adopted));
  const paths = arrivalPath.mock.results.map(result => result.value);
  arrivalPath.mockRestore();
  writeForeignEvidence('caller-manual-far', paths);
  expect(editor.state.selection.head).toBe(10);
  expect(paths).toEqual([{ fallback: false }]);
  expect(harness.server.value?.planText).toEqual({ p1: adopted });
  act(() => { editor.commands.insertContent('X'); });
  expect(markdown(editor)).toBe('Alpha abcXdef END\n\nMiddle unchanged\n\nPHONE Tail');
});


it('stores the next keystroke at the retained caret after an adjacent arrival in the manual plan', async () => {
  localStorage.clear();
  const initial = 'First words\n\nLast words\n\nTail';
  mockSermon = sermon({ p1: initial });
  const view = await render();
  openPointCells();
  const editor = mountedEditor(view.container);
  const arrivalPath = jest.spyOn(foreignContent, 'applyForeignContent');
  act(() => { editor.commands.setTextSelection(4); editor.view.focus(); });
  jest.mocked(harness.transport.send).mockClear();
  const adopted = initial.replace('Last words', 'PHONEARRIVAL sacred words\n\nLast words');
  const expected = adopted.replace('First words', 'FirXst words');
  await act(async () => { await harness.remote({ planText: { p1: adopted } }); });
  await waitFor(() => expect(markdown(editor)).toBe(adopted));

  expect(harness.server.value?.planText).toEqual({ p1: adopted });
  expect(harness.transport.send).not.toHaveBeenCalled();
  const paths = arrivalPath.mock.results.map(result => result.value);
  arrivalPath.mockRestore();
  writeForeignEvidence('caller-manual-adjacent', paths);
  expect(paths).toEqual([{ fallback: false }]);
  expect(editor.state.selection.toJSON()).toEqual({ type: 'text', anchor: 4, head: 4 });
  act(() => { editor.commands.insertContent('X'); });
  expect(markdown(editor)).toBe(expected);
  fireEvent.click(screen.getAllByRole('button', { name: 'plan.save' })[0]);
  await waitFor(() => expect((harness.server.value?.planText as Record<string, string>).p1).toBe(markdown(editor)));
});
