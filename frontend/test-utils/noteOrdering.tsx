import { DeviceWorld, noteRef, noteValue, type WorldDevice } from '@test-utils/deviceWorld';
import React from 'react';
import { appendFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { DataEngineProvider } from '@/data-engine/react.client';
import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import StudyNotePage from '@/(pages)/(private)/studies/[id]/page';
import { processCommand } from '@/data-engine/server';
import { diffFields } from '@/data-engine/protocol';
import { watchedStore } from '@/utils/deviceStorage';
import { serializeContent } from '@/utils/contentFingerprint';
import { noteRecordingMetadata } from '@/utils/studyNoteRecordings';
import { evaluateQuestionHistory, type QuestionSnapshot } from './noteOrderingOracles';

import { undoDepth } from '@tiptap/pm/history';
import type { DataCommand, CommandResult } from '@/data-engine/types';
import type { Editor } from '@tiptap/core';
import type { StudyNote } from '@/models/models';
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
    mockAutosave = args;
    return actual.useNoteAutoSave(args);
  } };
});

let mockRouteId = 'note-x';
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockSearch = new URLSearchParams();
let mockVoice: Parameters<typeof useTextDictation>[0];
let mockBrowser: unknown;
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
// This stand mounts one note. Only its rendered version/draft choices count as safety.
export function hasNoteQuestion() {
  return Array.from(document.querySelectorAll('[data-note-workspace] [role="alert"], [data-note-workspace] [role="status"]')).some(element => {
    const text = element.textContent ?? '';
    const buttons = Array.from(element.querySelectorAll('button')).map(button => button.textContent);
    return (text.includes('freshness.conflictTitle')
      && buttons.includes('freshness.conflictKeepMine') && buttons.includes('freshness.conflictTakeTheirs'))
      || (text.includes('unsavedDraft.title')
        && buttons.includes('unsavedDraft.restore') && buttons.includes('unsavedDraft.discard'));
  });
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
  mockBrowser = { engine: laptop.engine, dispose: () => undefined, editorId: () => world.id('opening') };
  jest.spyOn(window, 'confirm').mockImplementation(() => { notices.push('window.confirm'); return false; });
  jest.spyOn(window, 'alert').mockImplementation(() => { notices.push('window.alert'); });
  observer = new MutationObserver(captureNotices);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  await act(async () => {
    view = laptop.run(() => render(<DataEngineProvider><EngineConflictBanner /><StudyNotePage /></DataEngineProvider>));
    await world.settle();
  });
  if (screen.queryByTitle('common.edit')) fireEvent.click(screen.getByTitle('common.edit'));
  await settle();
  mockEditor.view.setProps({ handleScrollToSelection: () => true });
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
  mockRouteId = 'note-x'; mockAfterMarkSaved = undefined; mockStaleCreation = false; mockEarlyInput = false; mockRecovery = null;
});


