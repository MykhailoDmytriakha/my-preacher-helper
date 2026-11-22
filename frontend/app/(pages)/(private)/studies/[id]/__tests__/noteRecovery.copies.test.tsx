import { act, fireEvent, screen } from '@testing-library/react';

import { draftKey, saveDraft } from '@/utils/durableDraft';
import { stand, start, original, stored, settle, phoneSave, finish, hasNoteQuestion, chooseNotice } from '@test-utils/noteOrdering';

import type { CommandResult, DataCommand } from '@/data-engine/types';

/*
 * The copies «Text from last time» offers. Each is a frozen editing session: the words and the base they were built
 * from. Two physical copies of one session are one choice, and one answer settles both; a copy is restored against
 * the note as stored, whatever was restored before it; a copy that holds nothing beyond its own base is not unsent
 * text and is not offered. The copies were written by an older build; recovery uses the real page and engine.
 */

let sends: jest.SpyInstance<Promise<CommandResult>, [DataCommand]>;
function countCommands() {
  const deliver = stand.laptop.transport.send.bind(stand.laptop.transport);
  sends = jest.spyOn(stand.laptop.transport, 'send').mockImplementation(command => deliver(command));
}
const conflictShown = () => (document.body.textContent ?? '').includes('freshness.conflictTitle');
const offerShown = () => (document.body.textContent ?? '').includes('unsavedDraft.title');
const chooser = () => screen.queryByRole('combobox', { name: 'unsavedDraft.chooseCopy' });
const phoneVersion = 'Phone version of the note.';
const words = (content: string) => ({ title: 'Original', content, tags: [], scriptureRefs: [], type: 'note' as const });
const physicalCopies = ['old-opening', 'old-reopen'].map(writer => draftKey('owner', 'note-x', 'note', writer));

function expectTwoCopiesRemoved() {
  expect(physicalCopies.map(key => localStorage.getItem(key))).toEqual([null, null]);
}

async function leaveAndWait() {
  stand.leave();
  for (const ms of [0, 1600, 5000, 30000]) await settle(ms);
}
async function reopen() {
  await stand.reopen();
  await settle(5000);
}
async function restore() {
  fireEvent.click(screen.getByText('unsavedDraft.restore'));
  await settle();
}
async function confirmDiscardIfAsked() {
  const confirm = screen.queryByRole('button', { name: 'common.discardText.confirm' });
  if (confirm) await act(async () => { fireEvent.click(confirm); });
}

async function openTwoCopiesOfOneSession() {
  await start(); countCommands();
  await leaveAndWait();
  const base = words(original);
  const edit = words(original + ' Leaveword');
  physicalCopies.forEach((key, index) => {
    expect(saveDraft(key, edit, undefined, false, index + 1, base)).toBe(true);
    expect(localStorage.getItem(key)).not.toBeNull();
  });
  await phoneSave(phoneVersion);
  await reopen();

  // Matching words built from the same base are one choice on the page.
  expect(offerShown()).toBe(true);
  expect(chooser()).toBeNull();
  expect(sends).not.toHaveBeenCalled();
}

describe('two physical copies of one editing session', () => {
  it('are one choice, and «take theirs» after restoring settles both: the words are not offered again', async () => {
    await openTwoCopiesOfOneSession();
    await restore();
    await finish();
    expect(conflictShown()).toBe(true);
    await chooseNotice('take');
    expect(await stored()).toBe(phoneVersion);
    expect(hasNoteQuestion()).toBe(false);
    expectTwoCopiesRemoved();

    await leaveAndWait();
    await reopen();
    expect(offerShown()).toBe(false);
    expect(sends).not.toHaveBeenCalled();
  });

  it('are one choice, and «discard» removes both', async () => {
    await openTwoCopiesOfOneSession();
    fireEvent.click(screen.getByText('unsavedDraft.discard'));
    await confirmDiscardIfAsked();
    await settle();
    expect(offerShown()).toBe(false);
    expectTwoCopiesRemoved();

    await leaveAndWait();
    await reopen();
    expect(offerShown()).toBe(false);
    expect(await stored()).toBe(phoneVersion);
    expect(sends).not.toHaveBeenCalled();
  });
});

