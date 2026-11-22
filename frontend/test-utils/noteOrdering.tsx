import { DeviceWorld, noteRef, noteValue, type WorldDevice } from '@test-utils/deviceWorld';
import { ACTION_SLOT, editorIdentity, editorSlot, retirableEditorIdentity } from '@/data-engine/editorIdentity';
import { SyncNoticeDock } from '@/components/common/SyncNoticeDock';
import React from 'react';
import { appendFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { DataEngineProvider, useDocumentActions, useStoredVersionTaken } from '@/data-engine/react.client';
import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import StudyNotePage from '@/(pages)/(private)/studies/[id]/page';
import { processCommand } from '@/data-engine/server';
import { engineNote } from '@/hooks/useStudyNotesEngine';
import { diffFields } from '@/data-engine/protocol';
import { watchedStore } from '@/utils/deviceStorage';
import { serializeContent } from '@/utils/contentFingerprint';
import { noteRecordingMetadata } from '@/utils/studyNoteRecordings';
import { evaluateQuestionHistory, type QuestionSnapshot } from './noteOrderingOracles';

import { undoDepth } from '@tiptap/pm/history';
import type { DataCommand, CommandResult, DocumentData, ResourceRef, ResourceSnapshot } from '@/data-engine/types';
import type { Editor } from '@tiptap/core';
import type { StudyNote } from '@/models/models';
import type { useTextDictation } from '@/hooks/useTextDictation';
import type { ManagedEditor } from '@/data-engine/engine';
import type { ObservationSource, SnapshotEvent } from '@/data-engine/observer';
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
      const checkpoint = editor.getState().checkpoint;
      mockLiveDraft = checkpoint.draft;
      let confirmed = checkpoint.confirmed.metadata;
      editor.subscribe(() => {
        if (mockLiveEditor !== editor) return;
        const updated = editor.getState().checkpoint;
        mockLiveDraft = updated.draft;
        const next = updated.confirmed.metadata;
        if (next?.generation === confirmed?.generation && next?.revision === confirmed?.revision) return;
        confirmed = next;
        const content = updated.confirmed.value?.content;
        if (typeof content === 'string') mockAfterMarkSaved?.(content);
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

let mockHoldCollection = false;
let mockDelayedCollection: Array<() => void> = [];
let mockRenderCount = 0;
let mockRouteId = 'note-x';
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockSearch = new URLSearchParams();
let mockVoice: Parameters<typeof useTextDictation>[0];
let mockBrowser: { engine: WorldDevice['engine']; dispose: () => void; editorId: (resource: ResourceRef, slot?: string) => string };
let mockEditor: Editor;
let mockSession: NoteSession | undefined;
let mockSessionOptions: NoteSessionOptions | undefined;
let mockLiveEditor: ManagedEditor | undefined;
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
const mockVersionTaken = jest.fn();
function ChoiceActions() {
  choiceActions = useDocumentActions();
  const subscribeVersionTaken = useStoredVersionTaken();
  React.useEffect(() => subscribeVersionTaken(noteRef, mockVersionTaken), [subscribeVersionTaken]);
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
  // An opening that first offers unsaved text from last time mounts no editor until that is answered.
  if (view.container.querySelector('.tiptap')) mockEditor.view.setProps({ handleScrollToSelection: () => true });
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
  // This fixture has one tab of the device's storage. A previous opening ends on reload.
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
    if (mockHoldCollection) mockDelayedCollection.push(() => notify(state)); else notify(state);
  });
  await mountPage();
  if (mockRecovery && !view.container.querySelector('.tiptap')) return;
  mockEditor.on('update', () => { editorUpdates.push(md()); });
  expect(view.container.querySelector('.tiptap')).toBeTruthy();
  if (mockRouteId !== 'new' && !allowEquivalentSerialization) expect(md().trim()).toBe(initialContent.trim());
  if (initialContent === original) expect(undoDepth(mockEditor.state)).toBe(0);
}
async function phoneSave(content: string, fields: Partial<Pick<StudyNote, 'title' | 'type' | 'tags' | 'scriptureRefs' | 'dictationSourceIds' | 'recordingSourceIds'>> = {}) {
  const before = await world.snapshot(noteRef);
  const result = await processCommand('owner', { protocol: 1, kind: 'update', owner: 'owner', operationId: world.id('phone'),
    resource: noteRef, generation: before.metadata!.generation, dependsOn: [],
    changes: diffFields(before.value!, JSON.parse(JSON.stringify({ ...before.value!, ...fields, content }))) });
  expect(result.kind).toBe('acknowledged');
  await act(async () => {
    await laptop.run(() => laptop.engine.refreshCollection('studyNotes'));
    await world.settle();
  });
  await settle();
}
afterEach(() => {
  disposeHistory();
  mockHoldCollection = false; mockDelayedCollection = []; mockRenderCount = 0;
  mockRouteId = 'note-x'; mockAfterMarkSaved = undefined; mockStaleCreation = false; mockEarlyInput = false; mockRecovery = null; mockRecoveryBase = undefined;
});


export const stand = {
  get versionTaken() { return mockVersionTaken; },
  get renderCount() { return mockRenderCount; },
  holdCollection() { mockHoldCollection = true; },
  releaseCollection() { mockHoldCollection = false; mockDelayedCollection.at(-1)?.(); mockDelayedCollection = []; },
  get staleCreation() { return mockStaleCreation; },
  set recovery(value: NoteDraftPayload | null) { mockRecovery = value; },
  forceStaleCreation() { mockStaleCreation = true; mockEarlyInput = true; },
  /** Legacy name for a confirmed revision reaching the engine, possibly before the screen follows it. */
  set afterMarkSaved(callback: ((content: string) => void) | undefined) { mockAfterMarkSaved = callback; },
  get editor() { return mockEditor; },
  get autosave() { return observedNote(); },
  get session() { return mockSession?.document; },
  get confirmed() { return confirmedFields(); },
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
  /** The person leaves the note inside the app: the page unmounts while the engine keeps running. */
  leave() { view.unmount(); },
  /** The person opens a note again after `leave`. */
  async reopen(id = 'note-x') {
    jest.advanceTimersByTime(1);
    mockRouteId = id;
    await mountPage();
  },
  /** What a planted `recovery` copy was built from; unset plants a copy written without one. */
  set recoveryBase(value: NoteDraftPayload | undefined) { mockRecoveryBase = value; },
  set routeId(value: string) { mockRouteId = value; },
};
export { original, md, stored, start, settle, phoneSave, captureNotices };
export function insert(text: string) {
  mockEditor.view.dispatch(mockEditor.state.tr.insertText(text, mockEditor.state.doc.content.size - 1));
}
export async function finish() { for (const ms of [0, 1600, 2000, 5000, 30000]) await settle(ms); }
export type OrderingEvent = { kind: 'type' | 'arriveSame' | 'arriveOther' | 'arriveLive' | 'timer' | 'ack' | 'offline' | 'online' | 'dictate' | 'doneEdit' | 'typeDictate' | 'dictateType'; word?: string };
let mockAfterMarkSaved: ((content: string) => void) | undefined;
let mockRecovery: NoteDraftPayload | null = null;
let mockRecoveryBase: NoteDraftPayload | undefined;
jest.mock('@/hooks/useDurableDraft', () => {
  const actual = jest.requireActual<typeof import('@/hooks/useDurableDraft')>('@/hooks/useDurableDraft');
  return { ...actual, useDurableDraft: (args: Parameters<typeof actual.useDurableDraft>[0]) => {
    const result = actual.useDurableDraft(args);
    if (!mockRecovery) return result;
    const dismiss = () => { mockRecovery = null; mockRecoveryBase = undefined; };
    return { ...result, recovered: mockRecovery, recoveredBase: mockRecoveryBase,
      acceptRecovered: () => { dismiss(); result.acceptRecovered(); },
      discardRecovered: () => { dismiss(); result.discardRecovered(); },
      captureRecoveredDiscard: () => {
        const discard = result.captureRecoveredDiscard();
        return () => { dismiss(); discard(); };
      },
    };
  } };
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
  mockSession = undefined;
  mockSessionOptions = undefined;
  mockLiveEditor = undefined;
  mockLiveDraft = null;
  noteListeners.clear();
  observeQuestion = undefined;
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
export async function runHistory(events: OrderingEvent[], id: string, options: { keepMounted?: boolean } = {}) {
  await start();
  const questionSteps: QuestionSnapshot[] = [];
  let sequence = 0;
  const requests: { kind: string; operationId: string; issued: number; refused?: number; command: DataCommand; response?: CommandResult }[] = [];
  let eventIndex = -1;
  let receivedValues: NoteDraftPayload;
  const values = (note: Partial<NoteDraftPayload>): NoteDraftPayload => ({
    title: note.title || '', content: note.content || '', tags: note.tags || [],
    scriptureRefs: note.scriptureRefs || [], type: note.type || 'note',
    ...noteRecordingMetadata(note.dictationSourceIds, note.recordingSourceIds),
  });
  receivedValues = values(world.server.documents.get('studyNotes/note-x')!);
  observeQuestion = () => {
    const raw = world.server.documents.get('studyNotes/note-x');
    if (!raw) throw new Error('Missing stored note in question monitor');
    const step = { eventIndex, online: laptop.online, receivedValues, pageValues: values(observedNote()), storedValues: values(raw),
      question: hasNoteQuestion(), blocked: observedNote().saveBlocked };
    const previous = questionSteps.at(-1);
    if (serializeContent(step) !== serializeContent(previous && { eventIndex: previous.eventIndex, online: previous.online, receivedValues: previous.receivedValues, pageValues: previous.pageValues, storedValues: previous.storedValues, question: previous.question, blocked: previous.blocked })) {
      questionSteps.push({ ...step, sequence: ++sequence, refusedRequests: requests.filter(request => request.refused !== undefined).map(request => ({ issued: request.issued, refused: request.refused! })) });
    }
  };
  observeQuestion();
  const waiting: Array<() => void> = [];
  let hold = true;
  const deliver = laptop.transport.send.bind(laptop.transport);
  const sends = jest.spyOn(laptop.transport, 'send').mockImplementation(async command => {
    const request = { kind: command.kind, operationId: command.operationId, issued: ++sequence, command } as (typeof requests)[number];
    requests.push(request);
    if (hold) await new Promise<void>(resolve => waiting.push(resolve));
    const response = await deliver(command);
    if ('snapshot' in response && response.snapshot.value) receivedValues = values(response.snapshot.value);
    request.response = response;
    if (response.kind !== 'acknowledged') request.refused = ++sequence;
    return response;
  });
  const arrived: string[] = [], supersededArrived: string[] = [], typed: string[] = [], steps: unknown[] = [];
  async function refresh() {
    if (!laptop.online) return;
    await laptop.run(() => laptop.engine.refreshCollection('studyNotes'));
    receivedValues = values(world.server.documents.get('studyNotes/note-x')!);
  }
  for (const event of events) {
    eventIndex++;
    if (event.kind === 'doneEdit') {
      fireEvent.click(screen.getByTitle('common.done')); await pulse();
      fireEvent.click(screen.getByTitle('common.edit')); await pulse();
      mockEditor.view.setProps({ handleScrollToSelection: () => true });
    } else if (event.kind === 'typeDictate' || event.kind === 'dictateType') {
      const key = event.word! + 'K', dictated = event.word! + 'D';
      typed.push(key, dictated);
      setTimeout(() => {
        if (event.kind === 'typeDictate') {
          insert(' ' + key);
          void Promise.resolve().then(() => publishDictation(dictated, 'source-' + dictated));
        } else {
          void Promise.resolve().then(() => {
            void publishDictation(dictated, 'source-' + dictated);
            insert(' ' + key);
          });
        }
      }, 0);
      await pulse();
    } else if (event.kind === 'type') {
      typed.push(event.word!);
      setTimeout(() => {
        const state = mockEditor.state;
        mockEditor.view.dispatch(state.tr.insertText(' ' + event.word, state.doc.content.size - 1));
      }, 0);
      await pulse();
    } else if (event.kind === 'arriveSame' || event.kind === 'arriveOther' || event.kind === 'arriveLive') {
      if (event.kind !== 'arriveLive') arrived.push(event.word!);
      const before = await world.snapshot(noteRef);
      const paragraphs = String(before.value!.content).split('\n\n');
      const index = event.kind === 'arriveSame' ? paragraphs.length - 1 : 0;
      paragraphs[index] += ' ' + event.word;
      const content = event.kind === 'arriveLive' ? md() : paragraphs.join('\n\n');
      if (event.kind === 'arriveLive') {
        // This explicit phone replacement supersedes its earlier words absent from the chosen text.
        supersededArrived.push(...arrived.filter(word => !content.includes(word)));
        arrived.splice(0, arrived.length, ...arrived.filter(word => content.includes(word)));
      }
      const changes = diffFields(before.value!, { ...before.value!, content });
      if (changes.length) {
        const result = await processCommand('owner', { protocol: 1, kind: 'update', owner: 'owner', operationId: world.id('phone'),
          resource: noteRef, generation: before.metadata!.generation, dependsOn: [], changes });
        expect(result.kind).toBe('acknowledged');
      }
      await refresh();
      // No act flush: the next public event may race the clean render's passive adoption.
    } else if (event.kind === 'timer') await pulse(1500);
    else if (event.kind === 'ack') {
      const count = waiting.length; waiting.splice(0).forEach(release => release());
      await pulse(); steps.push({ ackReleased: count });
    } else if (event.kind === 'offline') { laptop.goOffline(); await pulse(); }
    else if (event.kind === 'online') {
      laptop.online = true; laptop.run(() => laptop.engine.setOnline(true)); await refresh(); await pulse();
    } else {
      typed.push(event.word!);
      await publishDictation(event.word!, 'source-' + event.word); await pulse();
    }
    const rendered = observedNote();
    steps.push({ ...event, page: rendered.content, baseline: rendered.baselineRef.current?.content, editor: md(), held: waiting.length });
  }
  hold = false; waiting.splice(0).forEach(release => release());
  laptop.online = true; laptop.run(() => laptop.engine.setOnline(true));
  await refresh();
  for (const ms of [0, 1600, 2000, 5000, 30000]) await settle(ms);
  captureNotices();
  const body = document.body.textContent ?? '';
  const question = hasNoteQuestion();
  const storedNote = (await world.snapshot(noteRef)).value! as unknown as StudyNote;
  const rendered = observedNote();
  const confirmed = confirmedFields();
  const pageValues: NoteDraftPayload = { title: rendered.title, content: rendered.content,
    tags: rendered.tags, scriptureRefs: rendered.scriptureRefs, type: rendered.type,
    ...noteRecordingMetadata(rendered.dictationSourceIds, rendered.recordingSourceIds) };
  const storedValues: NoteDraftPayload = { title: storedNote.title || '', content: storedNote.content,
    tags: storedNote.tags, scriptureRefs: storedNote.scriptureRefs, type: storedNote.type || 'note',
    ...noteRecordingMetadata(storedNote.dictationSourceIds, storedNote.recordingSourceIds) };
  const final = { stored: String(await stored()), editor: md(), dom: mockEditor.view.dom.textContent ?? '', page: rendered.content,
    baseline: rendered.baselineRef.current?.content, confirmed: confirmed?.content, saved: body.includes('common.saved'), blocked: rendered.saveBlocked,
    pageValues, storedValues, unsaved: serializeContent(pageValues) !== serializeContent(confirmed) || !body.includes('common.saved'),
    question, notices: [...notices], engineWrites: sends.mock.calls.length, errors: laptop.errors.map(String), pending: laptop.engine.getPending() };
  const unsaved = final.unsaved;
  const missingArrived = arrived.filter(word => !final.stored.includes(word) && !question);
  const missingTyped = typed.filter(word => !final.stored.includes(word) && !(final.editor.includes(word) && final.dom.includes(word) && unsaved) && !question);
  observeQuestion();
  const { falseQuestion, staleQuestion, lateRefusalQuestion, offlineQuestion } = evaluateQuestionHistory(events, questionSteps);
  const unconverged = !question && (final.stored !== final.page || final.page !== final.editor || final.unsaved);
  const record = { id, events, arrived, supersededArrived, typed, final, missingArrived, missingTyped, falseQuestion, staleQuestion, lateRefusalQuestion, offlineQuestion, unconverged, questionSteps, steps, requests };
  if (process.env.NOTE_ORDERING_OUTPUT) appendFileSync(process.env.NOTE_ORDERING_OUTPUT, JSON.stringify(record) + '\n');
  if (!options.keepMounted) disposeHistory();
  return record;
}
