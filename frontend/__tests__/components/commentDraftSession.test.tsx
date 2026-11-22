import { DeviceWorld, type WorldDevice } from '@test-utils/deviceWorld';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React, { useState } from 'react';

import { CommentDialog } from '@/components/CommentDialog';
import { editorIdentity } from '@/data-engine/editorIdentity';
import { diffFields } from '@/data-engine/protocol';
import { DataEngineProvider } from '@/data-engine/react.client';
import { processCommand } from '@/data-engine/server';
import { watchedStore } from '@/utils/deviceStorage';
import { draftKey, saveDraft } from '@/utils/durableDraft';

import type { CommandResult, DataCommand, DocumentData, ResourceRef } from '@/data-engine/types';
import type { ScriptureReference } from '@/models/models';

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
  RichMarkdownEditor: ({ value, onChange, ownedBy, editable = true }: import('@/components/ui/RichMarkdownEditor').RichMarkdownEditorProps) => (
    <textarea aria-label="editor" value={ownedBy?.live() ?? value} readOnly={!editable}
      onChange={event => (ownedBy?.emit ?? onChange)?.(event.target.value)} />
  ),
}));

let mockBrowser: { engine: WorldDevice['engine']; dispose: () => void; editorId: (resource: ResourceRef, slot?: string) => string };
let world: DeviceWorld;
let laptop: WorldDevice;
let view: ReturnType<typeof render> | null = null;
let sends: jest.SpyInstance<Promise<CommandResult>, [DataCommand]>;

const commentRef = { collection: 'studyNotes', id: 'c1' };
const reference = { id: 'r', bible: 'rst' as const, book: 'Isaiah', chapter: 40, fromVerse: 31 };
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
async function openComment(placeRefusal?: React.ComponentProps<typeof CommentDialog>['placeRefusal'],
  onChooseVerses?: React.ComponentProps<typeof CommentDialog>['onChooseVerses']) {
  await act(async () => {
    view = laptop.run(() => render(
      <DataEngineProvider>
        <CommentDialog target={{ kind: 'edit', id: 'c1' }} place="Ис 40:31" onClose={jest.fn()} paragraphChoice={{ initial: false }} placeRefusal={placeRefusal} onChooseVerses={onChooseVerses} />
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
  if (!laptop.online) return;
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

it('stages the words in the shared editor and leaves the command queue empty until Done', async () => {
  await start();
  await typeAndCloseTheTab(typed);

  const records = await laptop.run(() => laptop.engine.listRecoverable(commentRef));
  expect(records.map(({ record }) => record.checkpoint.draft?.content)).toContain(typed);
  expect(Object.keys(localStorage).some(key => key.startsWith('draft:'))).toBe(false);
  expect(updates()).toBe(0);

  await restoreAndSave();

  expect((await storedComment()).content).toBe(typed);
  expect(updates()).toBe(1);
});

it('saves a native input and Done in the same task as one command', async () => {
  await start();
  await openComment();

  act(() => {
    fireEvent.change(editor(), { target: { value: typed } });
    fireEvent.click(screen.getByRole('button', { name: 'common.done' }));
  });
  for (const ms of [0, 1000, 5000]) await settle(ms);

  expect((await storedComment()).content).toBe(typed);
  expect(updates()).toBe(1);
});

it('puts back a recovered move to the current saved verse and closes without sending', async () => {
  await start();
  const home = { ...reference, fromVerse: 33 };
  await otherDeviceSaves({ scriptureRefs: [home], content: phoneWords });
  const key = draftKey('owner', 'c1', 'comment', 'historical-move');
  saveDraft(key, { text: opening, reference: { ...reference, fromVerse: 32 } }, undefined, false, undefined, { opened: {
    content: opening, type: 'comment', scriptureRefs: [reference],
  } });
  await openComment();
  fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
  await settle();
  expect(editor()).toHaveValue(phoneWords);
  expect(screen.getByTestId('comment-moved')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'dataSync.useLocalVersion' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'comment.moveBack' }));
  await settle();
  expect(questionShown()).toBe(false);
  expect(screen.queryByTestId('comment-moved')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'common.done' }));
  await settle();
  expect(updates()).toBe(0);
  expect((await world.snapshot(commentRef)).value?.scriptureRefs).toEqual([home]);
  expect(localStorage.getItem(key)).toBeNull();
});

it('explains when the verse picker opened on a reference since replaced elsewhere', async () => {
  await start();
  let finishPick: ((reference: import('@/models/models').ScriptureReference) => void) | undefined;
  await openComment(undefined, (_here, select) => { finishPick = select; });
  fireEvent.click(screen.getByRole('button', { name: 'comment.changeVerses' }));
  expect(finishPick).toBeDefined();
  const replacement = { ...reference, id: 'replacement', fromVerse: 33 };
  await otherDeviceSaves({ scriptureRefs: [replacement] });
  await act(async () => { await laptop.run(() => laptop.engine.retry(commentRef)); });
  act(() => finishPick!({ ...reference, fromVerse: 32 }));
  await settle();

  expect(screen.getByText('comment.placeChanged')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'common.done' })).toBeDisabled();
  expect(editor()).toHaveValue(opening);
  expect(updates()).toBe(0);
  expect((await world.snapshot(commentRef)).value?.scriptureRefs).toEqual([replacement]);
});

