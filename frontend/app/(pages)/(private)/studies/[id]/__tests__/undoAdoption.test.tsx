import { DeviceWorld, noteRef, noteValue, type WorldDevice } from '@test-utils/deviceWorld';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { DataEngineProvider } from '@/data-engine/react.client';
import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import StudyNotePage from '@/(pages)/(private)/studies/[id]/page';
import { processCommand } from '@/data-engine/server';
import { diffFields } from '@/data-engine/protocol';
import { watchedStore } from '@/utils/deviceStorage';

import { redoDepth, undoDepth } from '@tiptap/pm/history';
import type { Editor } from '@tiptap/core';
import type { useTextDictation } from '@/hooks/useTextDictation';
import type { useNoteAutoSave } from '@/(pages)/(private)/studies/[id]/useNoteAutoSave';

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
    const editor = actual.useEditor(...args);
    if (editor) mockEditor = editor;
    return editor;
  } };
});

jest.mock('@/(pages)/(private)/studies/[id]/useNoteAutoSave', () => {
  const actual = jest.requireActual('@/(pages)/(private)/studies/[id]/useNoteAutoSave');
  return { ...actual, useNoteAutoSave: (args: Parameters<typeof useNoteAutoSave>[0]) => {
    mockAutosave = args;
    return actual.useNoteAutoSave(args);
  } };
});

const mockRouteId = 'note-x';
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

const original = 'Original paragraph.';
const local = 'Original paragraph. Laptop edit.';
const phoneParagraph = 'Phone paragraph.';
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
}
async function settle(ms = 0) {
  await act(async () => { if (ms) await world.advance(ms); else await world.settle(); });
  captureNotices();
}
async function start(initialContent = original) {
  localStorage.clear();
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
  fireEvent.click(screen.getByTitle('common.edit'));
  await settle();
  mockEditor.view.setProps({ handleScrollToSelection: () => true });
  mockEditor.on('update', () => { editorUpdates.push(md()); });
  expect(view.container.querySelector('.tiptap')).toBeTruthy();
  expect(md().trim()).toBe(initialContent.trim());
  if (initialContent === original) expect(undoDepth(mockEditor.state)).toBe(0);
}
async function phoneSave(content: string) {
  const before = await world.snapshot(noteRef);
  const result = await processCommand('owner', { protocol: 1, kind: 'update', owner: 'owner', operationId: world.id('phone'),
    resource: noteRef, generation: before.metadata!.generation, dependsOn: [],
    changes: diffFields(before.value!, { ...before.value!, content }) });
  expect(result.kind).toBe('acknowledged');
  await act(async () => {
    await laptop.run(() => laptop.engine.refreshCollection('studyNotes'));
    await world.settle();
  });
  await settle();
}
afterEach(() => {
  observer?.disconnect(); view?.unmount(); world?.dispose();
  localStorage.clear(); jest.restoreAllMocks();
});
it.each([
  { name: 'earlier typing and one Undo', priorTyping: true, undos: 1, laterTyping: false },
  { name: 'earlier typing and two Undos', priorTyping: true, undos: 2, laterTyping: false },
  { name: 'regression pin: earlier typing without Undo', priorTyping: true, undos: 0, laterTyping: false },
  { name: 'no earlier typing and one Undo', priorTyping: false, undos: 1, laterTyping: false },
  { name: 'no earlier typing and two Undos', priorTyping: false, undos: 2, laterTyping: false },
  { name: 'typing, arrival, more typing and two Undos', priorTyping: true, undos: 2, laterTyping: true },
])('keeps the phone paragraph through autosave: $name', async ({ priorTyping, undos, laterTyping }) => {
  await start();
  const liveEditor = mockEditor;
  if (priorTyping) {
    act(() => {
      mockEditor.commands.setTextSelection(mockEditor.state.doc.content.size - 1);
      mockEditor.commands.insertContent(' Laptop edit.');
    });
    await settle(1600);
  }
  const savedLocal = priorTyping ? local : original;
  expect(await stored()).toBe(savedLocal);
  expect(mockAutosave.baselineRef.current?.content).toBe(savedLocal);
  act(() => mockEditor.view.dom.blur());
  await settle(2000);
  const adopted = savedLocal + '\n\n' + phoneParagraph;
  await phoneSave(adopted);
  expect(mockEditor).toBe(liveEditor);
  expect(md()).toBe(adopted);
  expect(mockAutosave.baselineRef.current?.content).toBe(adopted);
  expect(editorUpdates).not.toContain(adopted);
  expect(undoDepth(mockEditor.state)).toBe(0);
  expect(redoDepth(mockEditor.state)).toBe(0);
  if (laterTyping) {
    act(() => {
      mockEditor.commands.setTextSelection(mockEditor.state.doc.content.size - 1);
      mockEditor.commands.insertContent(' More laptop text.');
    });
    await settle();
    expect(md()).toBe(adopted + ' More laptop text.');
  }
  for (let index = 1; index <= undos; index++) {
    act(() => { mockEditor.commands.undo(); });
    await settle();
    await settle(1600);
    await settle(2000);
    const expected = adopted;
    expect(await stored()).toBe(expected);
    expect(md()).toBe(expected);
  }
  expect(notices).toEqual([]);
  expect(laptop.errors).toEqual([]);
  expect(laptop.engine.getPending()).toEqual([]);
  expect(await stored()).toBe(adopted);
});

