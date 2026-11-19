import { act, fireEvent, screen, within } from '@testing-library/react';

import { noteRef } from '@test-utils/deviceWorld';
import { DeviceStorage } from '@test-utils/deviceWorld/storage';
import { stand, start, original, stored, settle, phoneSave, insert, finish, hasNoteQuestion, reloadPage } from '@test-utils/noteOrdering';

import type { CommandResult, DataCommand, ResourceRef } from '@/data-engine/types';

/*
 * A copy's base is never ahead of what this device has stored. A save handed to the engine becomes the base of the
 * words typed after it only when this device has stored it (its local capture): then the copy is written again with
 * that save as its base, so «Restore» does not ask about his own earlier save. Until then the copy keeps the base before
 * the save — if the page dies before the device stored it, the save is gone with the page, and the copy still holds
 * everything that was not stored. A refused save leaves the base where it was, so it is asked about again. Every
 * history here is driven by the person's actions on the real page with the real engine; the stand counts this
 * device's server commands.
 */

let sends: jest.SpyInstance<Promise<CommandResult>, [DataCommand]>;
function countCommands() {
  const deliver = stand.laptop.transport.send.bind(stand.laptop.transport);
  sends = jest.spyOn(stand.laptop.transport, 'send').mockImplementation(command => deliver(command));
}
let releaseStorage: () => void = () => undefined;
/** This device's storage is busy: whatever is handed to the engine now waits for its local capture. */
function holdDeviceStorage() {
  const storage = stand.laptop.storage as unknown as { tail: Promise<unknown> };
  const previous = storage.tail;
  storage.tail = new Promise<void>(resolve => { releaseStorage = resolve; }).then(() => previous);
}
/** Time passes while the device storage is held (the world cannot settle then). */
async function spin(ms = 0) {
  await act(async () => {
    if (ms) jest.advanceTimersByTime(ms);
    for (let i = 0; i < 3000; i++) { await Promise.resolve(); if (i % 300 === 0) jest.advanceTimersByTime(0); }
  });
}
const conflictShown = () => (document.body.textContent ?? '').includes('freshness.conflictTitle');
const storedAt = async (resource: ResourceRef) => (await stand.world.snapshot(resource)).value as unknown as
  { title?: string; content: string; scriptureRefs?: Array<{ book: string }> } | null;
const typeTitle = (title: string) =>
  fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder'), { target: { value: title } });

/**
 * The page goes away and is killed while device storage is still busy: device storage keeps only what it committed,
 * the save waiting for it is gone with the page. The device starts again with a new engine; its commands count from here.
 */
async function killAndReload() {
  stand.leave();
  const committed = new DeviceStorage();
  for (const [name, rows] of stand.laptop.storage.databases) committed.databases.set(name, new Map(rows));
  (stand.laptop as unknown as { storage: DeviceStorage }).storage = committed;
  await reloadPage();
  countCommands();
  await settle(5000);
}

/** «Text from last time» → «Restore», then the note's ordinary save runs to the end. */
async function restoreAfterKill() {
  expect(screen.getByText('unsavedDraft.title')).toBeInTheDocument();
  fireEvent.click(screen.getByText('unsavedDraft.restore'));
  await finish();
}

async function reopenAndRestore(id = 'note-x') {
  await stand.reopen(id);
  await settle(5000);
  expect(screen.getByText('unsavedDraft.title')).toBeInTheDocument();
  fireEvent.click(screen.getByText('unsavedDraft.restore'));
  await settle();
}

