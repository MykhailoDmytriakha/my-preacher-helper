// Choice histories use a real note session and explicit delivery gates.
import { DeviceWorld, noteRef, noteValue, type WorldDevice } from '@test-utils/deviceWorld';
import { ACTION_SLOT, editorIdentity, editorSlot, retirableEditorIdentity } from '@/data-engine/editorIdentity';
import { SyncNoticeDock } from '@/components/common/SyncNoticeDock';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { DataEngineProvider, useDocumentActions } from '@/data-engine/react.client';
import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import StudyNotePage from '@/(pages)/(private)/studies/[id]/page';
import { watchedStore } from '@/utils/deviceStorage';
import { engineNote } from '@/hooks/useStudyNotesEngine';
import { noteRecordingMetadata } from '@/utils/studyNoteRecordings';

import { undoDepth } from '@tiptap/pm/history';
import type { DocumentData, ResourceRef, ResourceSnapshot } from '@/data-engine/types';
import type { Editor } from '@tiptap/core';
import type { useTextDictation } from '@/hooks/useTextDictation';
import type { ManagedEditor } from '@/data-engine/engine';
import type { ObservationSource, SnapshotEvent } from '@/data-engine/observer';
import type { StudyNote } from '@/models/models';
import type { useStudyNoteEditingSession } from '@/(pages)/(private)/studies/[id]/useStudyNoteEditingSession';
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

type NoteSession = ReturnType<typeof useStudyNoteEditingSession>;
type NoteSessionOptions = Parameters<typeof useStudyNoteEditingSession>[0];

jest.mock('@/(pages)/(private)/studies/[id]/useStudyNoteEditingSession', () => {
  const actual = jest.requireActual<typeof import('@/(pages)/(private)/studies/[id]/useStudyNoteEditingSession')>('@/(pages)/(private)/studies/[id]/useStudyNoteEditingSession');
  return { ...actual, useStudyNoteEditingSession: (options: NoteSessionOptions) => {
    const session = actual.useStudyNoteEditingSession(options);
    mockRenderCount++;
    mockSession = session;
    mockSessionOptions = options;
    return session;
  } };
});

function noteFields(note: StudyNote | null): NoteDraftPayload {
  return { title: note?.title ?? '', content: note?.content ?? '', tags: note?.tags ?? [],
    scriptureRefs: note?.scriptureRefs ?? [], type: note?.type ?? 'note',
    ...noteRecordingMetadata(note?.dictationSourceIds, note?.recordingSourceIds) };
}

function projectNoteFields(value: DocumentData | null | undefined) {
  return value && mockSession && mockSessionOptions
    ? noteFields(engineNote(value, mockSession.id, mockSessionOptions.locale)) : null;
}

function confirmedFields() {
  return projectNoteFields(mockSession?.document.confirmed?.value);
}

/** Temporary compatibility view for tests written against the old autosave hook. */
function observedNote() {
  const checkpoint = mockSession?.document.state?.checkpoint;
  const pending = Object.values(checkpoint?.pending ?? {}).sort((a, b) => b.generation - a.generation)[0];
  const phase = mockSession?.document.status?.phase;
  const rendered = mockSession?.projected ?? null;
  return {
    ...noteFields(rendered),
    dictationSourceIds: rendered?.dictationSourceIds ?? [],
    recordingSourceIds: rendered?.recordingSourceIds ?? [],
    noteId: mockSession?.id ?? mockRouteId,
    existingNote: mockSessionOptions?.existingNote,
    baselineRef: { current: pending ? projectNoteFields(pending.value) : confirmedFields() },
    saveBlocked: phase === 'blocked' || phase === 'refused' || phase === 'conflict' || phase === 'remoteChanged' || phase === 'deleted',
    liveValues: () => mockLiveEditor ? projectNoteFields(mockLiveDraft) ?? noteFields(null) : noteFields(rendered),
  };
}

type SnapshotReceiver = (event: SnapshotEvent) => void;
const noteListeners = new Map<string, Set<SnapshotReceiver>>();
const noteSource: ObservationSource = {
  listen: (_owner, resource, receive) => {
    if (resource.collection !== 'studyNotes') return () => undefined;
    const watching = noteListeners.get(resource.id) ?? new Set<SnapshotReceiver>();
    watching.add(receive);
    noteListeners.set(resource.id, watching);
    return () => {
      watching.delete(receive);
      if (!watching.size) noteListeners.delete(resource.id);
    };
  },
};