it('can keep the pending conversion to a note after another device saves different words', async () => {
  await start();
  await openComment();
  const expanded = Array.from({ length: 70 }, (_, index) => 'word' + index).join(' ');
  await act(async () => { laptop.goOffline(); await world.settle(); });
  fireEvent.change(editor(), { target: { value: expanded } });
  await settle();
  fireEvent.change(screen.getByPlaceholderText('comment.noteTitlePlaceholder'), { target: { value: 'A new note' } });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'comment.toNote' }));
  await settle();
  view?.unmount();
  view = null;
  await otherDeviceSaves({ content: phoneWords });
  await act(async () => { await laptop.goOnline(); });
  for (const ms of [0, 1000, 5000]) await settle(ms);
  expect((await storedComment()).content).toBe(phoneWords);

  await openComment();
  if (!questionShown()) {
    fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
    await settle();
  }
  expect(questionShown()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'freshness.conflictKeepMine' }));
  for (const ms of [0, 1000, 5000]) await settle(ms);

  expect(await storedComment()).toMatchObject({ content: expanded, title: 'A new note', type: 'note' });
});

it('retains words typed after a submitted comment when taking the saved version for that submission', async () => {
  await start();
  await openComment();
  await act(async () => { laptop.goOffline(); await world.settle(); });
  fireEvent.change(editor(), { target: { value: typed } });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'common.done' }));
  await settle();
  view?.unmount();
  view = null;

  await openComment();
  expect(editor()).toHaveValue(typed);
  const later = typed + ' Words after pressing Done.';
  fireEvent.change(editor(), { target: { value: later } });
  await settle();
  await otherDeviceSaves({ content: phoneWords });
  await act(async () => { await laptop.goOnline(); });
  for (const ms of [0, 1000, 5000]) await settle(ms);
  expect(questionShown()).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'freshness.conflictTakeTheirs' }));
  for (const ms of [0, 1000, 5000]) await settle(ms);

  expect((await storedComment()).content).toBe(phoneWords);
  expect(editor()).toHaveValue(later);
  expect(questionShown()).toBe(true);
});

