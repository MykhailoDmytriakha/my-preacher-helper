// Isolated choice-hunt fixture cloned from noteOrdering; the original stand stays unchanged.
import { DeviceWorld, noteRef, noteValue, type WorldDevice } from '@test-utils/deviceWorld';
import { editorIdentity } from '@/data-engine/editorIdentity';
import { SyncNoticeDock } from '@/components/common/SyncNoticeDock';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { DataEngineProvider, useDocumentActions, useDocumentChoiceSubscription } from '@/data-engine/react.client';
import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import StudyNotePage from '@/(pages)/(private)/studies/[id]/page';
import { watchedStore } from '@/utils/deviceStorage';

import { undoDepth } from '@tiptap/pm/history';
import type { ResourceRef } from '@/data-engine/types';
import type { Editor } from '@tiptap/core';
import type { useTextDictation } from '@/hooks/useTextDictation';
import type { useNoteAutoSave } from '@/(pages)/(private)/studies/[id]/useNoteAutoSave';
import type { NoteDraftPayload } from '@/(pages)/(private)/studies/[id]/noteDraft';

jest.mock('@/services/storeAvailability.server', () => ({ storeRetryHeaders: () => ({}) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: () => mockBrowser }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' }, loading: false }) }));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: 'owner', isAuthLoading: false }) }));
jest.mock('@/services/firebaseAuth.service', () => ({ auth: { currentUser: null } }));
jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: jest.fn() }));
jest.mock('@/services/studies.service', () => ({ NOTE_AGGREGATE: 'note' }));
jest.mock('next/navigation', () => ({ usePathname: () => '/studies/'+mockRouteId, useParams: () => ({ id: mockRouteId }), useRouter: () => mockRouter, useSearchParams: () => mockSearch }));
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key, language: 'en' }) }));
jest.mock('@locales/i18n', () => ({ __esModule: true, default: { language: 'en', t: (key: string) => key } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
jest.mock('@/hooks/useTags', () => ({ useTags: () => ({ tags: { requiredTags: [], customTags: [] } }) }));
jest.mock('@/hooks/useSermonNoteLinks', () => ({ useSermonsBuiltOnNote: () => ({ sermons: [] }) }));
jest.mock('@/hooks/useWideViewport', () => ({ useWideViewport: () => true, useRoomyHeader: () => true }));
jest.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => ({ aiBlocked: false, blocked: () => false, blockedLabelKey: () => '', refresh: jest.fn() }) }));
jest.mock('@/hooks/useTextDictation', () => ({ useTextDictation: (args: Parameters<typeof useTextDictation>[0]) => { mockVoice = args; return { captureAcceptance: () => async () => {  }, carryTo: async () => undefined, canChangeDestination: () => true }; } }));
jest.mock('@/components/FocusRecorderButton', () => ({ FocusRecorderButton: () => null }));
jest.mock('@/components/audio-recorder/RecordingDraftBanner', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/FoldableMarkdown', () => ({ FoldableMarkdown: ({ content }: { content: string }) => <div data-testid="read-note">{content}</div> }));
jest.mock('@/components/ui/RichMarkdownToolbar', () => ({ RichMarkdownToolbar: () => null }));
jest.mock('@/(pages)/(private)/studies/components/SermonsBuiltOnNote', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/MarkdownDisplay', () => ({ __esModule: true, default: ({ content }: { content: string }) => <div>{content}</div> }));
jest.mock('@/components/bible/ScripturePreviewSheet', () => ({ ScripturePreviewSheet: () => null }));
jest.mock('@/components/bible/ScriptureLinks', () => ({ ScriptureLinks: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/components/bible/useBookTexts', () => ({ useBookTexts: () => new Map() }));

jest.mock('@tiptap/react', () => {
  const actual = jest.requireActual<typeof import('@tiptap/react')>('@tiptap/react');
  return { ...actual, useEditor: (...args: Parameters<typeof actual.useEditor>) => {
    const editor = actual.useEditor(...(mockStaleCreation ? [{ ...args[0], content: original }] : args) as Parameters<typeof actual.useEditor>);
    if (editor) mockEditor = editor;
    React.useLayoutEffect(() => {
      if (!editor) return;
      const observe = () => mockEditorObserve?.();
      editor.on('transaction', observe);
      return () => { editor.off('transaction', observe); };
    }, [editor]);
    React.useLayoutEffect(() => {
      if (!editor || !mockEarlyInput) return;
      mockEarlyInput = false;
      editor.view.dispatch(editor.state.tr.insertText(' Typedword', editor.state.doc.content.size - 1));
    }, [editor]);
    return editor;
  } };
});

let mockStaleCreation = false;
let mockEarlyInput = false;

jest.mock('@/(pages)/(private)/studies/[id]/useNoteAutoSave', () => {
  const actual = jest.requireActual('@/(pages)/(private)/studies/[id]/useNoteAutoSave');
  return { ...actual, useNoteAutoSave: (args: Parameters<typeof useNoteAutoSave>[0]) => {
    mockRenderCount++; mockAutosave = args;
    return actual.useNoteAutoSave(args);
  } };
});

let mockRenderCount = 0;
let mockHeldCollection = false;
let mockCollectionCallbacks: Array<() => void> = [];
let mockObserve: (() => void) | undefined;
let mockEditorObserve: (() => void) | undefined;
let mockChoiceSettled: (() => void) | undefined;
let mockRouteId = 'note-x';
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockSearch = new URLSearchParams();
let mockVoice: Parameters<typeof useTextDictation>[0];
let mockBrowser: { engine: WorldDevice['engine']; dispose: () => void; editorId: (resource: ResourceRef, slot?: string) => string };
let mockEditor: Editor;
let mockAutosave: Parameters<typeof useNoteAutoSave>[0];
let world: DeviceWorld;
let laptop: WorldDevice;
let view: ReturnType<typeof render>;
let observer: MutationObserver;
let notices: string[];
let editorUpdates: string[];
let activeHistory = false;
let observeQuestion: (() => void) | undefined;
let choiceActions: ReturnType<typeof useDocumentActions>;
function ChoiceActions() {
  choiceActions = useDocumentActions();
  const subscribe = useDocumentChoiceSubscription();
  React.useEffect(() => subscribe(noteRef, () => mockChoiceSettled?.()), [subscribe]);
  return null;
}

const original = 'Original paragraph.\n\nSecond paragraph.';
const noticeKeys = ['freshness.title', 'freshness.conflictTitle', 'unsavedDraft.title',
  'dataEngine.decisionRequired', 'dataSync.severalDrafts', 'common.saveError'];
const md = () => (mockEditor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();
const stored = async () => (await world.snapshot(noteRef)).value!.content;
function captureNotices() {
  const text = document.body.textContent ?? '';
  const found = noticeKeys.filter(key => text.includes(key));
  for (const element of document.querySelectorAll('[role="alert"], [role="dialog"], [aria-modal="true"]')) {
    found.push(element.textContent ?? '');
  }
  notices.push(...found.filter(value => !notices.includes(value)));
  observeQuestion?.();
  mockObserve?.();
}
// This stand mounts one note; both existing places that offer its choices count.
export function hasInlineQuestion() {
  return Array.from(document.querySelectorAll('[data-note-workspace] [role="alert"], [data-note-workspace] [role="status"]')).some(element => {
    const text = element.textContent ?? '';
    const buttons = Array.from(element.querySelectorAll('button')).map(button => button.textContent);
    return (text.includes('freshness.conflictTitle')
      && buttons.includes('freshness.conflictKeepMine') && buttons.includes('freshness.conflictTakeTheirs'))
      || (text.includes('unsavedDraft.title')
        && buttons.includes('unsavedDraft.restore') && buttons.includes('unsavedDraft.discard'));
  });
}
export function hasGlobalNotice() {
  return Array.from(document.querySelectorAll('button[aria-controls]')).some(button =>
    button.textContent === 'dataSync.readerNotices' && !button.closest('[hidden],[aria-hidden="true"]'));
}
export function hasNoteQuestion() { return hasInlineQuestion() || hasGlobalNotice(); }
export async function openNotice() {
  const button = screen.getByRole('button', { name: 'dataSync.readerNotices' });
  if (button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button);
  await settle();
  return within(document.querySelector('[data-sync-notice-open] section') as HTMLElement);
}
export async function chooseNotice(choice: 'keep' | 'take') {
  await openNotice();
  await act(async () => { fireEvent.click(within(document.querySelector('[data-sync-notice-open] section') as HTMLElement).getByRole('button', {
    name: choice === 'keep' ? 'freshness.conflictKeepMine' : 'freshness.conflictTakeTheirs',
  })); });
  const confirm = screen.queryByRole('button', { name: 'common.discardText.confirm' });
  if (confirm) await act(async () => { fireEvent.click(confirm); });
  await finish();
}
async function mountPage() {
  await act(async () => {
    view = laptop.run(() => render(<DataEngineProvider><ChoiceActions /><SyncNoticeDock><EngineConflictBanner /></SyncNoticeDock><StudyNotePage /></DataEngineProvider>));
    await world.settle();
  });
  if (screen.queryByTitle('common.edit')) fireEvent.click(screen.getByTitle('common.edit'));
  await settle();
  mockEditor.view.setProps({ handleScrollToSelection: () => true });
}
/** Reboot the engine from device storage, without a callback or live engine from the old page. */
export async function reloadPage() {
  view.unmount();
  jest.advanceTimersByTime(1);
  await act(async () => { await laptop.reload(); });
  mockBrowser.engine = laptop.engine;
  await mountPage();
}
async function settle(ms = 0) {
  await act(async () => { if (ms) await world.advance(ms); else await world.settle(); });
  captureNotices();
}
async function start(initialContent = original, allowEquivalentSerialization = false) {
  localStorage.clear();
  activeHistory = true;
  notices = []; editorUpdates = [];
  globalThis.Headers = class {
    constructor(private values: Record<string, string> = {}) {}
    get(key: string) { return this.values[key] ?? null; }
  } as unknown as typeof Headers;
  world = new DeviceWorld();
  jest.useFakeTimers({ now: world.now, doNotFake: ['queueMicrotask'] });
  await world.seed(noteRef, { ...noteValue(), type: 'note', content: initialContent });
  laptop = await world.device('laptop');
  jest.mocked(watchedStore).mockImplementation(database => laptop.storage.store(database));
  mockBrowser = { engine: laptop.engine, dispose: () => undefined, editorId: (resource: ResourceRef, slot = 'default') => editorIdentity('laptop', resource, slot, world.id('opening')) };
  jest.spyOn(window, 'confirm').mockImplementation(() => { notices.push('window.confirm'); return false; });
  jest.spyOn(window, 'alert').mockImplementation(() => { notices.push('window.alert'); });
  observer = new MutationObserver(captureNotices);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  const watch = laptop.engine.watchCollection.bind(laptop.engine);
  laptop.engine.watchCollection = (collection, notify) => watch(collection, state => {
    // Retain each genuine notification, including its exact captured payload.
    if (mockHeldCollection) mockCollectionCallbacks.push(() => notify(state));
    else notify(state);
  });
  await mountPage();
  mockEditor.on('update', () => { editorUpdates.push(md()); mockEditorObserve?.(); });
  expect(view.container.querySelector('.tiptap')).toBeTruthy();
  if (mockRouteId !== 'new' && !allowEquivalentSerialization) expect(md().trim()).toBe(initialContent.trim());
  if (initialContent === original) expect(undoDepth(mockEditor.state)).toBe(0);
}
afterEach(() => {
  disposeHistory();
  mockRouteId = 'note-x'; mockAfterMarkSaved = undefined; mockStaleCreation = false; mockEarlyInput = false; mockRecovery = null;
});


export const stand = {
  get renderCount() { return mockRenderCount; },
  get collectionHeld() { return mockHeldCollection; },
  get queuedNotifications() { return mockCollectionCallbacks.length; },
  holdCollection() { mockHeldCollection = true; },
  async deliverAllCollection() {
    // Flush each callback through React before the next; new notifications remain
    // queued behind older ones until delivery catches up with the real engine.
    while (mockCollectionCallbacks.length) {
      const callback = mockCollectionCallbacks.shift()!;
      await act(async () => { callback(); await pulse(); });
    }
    mockHeldCollection = false;
  },
  releaseCollection(mode: 'latest' | 'all') {
    mockHeldCollection = false;
    const callbacks = mockCollectionCallbacks.splice(0);
    for (const callback of mode === 'latest' ? callbacks.slice(-1) : callbacks) callback();
  },
  onChoiceSettled(callback: (() => void) | undefined) { mockChoiceSettled = callback; },
  observe(callback: (() => void) | undefined) { mockObserve = callback; mockEditorObserve = callback; },
  get staleCreation() { return mockStaleCreation; },
  set recovery(value: NoteDraftPayload | null) { mockRecovery = value; },
  forceStaleCreation() { mockStaleCreation = true; mockEarlyInput = true; },
  set afterMarkSaved(callback: ((content: string) => void) | undefined) { mockAfterMarkSaved = callback; },
  get editor() { return mockEditor; },
  get autosave() { return mockAutosave; },
  get confirmed() { return mockConfirmed; },
  get voice() { return mockVoice; },
  get world() { return world; },
  get laptop() { return laptop; },
  get notices() { return notices; },
  get view() { return view; },
  get actions() { return choiceActions; },
  async remount(id: string) {
    view.unmount();
    jest.advanceTimersByTime(1);
    mockRouteId = id;
    await mountPage();
  },
  set routeId(value: string) { mockRouteId = value; },
};
export { original, md, stored, start, settle, captureNotices, disposeHistory, publishDictation };
export function insert(text: string) {
  mockEditor.view.dispatch(mockEditor.state.tr.insertText(text, mockEditor.state.doc.content.size - 1));
}
export async function finish() { for (const ms of [0, 1600, 2000, 5000, 30000]) await settle(ms); }
export type OrderingEvent = { kind: 'type' | 'arriveSame' | 'arriveOther' | 'arriveLive' | 'timer' | 'ack' | 'offline' | 'online' | 'dictate' | 'doneEdit' | 'typeDictate' | 'dictateType'; word?: string };
let mockAfterMarkSaved: ((content: string) => void) | undefined;
let mockConfirmed: NoteDraftPayload | null;
let mockRecovery: NoteDraftPayload | null = null;
jest.mock('@/hooks/useDurableDraft', () => {
  const actual = jest.requireActual('@/hooks/useDurableDraft');
  return { ...actual, useDurableDraft: (args: Parameters<typeof import('@/hooks/useDurableDraft').useDurableDraft>[0]) => { mockConfirmed = args.confirmedValue as NoteDraftPayload | null; const result = actual.useDurableDraft(args);
    const mark = result.markSaved;
    const markSaved = React.useCallback((value: unknown) => {
      mark(value);
      mockAfterMarkSaved?.((value as { content: string }).content);
    }, [mark]);
    return { ...result, markSaved, ...(mockRecovery ? { recovered: mockRecovery,
      acceptRecovered: () => { mockRecovery = null; result.acceptRecovered(); },
    } : {}) }; } };
});


export function rng(seed: number) {
  let state = seed >>> 0;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}
function disposeHistory() {
  if (!activeHistory) return;
  observer?.disconnect(); view?.unmount(); cleanup();
  // Tiptap destroys unmounted instances after 1 ms. Let it release DOM observers before
  // DeviceWorld clears timers; otherwise a long hunt retains thousands of live views.
  jest.advanceTimersByTime(1);
  world?.dispose(); localStorage.clear(); jest.restoreAllMocks(); jest.clearAllMocks();
  activeHistory = false;
  observeQuestion = undefined;
  mockObserve = undefined; mockEditorObserve = undefined; mockChoiceSettled = undefined;
  mockHeldCollection = false; mockCollectionCallbacks = []; mockRenderCount = 0;
}
export async function pulse(ms = 0) {
  jest.advanceTimersByTime(ms);
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < 900; i++) { await Promise.resolve(); if (i % 300 === 0) jest.advanceTimersByTime(0); }
    jest.advanceTimersByTime(1);
  }
  captureNotices();
}
// Match useTextDictation.transcribe: raw source ownership precedes recognized text.
async function publishDictation(text: string, sourceId: string) {
  mockVoice.onSourcePersisted?.(sourceId);
  return mockVoice.onText(text, sourceId);
}