function observeSessionOpenings(device: WorldDevice) {
  const { engine, transport } = device;
  let currentResource: ResourceRef | undefined;
  const observe = (resource: ResourceRef, editorId: string, opening: Promise<ManagedEditor>) => {
    if (resource.collection !== 'studyNotes' || editorSlot(editorId) !== 'study-note') return opening;
    return opening.then(editor => {
      currentResource = resource;
      mockLiveEditor = editor;
      mockLiveEditorId = editorId;
      const checkpoint = editor.getState().checkpoint;
      mockLiveDraft = checkpoint.draft;
      editor.subscribe(() => {
        if (mockLiveEditor !== editor) return;
        mockLiveDraft = editor.getState().checkpoint.draft;
      });
      return editor;
    });
  };
  const open = engine.openEditor.bind(engine);
  const create = engine.createEditor.bind(engine);
  const recover = engine.recoverEditor.bind(engine);
  const refreshCollection = engine.refreshCollection.bind(engine);
  jest.spyOn(engine, 'refreshCollection').mockImplementation(async collection => {
    const resource = collection === 'studyNotes' && currentResource;
    const active = resource && device.online && noteListeners.get(resource.id);
    // This explicit test delivery substitutes for the silent Firestore adapter in DeviceWorld.
    // Its document is read from the same server and then goes through the real ResourceObserver.
    const observation = resource && active
      ? transport.read('owner', resource).then((snapshot: ResourceSnapshot) => {
        for (const publish of active) publish({ snapshot, source: 'server' });
      }) : undefined;
    const [state] = await Promise.all([refreshCollection(collection), observation]);
    return state;
  });
  jest.spyOn(engine, 'openEditor').mockImplementation((resource, id, options) => observe(resource, id, open(resource, id, options)));
  jest.spyOn(engine, 'createEditor').mockImplementation((resource, id, options) => observe(resource, id, create(resource, id, options)));
  jest.spyOn(engine, 'recoverEditor').mockImplementation((resource, id, sourceId, options) => observe(resource, id, recover(resource, id, sourceId, options)));
}

let mockRenderCount = 0;
let mockHeldCollection = false;
let mockCollectionCallbacks: Array<() => void> = [];
let mockObserve: (() => void) | undefined;
let mockEditorObserve: (() => void) | undefined;
let mockRouteId = 'note-x';
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockSearch = new URLSearchParams();
let mockVoice: Parameters<typeof useTextDictation>[0];
let mockBrowser: { engine: WorldDevice['engine']; dispose: () => void; editorId: (resource: ResourceRef, slot?: string) => string };
let mockEditor: Editor;
let mockSession: NoteSession | undefined;
let mockSessionOptions: NoteSessionOptions | undefined;
let mockLiveEditor: ManagedEditor | undefined;
let mockLiveEditorId: string | undefined;
let mockLiveDraft: DocumentData | null = null;
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
const keepVersionLabels = ['dataSync.useLocalVersion', 'dataSync.keepLocal', 'freshness.conflictKeepMine'];
const takeVersionLabels = ['dataSync.useStoredVersion', 'dataSync.acceptRemote', 'freshness.conflictTakeTheirs'];
const alternativeLabels = (labels: string[]) => new RegExp(`^(?:${labels.map(label => label.replaceAll('.', '\\.')).join('|')})$`);

export function hasInlineQuestion() {
  const workspace = document.querySelector('[data-note-workspace]');
  const labels = Array.from(workspace?.querySelectorAll('button') ?? []).map(button => button.textContent);
  return (keepVersionLabels.some(label => labels.includes(label)) && takeVersionLabels.some(label => labels.includes(label)))
    || (labels.includes('unsavedDraft.restore') && labels.includes('unsavedDraft.discard'))
    || (labels.includes('dataSync.recover') && labels.includes('dataSync.discardRecovery'));
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
  const name = alternativeLabels(choice === 'keep' ? keepVersionLabels : takeVersionLabels);
  const workspace = document.querySelector<HTMLElement>('[data-note-workspace]');
  const inline = workspace && within(workspace).queryByRole('button', { name });
  const button = inline ?? (await openNotice()).getByRole('button', { name });
  await act(async () => { fireEvent.click(button); });
  const confirm = screen.queryByRole('button', {
    name: alternativeLabels(['common.discardText.confirm', 'dataSync.confirmStoredField.confirm', 'dataSync.confirmStoredFields.confirm']),
  });
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
  observeSessionOpenings(laptop);
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
  laptop = await world.device('laptop', 0, {
    source: noteSource,
    recoveryPresence: { held: async () => false, hold: () => () => undefined },
  });
  observeSessionOpenings(laptop);
  jest.mocked(watchedStore).mockImplementation(database => laptop.storage.store(database));
  mockBrowser = { engine: laptop.engine, dispose: () => undefined, editorId: (resource: ResourceRef, slot = 'default') =>
    (slot === ACTION_SLOT ? editorIdentity : retirableEditorIdentity)('laptop', resource, slot, world.id('opening')) };
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
  mockRouteId = 'note-x'; mockStaleCreation = false; mockEarlyInput = false;
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
  observe(callback: (() => void) | undefined) { mockObserve = callback; mockEditorObserve = callback; },
  get staleCreation() { return mockStaleCreation; },
  forceStaleCreation() { mockStaleCreation = true; mockEarlyInput = true; },
  get editor() { return mockEditor; },
  get autosave() { return observedNote(); },
  get confirmed() { return confirmedFields(); },
  get activeEditor() { return mockLiveEditor && mockLiveEditorId ? { editor: mockLiveEditor, id: mockLiveEditorId } : undefined; },
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
  mockSession = undefined; mockSessionOptions = undefined;
  mockLiveEditor = undefined; mockLiveEditorId = undefined; mockLiveDraft = null;
  noteListeners.clear();
  observeQuestion = undefined;
  mockObserve = undefined; mockEditorObserve = undefined;
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