it('restores a new comment at the same opening and creates it once on Done', async () => {
  await start();
  const openNew = async (verse: number, openingId: string) => {
    await act(async () => {
      view = laptop.run(() => render(<DataEngineProvider>
        <CommentDialog target={{ kind: 'new', reference: { ...reference, id: openingId, fromVerse: verse } }}
          place={'Isa 40:' + verse} onClose={jest.fn()} paragraphChoice={{ initial: false }} />
      </DataEngineProvider>));
      await world.settle();
    });
    await settle(300);
  };
  const leave = () => { view?.unmount(); view = null; };
  const creations = () => sends.mock.calls.flatMap(([command]) =>
    command.kind === 'create' && command.resource.collection === 'studyNotes' ? [command] : []);

  await openNew(32, 'original-door');
  expect(editor()).toHaveValue('');
  fireEvent.change(editor(), { target: { value: 'My first words on a new verse.' } });
  await settle();
  leave();
  await act(async () => { await laptop.reload(); });
  mockBrowser.engine = laptop.engine;
  countCommands();

  const copies = await laptop.run(() => laptop.engine.listRecoverable());
  const copy = copies.find(({ record }) => record.checkpoint.draft?.content === 'My first words on a new verse.');
  expect(copy?.record.checkpoint.confirmed.value).toBeNull();
  expect(Object.keys(localStorage).some(key => key.startsWith('draft:'))).toBe(false);
  expect(creations()).toEqual([]);

  await openNew(33, 'different-door');
  expect(screen.queryByRole('button', { name: 'unsavedDraft.restore' })).not.toBeInTheDocument();
  leave();
  await openNew(32, 'reopened-door');
  fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
  await settle();
  expect(editor()).toHaveValue('My first words on a new verse.');
  expect(creations()).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'common.done' }));
  for (const ms of [0, 1000, 5000]) await settle(ms);
  expect(creations()).toHaveLength(1);
  expect(creations()[0].resource).toEqual(copy!.record.checkpoint.confirmed.resource);
  expect((await world.snapshot(creations()[0].resource)).value).toMatchObject({
    content: 'My first words on a new verse.', scriptureRefs: [{ id: 'original-door', fromVerse: 32 }], type: 'comment',
  });
  leave();
  await openNew(32, 'after-save');
  expect(screen.queryByRole('button', { name: 'unsavedDraft.restore' })).not.toBeInTheDocument();
  expect(creations()).toHaveLength(1);
});

it('restores the chosen place of an unfinished comment from the Studies picker', async () => {
  await start();
  const chosen = { ...reference, id: 'studies-place', fromVerse: 9 };
  function StudiesComment() {
    const [place, setPlace] = useState<ScriptureReference | null>(null);
    return <CommentDialog target={{ kind: 'new', reference: place }} place={place ? 'Isa 40:9' : ''} onClose={jest.fn()}
      placePicker={() => <button type="button" onClick={() => setPlace(chosen)}>{place ? 'Change chosen place' : 'Choose place'}</button>}
      restorePlace={setPlace} />;
  }
  const openStudy = async () => {
    await act(async () => {
      view = laptop.run(() => render(<DataEngineProvider><StudiesComment /></DataEngineProvider>));
      await world.settle();
    });
    await settle(300);
  };
  const words = 'A comment before the place was chosen.';
  await openStudy();
  fireEvent.change(editor(), { target: { value: words } });
  await settle();
  expect(screen.getByRole('button', { name: 'common.done' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Choose place' }));
  await settle();
  view?.unmount();
  view = null;
  await act(async () => { await laptop.reload(); });
  mockBrowser.engine = laptop.engine;
  countCommands();

  await openStudy();
  fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
  await settle(1000);
  expect(editor()).toHaveValue(words);
  expect(screen.getByRole('button', { name: 'Change chosen place' })).toBeInTheDocument();
  expect(sends.mock.calls.filter(([command]) => command.kind === 'create')).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'common.done' }));
  for (const ms of [0, 1000, 5000]) await settle(ms);
  const commands = sends.mock.calls.flatMap(([command]) => command.kind === 'create' && command.resource.collection === 'studyNotes' ? [command] : []);
  expect(commands).toHaveLength(1);
  expect((await world.snapshot(commands[0].resource)).value).toMatchObject({ content: words, scriptureRefs: [chosen] });
});