describe('words typed while his own save is still being stored on this device', () => {
  it('an existing note: he leaves before the device stored his save; «Restore» asks nothing and stores both words', async () => {
    await start(); countCommands();
    act(() => insert(' Firstword'));
    await spin(1400);
    holdDeviceStorage();
    await spin(200);
    // The 1.5 s save is handed to the engine; its local capture waits for the device storage.
    act(() => insert(' Secondword'));
    await spin(150);
    stand.leave();
    releaseStorage();
    for (const ms of [0, 1600, 5000, 30000]) await settle(ms);
    expect(await stored()).toBe(original + ' Firstword');

    await reopenAndRestore();
    await finish();

    expect(conflictShown()).toBe(false);
    expect(hasNoteQuestion()).toBe(false);
    expect(await stored()).toBe(original + ' Firstword Secondword');
    expect(sends).toHaveBeenCalledTimes(2);
  });

  it('a new note: he leaves before the device stored its creation; «Restore» on the created note asks nothing and stores both words', async () => {
    stand.routeId = 'new';
    await start(''); countCommands();
    act(() => insert('Hello'));
    await spin(1400);
    holdDeviceStorage();
    await spin(200);
    const created = stand.autosave.noteId;
    expect(created).not.toBe('new');
    act(() => insert(' World'));
    await spin(150);
    stand.leave();
    releaseStorage();
    for (const ms of [0, 1600, 5000, 30000]) await settle(ms);
    const resource = { collection: 'studyNotes', id: created } as ResourceRef;
    expect((await storedAt(resource))?.content).toBe('Hello');

    await reopenAndRestore(created);
    await finish();

    expect(conflictShown()).toBe(false);
    expect(hasNoteQuestion()).toBe(false);
    expect((await storedAt(resource))?.content).toBe('Hello World');
    expect(sends).toHaveBeenCalledTimes(2);
  });

  it('words equal to the save being stored keep the base that save is checked against: killed before the device stored it, «Restore» sends it unasked', async () => {
    await start(); countCommands();
    act(() => insert(' Firstword'));
    await spin(1400);
    holdDeviceStorage();
    await spin(200);
    // His save is handed to the engine; nothing is typed after it; the page goes away and is killed before the
    // device stored the save: device storage keeps only what was committed, the save is lost with the page.
    await killAndReload();
    expect(await stored()).toBe(original);

    await restoreAfterKill();

    expect(hasNoteQuestion()).toBe(false);
    expect(await stored()).toBe(original + ' Firstword');
    expect(sends).toHaveBeenCalledTimes(1);
  });

  it('his «keep my text» send is a hand-off too: words typed while the device stores it restore unasked, and no copy is left behind', async () => {
    await start(); countCommands();
    act(() => insert(' Myword'));
    await phoneSave(original + ' Phoneword');
    await finish();
    expect(conflictShown()).toBe(true);
    expect(sends).not.toHaveBeenCalled();

    holdDeviceStorage();
    const workspace = within(document.querySelector('[data-note-workspace]') as HTMLElement);
    fireEvent.click(workspace.getByRole('button', { name: 'freshness.conflictKeepMine' }));
    // However the answer is sent (at once, or after the typing pause), it is handed to the engine by now and waits.
    await spin(1600);
    act(() => insert(' Afterword'));
    await spin(150);
    stand.leave();
    releaseStorage();
    for (const ms of [0, 1600, 5000, 30000]) await settle(ms);
    expect(await stored()).toBe(original + ' Myword');

    await reopenAndRestore();
    await finish();
    expect(hasNoteQuestion()).toBe(false);
    expect(await stored()).toBe(original + ' Myword Afterword');
    expect(sends).toHaveBeenCalledTimes(2);

    // Everything is stored: no copy is offered again.
    stand.leave();
    for (const ms of [0, 1600, 5000]) await settle(ms);
    await stand.reopen();
    await settle(5000);
    expect((document.body.textContent ?? '').includes('unsavedDraft.title')).toBe(false);
  });

  it('a save refused while it was being stored: the copy keeps the base before it, so a page killed then still asks about it', async () => {
    await start(); countCommands();
    // He adds a reference; before his pause ends the phone stores another one, and it reaches this device.
    const input = screen.getByPlaceholderText('studiesWorkspace.quickRefPlaceholder');
    fireEvent.change(input, { target: { value: 'John 3:16' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await phoneSave(original, { scriptureRefs: [{ id: 'phone-ref', bible: 'kjv', book: 'Psalms', chapter: 51, fromVerse: 12 }] });
    await spin(1000);
    holdDeviceStorage();
    await spin(600);
    // His save is handed to the engine and waits for the device storage; he types on, and the copy is written.
    act(() => insert(' Secondword'));
    await spin(400);
    releaseStorage();
    await settle();
    // The device checks the save against what it holds: the reference changed elsewhere, so it is refused and asked.
    expect(conflictShown()).toBe(true);
    expect(sends).not.toHaveBeenCalled();

    // The page is killed now: what device storage holds is what the next opening finds.
    const atKill = Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)!]));
    stand.leave();
    localStorage.clear();
    for (const [key, value] of Object.entries(atKill)) localStorage.setItem(key, value);
    for (const ms of [0, 1600, 5000]) await settle(ms);

    await reopenAndRestore();
    await finish();

    // The refused reference is asked about again, not dropped while the text alone is sent.
    expect(conflictShown()).toBe(true);
    const note = await storedAt(noteRef);
    expect(note?.scriptureRefs?.map(ref => ref.book)).toEqual(['Psalms']);
    expect(note?.content).toBe(original);
    expect(sends).not.toHaveBeenCalled();
  });
});

