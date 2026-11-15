import { writeForeignEvidence } from '@test-utils/foreignContentEvidence';
import * as foreignContent from '@/components/ui/foreignContent';
import { baseTyping } from '@test-utils/foreignSelection';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import userEvent from '@testing-library/user-event';
import type { ManualConspectus } from '@/(pages)/(private)/sermons/[id]/plan/manual/useManualConspectus';
import { toast } from 'sonner';

import { generateNotePlanContent } from '@/(pages)/(private)/sermons/[id]/plan/planApi';
import { OrphanedPlanText } from '@/(pages)/(private)/sermons/[id]/plan/OrphanedPlanText';
import ManualConspectusPage from '@/(pages)/(private)/sermons/[id]/plan/manual/page';
import '@testing-library/jest-dom';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { draftKey, readDraft, saveDraft } from '@/utils/durableDraft';

import { deferred } from '@test-utils/deferred';
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

it('regression pin: keeps the requested child-text rescue undoable in the mounted manual parent', async () => {
  localStorage.clear();
  mockSermon = sermon({ p1: 'Original manual paragraph.', child: 'Child paragraph.' });
  mockSermon.outline!.introduction[0].subPoints = [{ id: 'child', text: 'Child heading', position: 0 }];
  const view = await render();
  fireEvent.click(screen.getByRole('button', { name: 'plan.editMode' }));
  const editor = mountedEditor(view.container);
  fireEvent.click(screen.getByTitle('plan.deleteSubPoint'));
  fireEvent.click(screen.getByTitle('plan.deleteSubPointConfirm'));
  await waitFor(() => expect(markdown(editor)).toBe('Original manual paragraph.\n\nChild paragraph.'));
  expect(mountedEditor(view.container)).toBe(editor);
  expect(undo(editor)).toBe(true);
  expect(markdown(editor)).toBe('Original manual paragraph.');
});

let mockFailNextRescue = false;
let mockBeforePlanTextWrite: (() => Promise<void>) | null = null;
let mockBeforeOutlineWrite: (() => Promise<void>) | null = null;
const mockPlanTextWrites = jest.fn();
jest.mock('@/(pages)/(private)/sermons/[id]/plan/useEnginePlanWriter', () => {
  const actual = jest.requireActual('@/(pages)/(private)/sermons/[id]/plan/useEnginePlanWriter');
  return { ...actual, useEnginePlanWriter: (...args: unknown[]) => {
    const result = actual.useEnginePlanWriter(...args);
    return { ...result, writer: { ...result.writer, updateSermonOutline: async (...params: unknown[]) => {
      const beforeWrite = mockBeforeOutlineWrite;
      mockBeforeOutlineWrite = null;
      await beforeWrite?.();
      return result.writer.updateSermonOutline(...params);
    }, savePlanText: async (...params: unknown[]) => {
      mockPlanTextWrites(...params);
      const beforeWrite = mockBeforePlanTextWrite;
      mockBeforePlanTextWrite = null;
      await beforeWrite?.();
      if (mockFailNextRescue) { mockFailNextRescue = false; return Promise.reject(new Error('Injected pre-write storage refusal')); }
      return result.writer.savePlanText(...params);
    } } };
  } };
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

  it('prevents orphan Discard confirmation during deletion and clears text and dirty state after refusal', async () => {
    const view = await render();
    fireEvent.click(screen.getAllByTitle('plan.editMode')[0]);
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
    fireEvent.click(screen.getAllByTitle('plan.editMode')[0]);
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
      fireEvent.click(screen.getAllByTitle('plan.editMode')[0]);
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
      expect(mockGeneration.proposals[nodeId]).toBeUndefined();
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
    fireEvent.click(screen.getAllByTitle('plan.editMode')[0]);
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
    expect(mockPlanTextWrites).toHaveBeenCalledTimes(1);
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
    fireEvent.click(screen.getAllByTitle('plan.editMode')[0]);
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


it('keeps the manual plan caret and next character in an unchanged paragraph', async () => {
  localStorage.clear();
  const initial = 'Alpha abcdef END\n\nMiddle unchanged\n\nTail';
  mockSermon = sermon({ p1: initial });
  const view = await render();
  fireEvent.click(screen.getByRole('button', { name: 'plan.editMode' }));
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


it('stores the production result after an adjacent arrival in the manual plan', async () => {
  localStorage.clear();
  const initial = 'First words\n\nLast words\n\nTail';
  mockSermon = sermon({ p1: initial });
  const view = await render();
  fireEvent.click(screen.getByRole('button', { name: 'plan.editMode' }));
  const editor = mountedEditor(view.container);
  const arrivalPath = jest.spyOn(foreignContent, 'applyForeignContent');
  act(() => { editor.commands.setTextSelection(4); editor.view.focus(); });
  jest.mocked(harness.transport.send).mockClear();
  const adopted = initial.replace('Last words', 'PHONEARRIVAL sacred words\n\nLast words');
  const expected = baseTyping(editor, adopted);
  await act(async () => { await harness.remote({ planText: { p1: adopted } }); });
  await waitFor(() => expect(markdown(editor)).toBe(adopted));

  expect(harness.server.value?.planText).toEqual({ p1: adopted });
  expect(harness.transport.send).not.toHaveBeenCalled();
  const paths = arrivalPath.mock.results.map(result => result.value);
  arrivalPath.mockRestore();
  writeForeignEvidence('caller-manual-adjacent', paths);
  expect(paths.every(result => result.fallback)).toBe(true);
  expect(editor.state.doc.toJSON()).toEqual(expected.document);
  expect(editor.state.selection.toJSON()).toEqual(expected.selection);
  act(() => { editor.commands.insertContent('X'); });
  expect(markdown(editor)).toBe(expected.typed);
  fireEvent.click(screen.getAllByRole('button', { name: 'plan.save' })[0]);
  await waitFor(() => expect((harness.server.value?.planText as Record<string, string>).p1).toBe(markdown(editor)));
});
