import { act, fireEvent, screen } from '@testing-library/react';

import { noteRef } from '@test-utils/deviceWorld';
import { draftKey } from '@/utils/durableDraft';
import { stand, start, original, stored, settle, phoneSave, insert, finish, hasNoteQuestion, hasInlineQuestion } from '@test-utils/noteOrdering';

import type { CommandResult, DataCommand } from '@/data-engine/types';

/*
 * Text typed and left inside the save pause lives only as this device's draft. «Restore» resumes the editing
 * session it was typed in — the words and what they were built from — so the note's ordinary save and its
 * existing baseline check decide: send, merge by field, or ask. Every history here is driven by the person's
 * actions on the real page with the real engine; the stand counts this device's server commands.
 */

let sends: jest.SpyInstance<Promise<CommandResult>, [DataCommand]>;
let hold = false;
const waiting: Array<() => void> = [];
function countCommands() {
  hold = false;
  waiting.splice(0);
  const deliver = stand.laptop.transport.send.bind(stand.laptop.transport);
  sends = jest.spyOn(stand.laptop.transport, 'send').mockImplementation(async command => {
    if (hold) await new Promise<void>(resolve => waiting.push(resolve));
    return deliver(command);
  });
}
const storedNote = async () => (await stand.world.snapshot(noteRef)).value as unknown as { title?: string; content: string; scriptureRefs: Array<Record<string, unknown>> };
const conflictShown = () => (document.body.textContent ?? '').includes('freshness.conflictTitle');

/** Types and leaves the note before the 1.5 s save pause ends: the words stay only in the device's draft. */
async function typeAndLeaveInsidePause(word: string) {
  act(() => insert(word));
  await settle(150);
  stand.leave();
  for (const ms of [0, 1600, 5000, 30000]) await settle(ms);
}

/** Opens the note again, sees «Text from last time» and presses «Restore» (the note stays in reading). */
async function reopenAndRestore() {
  await stand.reopen();
  await settle(5000);
  expect(screen.getByText('unsavedDraft.title')).toBeInTheDocument();
  fireEvent.click(screen.getByText('unsavedDraft.restore'));
  await settle();
}

describe('restoring text left inside the save pause resumes the session it was typed in', () => {
  it('does not silently replace text another device saved since: the save is refused before any command and the version question is shown', async () => {
    await start(); countCommands();
    await typeAndLeaveInsidePause(' Leaveword');
    expect(sends).not.toHaveBeenCalled();
    await phoneSave('Phone version of the note.');

    await reopenAndRestore();
    await finish();

    expect(await stored()).toBe('Phone version of the note.');
    expect(sends).not.toHaveBeenCalled();
    expect(conflictShown()).toBe(true);
    expect(hasInlineQuestion()).toBe(true);
    // The person's words are still on the page for the answer.
    expect(stand.autosave.content).toBe(original + ' Leaveword');
  });

  it('keeps the title another device changed and adds the restored word, with one command and no question', async () => {
    await start(); countCommands();
    await typeAndLeaveInsidePause(' Leaveword');
    await phoneSave(original, { title: 'Phone title' });

    await reopenAndRestore();
    await finish();

    const note = await storedNote();
    expect(note.title).toBe('Phone title');
    expect(note.content).toBe(original + ' Leaveword');
    expect(hasNoteQuestion()).toBe(false);
    expect(sends).toHaveBeenCalledTimes(1);
    expect(stand.autosave.title).toBe('Phone title');
  });

  it('asks nothing about his own save that was still on its way when he typed more and left; both words are stored', async () => {
    await start(); countCommands();
    hold = true;
    act(() => insert(' Firstword'));
    await act(async () => { jest.advanceTimersByTime(1600); for (let i = 0; i < 5000; i++) await Promise.resolve(); });
    // The first save left the device and waits for the server's answer.
    expect(waiting).toHaveLength(1);
    act(() => insert(' Secondword'));
    await act(async () => { jest.advanceTimersByTime(150); });
    stand.leave();
    hold = false; waiting.splice(0).forEach(release => release());
    for (const ms of [0, 1600, 5000, 30000]) await settle(ms);
    expect(await stored()).toBe(original + ' Firstword');

    await reopenAndRestore();
    await finish();

    expect(hasNoteQuestion()).toBe(false);
    expect(await stored()).toBe(original + ' Firstword Secondword');
    expect(sends).toHaveBeenCalledTimes(2);
  });
});