describe('the page is killed while the device is still storing his save, after he typed more', () => {
  it('a) his new title was being stored when he typed in the text: «Restore» stores the title and the word, unasked', async () => {
    await start(); countCommands();
    typeTitle('Laptop title');
    await spin(1400);
    holdDeviceStorage();
    await spin(200);
    // The title's save is handed to the engine and waits for the device storage; he types a word in the text and the
    // 250 ms copy is written; then the page is killed before the device stored the title.
    act(() => insert(' Afterword'));
    await spin(400);
    await killAndReload();
    expect(await storedAt(noteRef)).toEqual(expect.objectContaining({ content: original }));
    expect((await storedAt(noteRef))?.title).not.toBe('Laptop title');

    await restoreAfterKill();

    expect(hasNoteQuestion()).toBe(false);
    expect(await storedAt(noteRef)).toEqual(expect.objectContaining({ title: 'Laptop title', content: original + ' Afterword' }));
    expect(stand.autosave.title).toBe('Laptop title');
    expect(sends).toHaveBeenCalledTimes(1);
  });

  it('b) his words were being stored when he typed more words: «Restore» stores both, and asks nothing', async () => {
    await start(); countCommands();
    act(() => insert(' Firstword'));
    await spin(1400);
    holdDeviceStorage();
    await spin(200);
    act(() => insert(' Secondword'));
    await spin(400);
    await killAndReload();
    expect(await stored()).toBe(original);

    await restoreAfterKill();

    expect(conflictShown()).toBe(false);
    expect(hasNoteQuestion()).toBe(false);
    expect(await stored()).toBe(original + ' Firstword Secondword');
    expect(sends).toHaveBeenCalledTimes(1);
  });

  it('c) his title and words were being stored when he typed more words: «Restore» stores the title and both words', async () => {
    await start(); countCommands();
    typeTitle('Laptop title');
    act(() => insert(' Firstword'));
    await spin(1400);
    holdDeviceStorage();
    await spin(200);
    act(() => insert(' Secondword'));
    await spin(400);
    await killAndReload();

    await restoreAfterKill();
    // Were he asked, his answer would be «Keep my text»: whatever he is asked, nothing he typed may be lost.
    const asked = conflictShown();
    if (asked) {
      const workspace = within(document.querySelector('[data-note-workspace]') as HTMLElement);
      fireEvent.click(workspace.getByRole('button', { name: 'freshness.conflictKeepMine' }));
      await finish();
    }

    expect(await storedAt(noteRef)).toEqual(expect.objectContaining({ title: 'Laptop title', content: original + ' Firstword Secondword' }));
    expect(asked).toBe(false);
    expect(hasNoteQuestion()).toBe(false);
    expect(sends).toHaveBeenCalledTimes(1);
  });

  it('d) iPad: his new title was being stored, he typed one word and hid the app at once: «Restore» stores the title and the word', async () => {
    await start(); countCommands();
    typeTitle('Laptop title');
    await spin(1400);
    holdDeviceStorage();
    await spin(200);
    act(() => insert(' Afterword'));
    // Home pressed before the 250 ms copy: the hide writes the copy at once; the frozen page is dropped later.
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    await killAndReload();

    await restoreAfterKill();

    expect(hasNoteQuestion()).toBe(false);
    expect(await storedAt(noteRef)).toEqual(expect.objectContaining({ title: 'Laptop title', content: original + ' Afterword' }));
    expect(stand.autosave.title).toBe('Laptop title');
    expect(sends).toHaveBeenCalledTimes(1);
  });
});