export const stand = {
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
  set routeId(value: string) { mockRouteId = value; },
};
export { original, md, stored, start, settle, phoneSave, captureNotices };
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
}
async function pulse(ms = 0) {
  jest.advanceTimersByTime(ms);
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < 900; i++) { await Promise.resolve(); if (i % 300 === 0) jest.advanceTimersByTime(0); }
    jest.advanceTimersByTime(1);
  }
  captureNotices();
}
export async function runHistory(events: OrderingEvent[], id: string) {
  await start();
  const questionSteps: QuestionSnapshot[] = [];
  let sequence = 0;
  const requests: { kind: string; operationId: string; issued: number; refused?: number; command: DataCommand; response?: CommandResult }[] = [];
  let eventIndex = -1;
  const values = (note: Partial<NoteDraftPayload>): NoteDraftPayload => ({
    title: note.title || '', content: note.content || '', tags: note.tags || [],
    scriptureRefs: note.scriptureRefs || [], type: note.type || 'note',
    ...noteRecordingMetadata(note.dictationSourceIds, note.recordingSourceIds),
  });
  observeQuestion = () => {
    const raw = world.server.documents.get('studyNotes/note-x');
    if (!raw) throw new Error('Missing stored note in question monitor');
    const step = { eventIndex, pageValues: values(mockAutosave), storedValues: values(raw),
      question: hasNoteQuestion(), blocked: !!mockAutosave.saveBlocked };
    const previous = questionSteps.at(-1);
    if (serializeContent(step) !== serializeContent(previous && { eventIndex: previous.eventIndex, pageValues: previous.pageValues, storedValues: previous.storedValues, question: previous.question, blocked: previous.blocked })) {
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
    request.response = response;
    if (response.kind !== 'acknowledged') request.refused = ++sequence;
    return response;
  });
  const arrived: string[] = [], supersededArrived: string[] = [], typed: string[] = [], steps: unknown[] = [];
  async function refresh() { if (laptop.online) await laptop.run(() => laptop.engine.refreshCollection('studyNotes')); }
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
          void Promise.resolve().then(() => mockVoice.onText(dictated, 'source-' + dictated));
        } else {
          void Promise.resolve().then(() => {
            void mockVoice.onText(dictated, 'source-' + dictated);
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
      await mockVoice.onText(event.word!, 'source-' + event.word); await pulse();
    }
    steps.push({ ...event, page: mockAutosave.content, baseline: mockAutosave.baselineRef.current?.content, editor: md(), held: waiting.length });
  }
  hold = false; waiting.splice(0).forEach(release => release());
  laptop.online = true; laptop.run(() => laptop.engine.setOnline(true));
  await refresh();
  for (const ms of [0, 1600, 2000, 5000, 30000]) await settle(ms);
  captureNotices();
  const body = document.body.textContent ?? '';
  const question = hasNoteQuestion();
  const storedNote = (await world.snapshot(noteRef)).value! as unknown as StudyNote;
  const pageValues: NoteDraftPayload = { title: mockAutosave.title, content: mockAutosave.content,
    tags: mockAutosave.tags, scriptureRefs: mockAutosave.scriptureRefs, type: mockAutosave.type,
    ...noteRecordingMetadata(mockAutosave.dictationSourceIds, mockAutosave.recordingSourceIds) };
  const storedValues: NoteDraftPayload = { title: storedNote.title || '', content: storedNote.content,
    tags: storedNote.tags, scriptureRefs: storedNote.scriptureRefs, type: storedNote.type || 'note',
    ...noteRecordingMetadata(storedNote.dictationSourceIds, storedNote.recordingSourceIds) };
  const final = { stored: String(await stored()), editor: md(), dom: mockEditor.view.dom.textContent ?? '', page: mockAutosave.content,
    baseline: mockAutosave.baselineRef.current?.content, confirmed: mockConfirmed?.content, saved: body.includes('common.saved'), blocked: mockAutosave.saveBlocked,
    pageValues, storedValues, unsaved: serializeContent(pageValues) !== serializeContent(mockConfirmed) || !body.includes('common.saved'),
    question, notices: [...notices], engineWrites: sends.mock.calls.length, errors: laptop.errors.map(String), pending: laptop.engine.getPending() };
  const unsaved = final.unsaved;
  const missingArrived = arrived.filter(word => !final.stored.includes(word) && !question);
  const missingTyped = typed.filter(word => !final.stored.includes(word) && !(final.editor.includes(word) && final.dom.includes(word) && unsaved) && !question);
  observeQuestion();
  const { falseQuestion, staleQuestion, lateRefusalQuestion } = evaluateQuestionHistory(events, questionSteps);
  const unconverged = !question && (final.stored !== final.page || final.page !== final.editor || final.unsaved);
  const record = { id, events, arrived, supersededArrived, typed, final, missingArrived, missingTyped, falseQuestion, staleQuestion, lateRefusalQuestion, unconverged, questionSteps, steps, requests };
  if (process.env.NOTE_ORDERING_OUTPUT) appendFileSync(process.env.NOTE_ORDERING_OUTPUT, JSON.stringify(record) + '\n');
  disposeHistory();
  return record;
}