it('reviews two different legacy copies against the saved note one at a time', async () => {
  await start(); countCommands();
  await phoneSave(phoneVersion);
  await leaveAndWait();
  const first = draftKey('owner', 'note-x', 'note', 'opening-with-base');
  const second = draftKey('owner', 'note-x', 'note', 'older-build-opening');
  expect(saveDraft(first, words(original + ' Baseword'), undefined, false, 2, words(original))).toBe(true);
  expect(saveDraft(second, words(original), undefined, false, 1)).toBe(true);

  await reopen();
  expect(chooser()).toHaveValue(first);
  await restore();
  expect(conflictShown()).toBe(true);
  expect(stand.autosave.content).toBe(original + ' Baseword');
  expect(offerShown()).toBe(true);

  // The older copy cannot replace an unanswered newer comparison. Its stored bytes survive.
  const oldest = localStorage.getItem(second);
  expect(oldest).not.toBeNull();
  await restore();
  expect(screen.getByText('dataSync.failure.decisionRequired')).toBeInTheDocument();
  expect(stand.autosave.content).toBe(original + ' Baseword');
  expect(await stored()).toBe(phoneVersion);
  expect(localStorage.getItem(second)).toBe(oldest);
  expect(sends).not.toHaveBeenCalled();

  await chooseNotice('take');
  expect(await stored()).toBe(phoneVersion);
  expect(stand.autosave.content).toBe(phoneVersion);
  expect(offerShown()).toBe(true);
  await restore();
  await finish();

  // This copy predates stored bases. The engine compares it with the saved phone version.
  expect(conflictShown()).toBe(true);
  expect(await stored()).toBe(phoneVersion);
  expect(sends).not.toHaveBeenCalled();
  expect(stand.autosave.content).toBe(original);

  await chooseNotice('keep');
  expect(await stored()).toBe(original);
  expect({
    question: hasNoteQuestion(), first: localStorage.getItem(first), second: localStorage.getItem(second),
  }).toEqual({ question: false, first: null, second: null });
  expect(sends).toHaveBeenCalledTimes(1);
});

it('a second Restore during the save pause leaves the first import scheduled and the second copy safe', async () => {
  await start(); countCommands();
  await leaveAndWait();
  const opening = words(original);
  const first = draftKey('owner', 'note-x', 'note', 'first-to-save');
  const second = draftKey('owner', 'note-x', 'note', 'older-to-keep');
  const firstWords = words(original + ' Firstcopy');
  const secondWords = { ...opening, title: 'Older copy title' };
  expect(saveDraft(first, firstWords, undefined, false, 2, opening)).toBe(true);
  expect(saveDraft(second, secondWords, undefined, false, 1, opening)).toBe(true);

  await reopen();
  await restore();
  expect(stand.autosave.content).toBe(firstWords.content);
  expect(stand.session?.status?.canSave).toBe(true);
  expect(sends).not.toHaveBeenCalled();
  const oldest = localStorage.getItem(second);
  expect(oldest).not.toBeNull();
  await restore();
  expect(localStorage.getItem(second)).toBe(oldest);
  await finish();

  expect(await stored()).toBe(firstWords.content);
  expect(sends).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(first)).toBeNull();
  expect(localStorage.getItem(second)).toBe(oldest);
});

describe('a copy whose words are its own base', () => {
  it('holds nothing unsent: it is not offered, and the page shows the note as stored', async () => {
    await start(); countCommands();
    await phoneSave(phoneVersion);
    await leaveAndWait();
    // A copy written after its words were handed over and stored by this device: nothing in it is beyond its base.
    const savedWords = { title: 'Original', content: original + ' Savedword', tags: [], scriptureRefs: [], type: 'note' };
    localStorage.setItem(draftKey('owner', 'note-x', 'note', 'opening-after-capture'),
      JSON.stringify({ value: savedWords, savedAt: 1, editedAt: 1, base: savedWords }));

    await reopen();
    await finish();

    expect(offerShown()).toBe(false);
    expect(hasNoteQuestion()).toBe(false);
    expect(stand.autosave.content).toBe(phoneVersion);
    expect(await stored()).toBe(phoneVersion);
    expect(sends).not.toHaveBeenCalled();
  });
});

it('cleans settled copies while a different unsent copy is offered', async () => {
  await start();
  countCommands();
  await phoneSave(phoneVersion);
  await leaveAndWait();
  const unsent = draftKey('owner', 'note-x', 'note', 'unsent-copy');
  const unknown = draftKey('owner', 'note-x', 'note', 'copy-without-base');
  const saved = words(original + ' Confirmedword');
  expect(saveDraft(unsent, words(original + ' Unsentword'), undefined, false, 4, words(original))).toBe(true);
  expect(saveDraft(unknown, words(original + ' Unknownword'), undefined, false, 3)).toBe(true);
  expect(saveDraft(physicalCopies[0], saved, undefined, false, 2, saved)).toBe(true);
  expect(saveDraft(physicalCopies[1], words(original), undefined, false, 1, words(original))).toBe(true);
  const retained = [unsent, unknown].map(key => localStorage.getItem(key));

  await reopen();
  await finish();

  expect(offerShown()).toBe(true);
  expect(chooser()).toHaveValue(unsent);
  expectTwoCopiesRemoved();
  expect([unsent, unknown].map(key => localStorage.getItem(key))).toEqual(retained);
  expect(await stored()).toBe(phoneVersion);
  expect(sends).not.toHaveBeenCalled();
});