it('regression pin: keeps the note recording insertion undoable in the same mounted editor', async () => {
  await start();
  const editor = mockEditor;
  const voice = mockVoice;
  await act(async () => { await voice.onText('Dictated passage.', 'recording-source'); });
  await settle();
  expect(mockEditor).toBe(editor);
  expect(md()).toBe(original + '\n\nDictated passage.');
  act(() => { mockEditor.commands.undo(); });
  await settle();
  expect(md()).toBe(original);
});

it('B31 ACCEPTED LIMITATION: an arrival retires saved own typing through real note autosave', async () => {
  await start();
  const editor = mockEditor;
  act(() => {
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(' Laptop edit.');
  });
  await settle(1600); await settle(2000);
  const before = { text: md(), stored: await stored(), depth: undoDepth(editor.state) };
  await phoneSave(local + '\n\n' + phoneParagraph);
  const arrival = { text: md(), stored: await stored(), depth: undoDepth(editor.state) };
  const steps = [];
  for (const command of ['undo', 'undo', 'redo'] as const) {
    let result = false;
    act(() => { result = editor.commands[command](); });
    await settle(1600); await settle(2000);
    steps.push({ command, result, text: md(), stored: await stored(), depth: undoDepth(editor.state) });
  }
  expect(before.text).toBe(local);
  expect(arrival.text).toBe(local + '\n\n' + phoneParagraph);
  expect(steps[0]).toEqual(expect.objectContaining({ result: false, text: local + '\n\n' + phoneParagraph, stored: local + '\n\n' + phoneParagraph }));
  expect(steps[1].result).toBe(false);
  expect(steps[2]).toEqual(expect.objectContaining({ result: false, text: local + '\n\n' + phoneParagraph, stored: local + '\n\n' + phoneParagraph }));
});

it('C12 preserves the production table shape through foreign adoption, later typing and note autosave', async () => {
  await start('| A | B |\n| --- | --- |\n| abcdef | Keep |');
  const editor = mockEditor;
  act(() => { editor.commands.setTextSelection(4); editor.view.focus(); });
  await settle(1600); await settle(2000);
  const remote = '| A | B |\n| --- | --- |\n| abef | Keep |';
  await phoneSave(remote);
  expect(editor.view.dom.querySelectorAll('table')).toHaveLength(1);
  expect(md().trim()).toBe(remote);
  act(() => { expect(editor.commands.undo()).toBe(false); expect(editor.commands.redo()).toBe(false); });
  act(() => { editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' Own.'); });
  await settle(1600); await settle(2000);
  expect(await stored()).toBe(md());
  expect(String(await stored())).toContain('abef');
  expect(String(await stored())).toContain('Own.');
  expect(editor.view.dom.querySelectorAll('table')).toHaveLength(1);
  act(() => { expect(editor.commands.undo()).toBe(true); });
  await settle(1600); await settle(2000);
  expect(String(await stored()).trim()).toBe(remote);
  expect(mockEditor).toBe(editor);
  expect(notices).toEqual([]);
});
