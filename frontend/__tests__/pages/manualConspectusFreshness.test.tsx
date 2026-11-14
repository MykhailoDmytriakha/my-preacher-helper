import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { toast } from 'sonner';

import { generateNotePlanContent } from '@/(pages)/(private)/sermons/[id]/plan/planApi';
import ManualConspectusPage from '@/(pages)/(private)/sermons/[id]/plan/manual/page';
import '@testing-library/jest-dom';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { draftKey, readDraft, saveDraft } from '@/utils/durableDraft';

import { markdown, mountedEditor, typeAtEnd, undo } from '@test-utils/richMarkdownHistory';

import { documentEngineHarness } from '../../test-utils/documentEngineHarness';

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
let harness: ReturnType<typeof documentEngineHarness>;

jest.mock('@/hooks/useRouteId', () => ({ useRouteId: () => 'sermon-1' }));

// The page runs on the data engine: it opens the sermon document through the real engine,
// with only the server and the browser transport replaced.
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'user-1' }, loading: false }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
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

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

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
const page = (client: QueryClient) => (
  <QueryClientProvider client={client}><DataEngineProvider><ManualConspectusPage /></DataEngineProvider></QueryClientProvider>
);
const render = async () => {
  const { id: _id, ...stored } = mockSermon as unknown as Record<string, unknown>;
  harness = documentEngineHarness({
    resource: { collection: 'sermons', id: 'sermon-1' },
    metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false },
    value: JSON.parse(JSON.stringify(stored)),
  });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const client = queryClient();
  const view = rtlRender(page(client));
  await screen.findAllByText('A sermon in progress');
  return view;
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

    expect(saveButton()).toBeEnabled();
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
  fireEvent.click(screen.getByRole('button', { name: 'plan.editMode' }));
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

it('regression pin: keeps a second requested manual draft replacement undoable in the mounted editor', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Original manual paragraph.' });
  saveDraft(draftKey('user-1', 'sermon-1', 'plan:p1', 'first'), 'First requested words.', undefined, false, 1);
  saveDraft(draftKey('user-1', 'sermon-1', 'plan:p1', 'second'), 'Second requested words.', undefined, false, 2);
  const view = await render();
  fireEvent.click(await screen.findByRole('button', { name: 'plan.draftRecoveryRestore' }));
  fireEvent.click(screen.getByRole('button', { name: 'plan.editMode' }));
  const editor = mountedEditor(view.container);
  const before = markdown(editor);
  fireEvent.click(await screen.findByRole('button', { name: 'plan.draftRecoveryRestore' }));
  expect(markdown(editor)).not.toBe(before);
  expect(mountedEditor(view.container)).toBe(editor);
  expect(undo(editor)).toBe(true);
  expect(markdown(editor)).toBe(before);
});

it('regression pin: keeps an explicitly applied note-plan AI replacement undoable in the mounted manual cell', async () => {
  localStorage.clear();
  mockNoteMode = true;
  try {
    mockSermon = { ...sermon({ p1: 'Original manual paragraph.' }), sourceNoteIds: ['source-note'] };
    jest.mocked(generateNotePlanContent).mockResolvedValue({ contentByNodeId: { p1: 'Requested AI text.' }, missingMaterial: {} });
    const view = await render();
    fireEvent.click(screen.getByRole('button', { name: 'plan.editMode' }));
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

it('keeps the rescued paragraph when text Undo cannot restore the deleted child', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Original manual paragraph.', child: 'Child paragraph.' });
  mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
  const view = await render();
  fireEvent.click(screen.getByRole('button', { name: 'plan.editMode' }));
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

it('moves the child once when its exact paragraph is already in the parent', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Opening.\n\nChild paragraph.\n\nClosing.', child: 'Child paragraph.' });
  mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
  const view = await render();
  fireEvent.click(screen.getByRole('button', { name: 'plan.editMode' }));
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
let mockWaitForRescue: (() => Promise<void>) | undefined;
jest.mock('@/(pages)/(private)/sermons/[id]/plan/useEnginePlanWriter', () => {
  const actual = jest.requireActual('@/(pages)/(private)/sermons/[id]/plan/useEnginePlanWriter');
  return { ...actual, useEnginePlanWriter: (...args: unknown[]) => {
    const result = actual.useEnginePlanWriter(...args);
    return { ...result, writer: { ...result.writer, savePlanText: async (...params: unknown[]) => {
      if (mockFailNextRescue) { mockFailNextRescue = false; throw new Error('Injected pre-write storage refusal'); }
      const resultPromise = result.writer.savePlanText(...params);
      const pause = mockWaitForRescue;
      mockWaitForRescue = undefined;
      if (pause) await Promise.all([resultPromise, pause()]);
      else await resultPromise;
    } } };
  } };
});

it('retains the text typed in the parent while its child text is being rescued', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Opening.', child: 'Child paragraph.' });
  mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
  const view = await render();
  let release: (() => void) | undefined;
  mockWaitForRescue = () => new Promise(resolve => { release = resolve; });
  try {
    fireEvent.click(screen.getByRole('button', { name: 'plan.editMode' }));
    const editor = mountedEditor(view.container);
    fireEvent.click(screen.getByTitle('plan.deleteSubPoint'));
    fireEvent.click(screen.getByTitle('plan.deleteSubPointConfirm'));
    await waitFor(() => expect(release).toBeDefined());
    await act(async () => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' Typed.');
      expect(markdown(editor)).toBe('Opening. Typed.');
      release!();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByTitle('plan.deleteSubPoint')).not.toBeInTheDocument());
    expect(markdown(editor)).toBe('Opening. Typed.\n\nChild paragraph.');
    typeAtEnd(editor, ' Later.');
    fireEvent.click(screen.getAllByRole('button', { name: 'plan.save' })[0]);
    await waitFor(() => expect(harness.server.value?.planText).toMatchObject({ p1: 'Opening. Typed.\n\nChild paragraph. Later.' }));
  } finally {
    release?.();
    mockWaitForRescue = undefined;
    view.unmount();
  }
});

it('B80 a refused local child deletion must not opt a later remote rescue into Undo and erase it on Save', async () => {
  localStorage.clear();
  const original = 'Original manual paragraph.';
  const child = 'Child paragraph.';
  const remote = original + '\n\n' + child;
  mockSermon = sermon({ p1: original, child });
  mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
  const view = await render();
  fireEvent.click(screen.getByRole('button', { name: 'plan.editMode' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'plan.editMode' }));
  const editor = mountedEditor(view.container);
  act(() => { editor.commands.setTextSelection(4); editor.view.focus(); });
  fireEvent.click(screen.getAllByRole('button', { name: 'plan.save' })[0]);
  await waitFor(() => expect((harness.server.value?.planText as Record<string, string>).p1.trim()).toBe(markdown(editor).trim()));
  const remote = '| A | B |\n| --- | --- |\n| abef | Keep |';
  await act(async () => { await harness.remote({ planText: { p1: remote } }); });
  const arrived = { text: markdown(editor), json: editor.getJSON(), tables: editor.view.dom.querySelectorAll('table').length };
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