describe('a reference stored before references kept their Bible', () => {
  // "Ps 51:12" saved by an older app: no Bible in the stored data; every screen reads it with one.
  const oldReference = { id: 'old-1', book: 'Psalms', chapter: 51, fromVerse: 12 };
  async function startWithOldReference() {
    await start(); countCommands();
    await phoneSave(original, { scriptureRefs: [oldReference] as never });
    await finish();
    expect(hasNoteQuestion()).toBe(false);
    sends.mockClear();
  }

  it('a restored draft that added a reference is not refused as if the old one had changed elsewhere', async () => {
    await startWithOldReference();
    const input = screen.getByPlaceholderText('studiesWorkspace.quickRefPlaceholder');
    fireEvent.change(input, { target: { value: 'John 3:16' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await settle(150);
    stand.leave();
    for (const ms of [0, 1600, 5000, 30000]) await settle(ms);
    expect(sends).not.toHaveBeenCalled();

    await reopenAndRestore();
    await finish();

    expect(hasNoteQuestion()).toBe(false);
    expect((await storedNote()).scriptureRefs.map(ref => ref.book)).toEqual(['Psalms', 'John']);
    expect(sends).toHaveBeenCalledTimes(1);
  });

  it('a restored draft that did not touch the references leaves them stored as they were', async () => {
    await startWithOldReference();
    await typeAndLeaveInsidePause(' Leaveword');

    await reopenAndRestore();
    await finish();

    expect(hasNoteQuestion()).toBe(false);
    const note = await storedNote();
    expect(note.content).toBe(original + ' Leaveword');
    expect(note.scriptureRefs).toEqual([oldReference]);
    expect(sends).toHaveBeenCalledTimes(1);
  });
});

describe('a draft written by a build that did not keep what it was built from', () => {
  it('is not sent silently: restoring it asks the version question before any command, and «keep my text» sends it once', async () => {
    await start(); countCommands();
    stand.leave();
    // The record exactly as the previous build writes it: the words and their times, nothing about their base.
    const words = { title: 'Original', content: original + ' Olderword', tags: [], scriptureRefs: [], type: 'note' };
    localStorage.setItem(draftKey('owner', 'note-x', 'note', 'older-build-opening'), JSON.stringify({ value: words, savedAt: 1, editedAt: 1 }));

    await reopenAndRestore();
    await finish();

    expect(conflictShown()).toBe(true);
    expect(sends).not.toHaveBeenCalled();
    expect(await stored()).toBe(original);

    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    await finish();

    expect(await stored()).toBe(original + ' Olderword');
    expect(hasNoteQuestion()).toBe(false);
    expect(sends).toHaveBeenCalledTimes(1);
  });
});

describe('a device with no room for the base beside the words', () => {
  it('keeps the words alone, as a copy without its base: offered on return, asked about once, and «keep my text» stores them', async () => {
    // The browser's room for this site: a long note's copy fits in it, the same copy with its base beside it does not.
    const room = 40_000;
    const long = Array.from({ length: 30 }, (_, index) => `Paragraph ${index} ` + 'word '.repeat(150).trim() + '.').join('\n\n');
    const setItem = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, name: string, value: string) {
      const used = Object.keys(this).filter(other => other !== name).reduce((sum, other) => sum + other.length + (this.getItem(other)?.length ?? 0), 0);
      if (used + name.length + value.length > room) throw new DOMException('quota', 'QuotaExceededError');
      return setItem.call(this, name, value);
    });
    await start(long, true); countCommands();
    await typeAndLeaveInsidePause(' Leaveword');
    expect(sends).not.toHaveBeenCalled();

    await reopenAndRestore();
    await finish();

    // Kept without its base, the copy is asked about, as a copy written before copies kept their base.
    expect(conflictShown()).toBe(true);
    expect(sends).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    await finish();

    expect(await stored()).toContain('Leaveword');
    expect(hasNoteQuestion()).toBe(false);
    expect(sends).toHaveBeenCalledTimes(1);
  });
});
