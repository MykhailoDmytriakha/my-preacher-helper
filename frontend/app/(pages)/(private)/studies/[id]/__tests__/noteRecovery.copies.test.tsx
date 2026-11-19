import { act, fireEvent, screen } from '@testing-library/react';

import { draftKey } from '@/utils/durableDraft';
import { stand, start, original, stored, settle, phoneSave, insert, finish, hasNoteQuestion } from '@test-utils/noteOrdering';

import type { CommandResult, DataCommand } from '@/data-engine/types';

/*
 * The copies «Text from last time» offers. Each is a frozen editing session: the words and the base they were built
 * from. Two physical copies of one session are one choice, and one answer settles both; a copy is restored against
 * the note as stored, whatever was restored before it; a copy that holds nothing beyond its own base is not unsent
 * text and is not offered. Every history here is driven by the person's actions on the real page with the real engine.
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

/** A word left inside the save pause; the phone then replaces the text; «Restore» asks; he leaves without answering. */
async function askedAndLeftUnanswered() {
  await start(); countCommands();
  act(() => insert(' Leaveword'));
  await settle(150);
  await leaveAndWait();
  await phoneSave(phoneVersion);
  await reopen();
  await restore();
  await finish();
  expect(conflictShown()).toBe(true);
  expect(sends).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(150); });
  await leaveAndWait();
  await reopen();
  // The same words built from the same base, now kept by two openings: one choice.
  expect(offerShown()).toBe(true);
  expect(chooser()).toBeNull();
}

describe('two physical copies of one editing session', () => {
  it('are one choice, and «take theirs» after restoring settles both: the words are not offered again', async () => {
    await askedAndLeftUnanswered();
    await restore();
    await finish();
    expect(conflictShown()).toBe(true);
    fireEvent.click(screen.getByText('freshness.conflictTakeTheirs'));
    await confirmDiscardIfAsked();
    await finish();
    expect(await stored()).toBe(phoneVersion);
    expect(hasNoteQuestion()).toBe(false);

    await leaveAndWait();
    await reopen();
    expect(offerShown()).toBe(false);
    expect(sends).not.toHaveBeenCalled();
  });

  it('are one choice, and «discard» removes both', async () => {
    await askedAndLeftUnanswered();
    fireEvent.click(screen.getByText('unsavedDraft.discard'));
    await confirmDiscardIfAsked();
    await settle();
    expect(offerShown()).toBe(false);

    await leaveAndWait();
    await reopen();
    expect(offerShown()).toBe(false);
    expect(await stored()).toBe(phoneVersion);
    expect(sends).not.toHaveBeenCalled();
  });
});

describe('a copy written before copies kept their base, restored after another copy in the same opening', () => {
  it('is restored against the note as stored, not against the base of the copy restored before it: what it changes is asked about', async () => {
    await start(); countCommands();
    await phoneSave(phoneVersion);
    await leaveAndWait();
    // Two copies from earlier openings: a newer one with its base, and an older one without (an older build wrote it).
    const words = (content: string) => ({ title: 'Original', content, tags: [], scriptureRefs: [], type: 'note' });
    localStorage.setItem(draftKey('owner', 'note-x', 'note', 'opening-with-base'),
      JSON.stringify({ value: words(original + ' Baseword'), savedAt: 2, editedAt: 2, base: words(original) }));
    localStorage.setItem(draftKey('owner', 'note-x', 'note', 'older-build-opening'),
      JSON.stringify({ value: words(original), savedAt: 1, editedAt: 1 }));

    await reopen();
    await restore();
    // Inside the typing pause he restores the other copy too: the older text, which the phone has since replaced.
    await settle(300);
    expect(offerShown()).toBe(true);
    await restore();
    await finish();

    // It changes the text the phone stored, from an unknown base: that is asked, nothing is sent.
    expect(conflictShown()).toBe(true);
    expect(await stored()).toBe(phoneVersion);
    expect(sends).not.toHaveBeenCalled();
    expect(stand.autosave.content).toBe(original);
  });
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
