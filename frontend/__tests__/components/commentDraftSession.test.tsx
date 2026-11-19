import { DeviceWorld, type WorldDevice } from '@test-utils/deviceWorld';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { CommentDialog } from '@/components/CommentDialog';
import { editorIdentity } from '@/data-engine/editorIdentity';
import { diffFields } from '@/data-engine/protocol';
import { DataEngineProvider } from '@/data-engine/react.client';
import { processCommand } from '@/data-engine/server';
import { watchedStore } from '@/utils/deviceStorage';
import { draftKey, saveDraft } from '@/utils/durableDraft';

import type { CommandResult, DataCommand, DocumentData, ResourceRef } from '@/data-engine/types';

/*
 * A WRITTEN COMMENT'S WORDS LEFT ON THE DEVICE ARE A FROZEN WINDOW SESSION: the words and the version they were typed
 * over. In the reader he opens a written comment, types, and the page goes away before «Готово» (the tab is closed):
 * the words stay only as the device's copy. The comment changes on his other device. Back here he opens the comment's
 * window, presses «Восстановить» and «Готово». The window's existing check then decides as it would have in the
 * session the words were typed in: send, merge, or ask its question. Every history is driven by the person's actions
 * on the real window with the real engine and an in-process server; the stand counts this device's server commands.
 */