it('imports and retires an old unsaved comment from the same reader opening', async () => {
  await start();
  const original = { ...reference, id: 'new-door', fromVerse: 32 };
  const retained = { ...original, id: 'retained-door', fromVerse: 33 };
  const key = draftKey('owner', 'new:rst:Isaiah:40:32', 'comment', 'older-build');
  saveDraft(key, { text: 'A comment from before the update.', reference: retained, paragraph: false });
  await act(async () => {
    view = laptop.run(() => render(<DataEngineProvider>
      <CommentDialog target={{ kind: 'new', reference: original }} place="Isa 40:32" onClose={jest.fn()} paragraphChoice={{ initial: true }} />
    </DataEngineProvider>));
    await world.settle();
  });
  await settle(300);
  fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
  await settle();
  expect(editor()).toHaveValue('A comment from before the update.');
  expect(localStorage.getItem(key)).toBeNull();
  expect(sends.mock.calls.filter(([command]) => command.kind === 'create')).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'common.done' }));
  for (const ms of [0, 1000, 5000]) await settle(ms);
  const commands = sends.mock.calls.flatMap(([command]) => command.kind === 'create' && command.resource.collection === 'studyNotes' ? [command] : []);
  expect(commands).toHaveLength(1);
  expect((await world.snapshot(commands[0].resource)).value).toMatchObject({ paragraph: false, scriptureRefs: [retained] });
});

it.each(['accepted', 'queued'] as const)('does not recreate a legacy comment when its exact old backup survives a %s save', async delivery => {
  await start();
  const original = { ...reference, id: 'old-place', fromVerse: 32 };
  const key = draftKey('owner', 'new:rst:Isaiah:40:32', 'comment', 'older-build');
  saveDraft(key, { text: 'One old comment, even after a retry.', reference: original });
  const previousBytes = localStorage.getItem(key)!;
  const open = async () => {
    await act(async () => {
      view = laptop.run(() => render(<DataEngineProvider>
        <CommentDialog target={{ kind: 'new', reference: original }} place="Isa 40:32" onClose={jest.fn()} />
      </DataEngineProvider>));
      await world.settle();
    });
    await settle(300);
  };
  const creates = () => sends.mock.calls.filter(([command]) => command.kind === 'create' && command.resource.collection === 'studyNotes');

  await open();
  if (delivery === 'queued') await act(async () => { laptop.goOffline(); await world.settle(); });
  fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
  await settle(1000);
  fireEvent.click(screen.getByRole('button', { name: 'common.done' }));
  for (const ms of [0, 1000, 5000]) await settle(ms);
  expect(creates()).toHaveLength(delivery === 'accepted' ? 1 : 0);
  view?.unmount();
  view = null;

  // The old storage and IndexedDB can have been captured at different points in the migration.
  localStorage.setItem(key, previousBytes);
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
  await settle(1000);
  expect(screen.getByRole('button', { name: 'common.done' })).toBeDisabled();
  expect(editor()).toHaveValue('');
  expect(localStorage.getItem(key)).toBeNull();
  if (delivery === 'queued') await act(async () => { await laptop.goOnline(); });
  for (const ms of [0, 1000, 5000]) await settle(ms);
  expect(creates()).toHaveLength(1);
});

it('uses the header trash action and confirms an existing comment deletion', async () => {
  await start();
  await openComment();
  const erase = screen.getByRole('button', { name: 'comment.erase' });
  expect(erase).toHaveTextContent('');
  expect(erase.compareDocumentPosition(editor()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(erase);
  const question = screen.getByRole('dialog', { name: 'comment.eraseTitle' });
  fireEvent.click(within(question).getByRole('button', { name: 'comment.erase' }));
  for (const ms of [0, 1000, 5000]) await settle(ms);
  expect(sends.mock.calls.filter(([command]) => command.kind === 'delete')).toHaveLength(1);
  expect((await world.snapshot(commentRef)).value).toBeNull();
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