jest.mock('@/services/storeAvailability.server', () => ({ storeRetryHeaders: () => ({}) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: () => mockBrowser }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' }, loading: false }) }));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: 'owner', isAuthLoading: false }) }));
jest.mock('@/services/firebaseAuth.service', () => ({ auth: { currentUser: null } }));
jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: jest.fn() }));
jest.mock('@/services/studies.service', () => ({ NOTE_AGGREGATE: 'note' }));
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key, language: 'en' }) }));
jest.mock('@locales/i18n', () => ({ __esModule: true, default: { language: 'en', t: (key: string) => key } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/components/MarkdownDisplay', () => ({ __esModule: true, default: ({ content }: { content: string }) => <div>{content}</div> }));
jest.mock('@/components/bible/useBookTexts', () => ({ useBookTexts: () => new Map() }));
// The notes' own editor (a Tiptap surface), stood in for by a plain field, as in the window's own tests.
jest.mock('@/components/ui/RichMarkdownEditor', () => ({
  RichMarkdownEditor: ({ value, onChange, editable = true }: { value: string; onChange: (value: string) => void; editable?: boolean }) => (
    <textarea aria-label="editor" value={value} readOnly={!editable} onChange={(event) => onChange(event.target.value)} />
  ),
}));

let mockBrowser: { engine: WorldDevice['engine']; dispose: () => void; editorId: (resource: ResourceRef, slot?: string) => string };
let world: DeviceWorld;
let laptop: WorldDevice;
let view: ReturnType<typeof render> | null = null;
let sends: jest.SpyInstance<Promise<CommandResult>, [DataCommand]>;

const commentRef = { collection: 'studyNotes', id: 'c1' };
const reference = { id: 'r', bible: 'rst', book: 'Isaiah', chapter: 40, fromVerse: 31 };
const opening = 'Сила приходит в ожидании.';
const typed = `${opening} Моё.`;
const phoneWords = 'Слова с другого устройства.';

const storedComment = async () => (await world.snapshot(commentRef)).value as unknown as { content: string; paragraph?: boolean; type: string };
const updates = () => sends.mock.calls.filter(([command]) => command.kind === 'update' && command.resource.id === 'c1').length;
const questionShown = () => Boolean(screen.queryByRole('button', { name: 'freshness.conflictKeepMine' }))
  && Boolean(screen.queryByRole('button', { name: 'freshness.conflictTakeTheirs' }));
const editor = () => screen.getByLabelText('editor') as HTMLTextAreaElement;

async function settle(ms = 0) {
  await act(async () => { if (ms) await world.advance(ms); else await world.settle(); });
}

/** Counts this device's server commands from now on (a reload gives the device a new transport). */
function countCommands() {
  const deliver = laptop.transport.send.bind(laptop.transport);
  sends = jest.spyOn(laptop.transport, 'send').mockImplementation(command => deliver(command));
}

/** The reader's window on the written comment, as the reader opens it; `placeRefusal` — the reader's paragraph rule. */
async function openComment(placeRefusal?: React.ComponentProps<typeof CommentDialog>['placeRefusal']) {
  await act(async () => {
    view = laptop.run(() => render(
      <DataEngineProvider>
        <CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} paragraphChoice={{ initial: false }} placeRefusal={placeRefusal} />
      </DataEngineProvider>,
    ));
    await world.settle();
  });
  await settle(300);
}

async function start() {
  localStorage.clear();
  globalThis.Headers = class {
    constructor(private values: Record<string, string> = {}) {}
    get(key: string) { return this.values[key] ?? null; }
  } as unknown as typeof Headers;
  world = new DeviceWorld();
  jest.useFakeTimers({ now: world.now, doNotFake: ['queueMicrotask'] });
  await world.seed(commentRef, { userId: 'owner', type: 'comment', title: '', content: opening, scriptureRefs: [reference], tags: [],
    isDraft: false, createdAt: '2026-11-12', updatedAt: '2026-11-12' } as DocumentData);
  laptop = await world.device('laptop');
  jest.mocked(watchedStore).mockImplementation(database => laptop.storage.store(database));
  mockBrowser = { engine: laptop.engine, dispose: () => undefined,
    editorId: (resource: ResourceRef, slot = 'default') => editorIdentity('laptop', resource, slot, world.id('opening')) };
  countCommands();
}

/** He types in the opened window and the tab is closed before «Готово»: the words stay as the device's copy. */
async function typeAndCloseTheTab(words: string) {
  await openComment();
  expect(editor()).toHaveValue(opening);
  fireEvent.change(editor(), { target: { value: words } });
  await settle(100);
  act(() => { window.dispatchEvent(new Event('pagehide')); });
  view?.unmount();
  view = null;
  await act(async () => { await laptop.reload(); });
  mockBrowser.engine = laptop.engine;
  countCommands();
}

/** The other device saves the comment; this device's list has it before the window opens again. */
async function otherDeviceSaves(fields: Record<string, unknown>) {
  const before = await world.snapshot(commentRef);
  const result = await processCommand('owner', { protocol: 1, kind: 'update', owner: 'owner', operationId: world.id('phone'),
    resource: commentRef, generation: before.metadata!.generation, dependsOn: [],
    changes: diffFields(before.value!, JSON.parse(JSON.stringify({ ...before.value!, ...fields }))) });
  expect(result.kind).toBe('acknowledged');
  await act(async () => {
    await laptop.run(() => laptop.engine.refreshCollection('studyNotes'));
    await world.settle();
  });
}

/** He opens the comment's window again, sees «Текст с прошлого раза», presses «Восстановить», then «Готово». */
async function restoreAndSave() {
  await openComment();
  expect(screen.getByRole('button', { name: 'unsavedDraft.restore' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
  await settle();
  expect(editor()).toHaveValue(typed);
  fireEvent.click(screen.getByRole('button', { name: 'common.done' }));
  for (const ms of [0, 1000, 5000]) await settle(ms);
}

afterEach(() => {
  view?.unmount();
  view = null;
  cleanup();
  jest.advanceTimersByTime(1);
  world?.dispose();
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('restoring a written comment\'s words resumes the window session they were typed in', () => {
  it('does not silently replace words another device saved since: the save is refused before any command and the window asks', async () => {
    await start();
    await typeAndCloseTheTab(typed);
    await otherDeviceSaves({ content: phoneWords });

    await restoreAndSave();

    expect((await storedComment()).content).toBe(phoneWords);
    expect(updates()).toBe(0);
    expect(questionShown()).toBe(true);
    // His words are still in the window for the answer.
    expect(editor()).toHaveValue(typed);

    // «Оставить мой текст» is his decision over the version he was asked about: one command, his words stored.
    fireEvent.click(screen.getByRole('button', { name: 'freshness.conflictKeepMine' }));
    for (const ms of [0, 1000, 5000]) await settle(ms);
    expect((await storedComment()).content).toBe(typed);
    expect(updates()).toBe(1);
  });

  it('stores his words with one command and no question when nothing changed elsewhere', async () => {
    await start();
    await typeAndCloseTheTab(typed);
    await act(async () => {
      await laptop.run(() => laptop.engine.refreshCollection('studyNotes'));
      await world.settle();
    });

    await restoreAndSave();

    expect((await storedComment()).content).toBe(typed);
    expect(questionShown()).toBe(false);
    expect(updates()).toBe(1);
  });

  it('keeps the kind another device chose and adds his words, with one command and no question', async () => {
    await start();
    await typeAndCloseTheTab(typed);
    await otherDeviceSaves({ paragraph: true });

    await restoreAndSave();

    const comment = await storedComment();
    expect(comment.content).toBe(typed);
    expect(comment.paragraph).toBe(true);
    expect(comment.type).toBe('comment');
    expect(questionShown()).toBe(false);
    expect(updates()).toBe(1);
  });

  it('does not refuse a restored kind of a comment whose place was stored before references kept their Bible', async () => {
    // "Isa 40:31" saved by an older app: no Bible in the stored data; every screen reads it with one.
    await start();
    await otherDeviceSaves({ scriptureRefs: [{ id: 'r', book: 'Isaiah', chapter: 40, fromVerse: 31 }] });
    // The reader's paragraph rule is asked of the place as the window reads it.
    const asked: unknown[] = [];
    const placeRefusal = (place: unknown) => { asked.push(place); return null; };
    await openComment(placeRefusal);
    fireEvent.click(screen.getByRole('button', { name: 'comment.kind.paragraph' }));
    await settle(100);
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    view?.unmount();
    view = null;
    await act(async () => { await laptop.reload(); });
    mockBrowser.engine = laptop.engine;
    countCommands();
    await act(async () => {
      await laptop.run(() => laptop.engine.refreshCollection('studyNotes'));
      await world.settle();
    });

    await openComment(placeRefusal);
    fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'common.done' }));
    for (const ms of [0, 1000, 5000]) await settle(ms);

    // The same reading the list gives the live window: the interface's Bible, as every screen reads an old reference.
    expect(asked).toEqual([{ id: 'r', bible: 'kjv', book: 'Isaiah', chapter: 40, fromVerse: 31 }]);
    const comment = await storedComment() as unknown as { paragraph?: boolean; scriptureRefs: unknown[] };
    expect(comment.paragraph).toBe(true);
    expect(comment.scriptureRefs).toEqual([{ id: 'r', book: 'Isaiah', chapter: 40, fromVerse: 31 }]);
    expect(questionShown()).toBe(false);
    expect(updates()).toBe(1);
  });

  it('asks about a copy kept before copies kept their base, even where nothing changed elsewhere; «keep mine» then sends it once', async () => {
    await start();
    // A copy written by an older build: the words alone, nothing of what they were typed over.
    saveDraft(draftKey('owner', 'c1', 'comment', 'older-build'), { text: typed, reference: null, title: '' });
    expect(JSON.parse(localStorage.getItem(draftKey('owner', 'c1', 'comment', 'older-build'))!)).not.toHaveProperty('base');

    await restoreAndSave();

    expect((await storedComment()).content).toBe(opening);
    expect(updates()).toBe(0);
    expect(questionShown()).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'freshness.conflictKeepMine' }));
    for (const ms of [0, 1000, 5000]) await settle(ms);
    expect((await storedComment()).content).toBe(typed);
    expect(updates()).toBe(1);
  });
});
