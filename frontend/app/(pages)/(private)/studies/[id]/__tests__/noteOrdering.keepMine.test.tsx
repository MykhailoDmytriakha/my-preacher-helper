import { act, fireEvent, screen, within } from '@testing-library/react';

import { stand, start, original, stored, settle, phoneSave, insert, finish, hasNoteQuestion, hasInlineQuestion } from '@test-utils/noteOrdering';

import type { CommandResult, DataCommand } from '@/data-engine/types';

/*
 * «Keep my text» in the note's own version question is a decision about the version the question was about: that
 * version becomes what the person's text is built from, and the text goes at once through the note's ordinary save.
 * The existing check then replaces exactly that version, and asks again about a version stored after it. Every history
 * here is driven by the person's actions on the real page with the real engine; the stand counts this device's commands.
 */

let sends: jest.SpyInstance<Promise<CommandResult>, [DataCommand]>;
function countCommands() {
  const deliver = stand.laptop.transport.send.bind(stand.laptop.transport);
  sends = jest.spyOn(stand.laptop.transport, 'send').mockImplementation(command => deliver(command));
}
const mine = original + ' Myword';
const shownVersion = original + ' Phoneword';

/** He types; the phone stores another text before his typing pause ends; his save is refused and the question shown. */
async function askedAboutThePhoneVersion() {
  await start(); countCommands();
  act(() => insert(' Myword'));
  await phoneSave(shownVersion);
  await finish();
  expect(hasInlineQuestion()).toBe(true);
  expect(await stored()).toBe(shownVersion);
  expect(sends).not.toHaveBeenCalled();
}

function keepMyText() {
  const workspace = within(document.querySelector('[data-note-workspace]') as HTMLElement);
  fireEvent.click(workspace.getByRole('button', { name: 'freshness.conflictKeepMine' }));
}

describe('«keep my text» replaces the version the question was about', () => {
  it('a page that goes away right after the answer leaves a copy that restores without asking again', async () => {
    await askedAboutThePhoneVersion();
    keepMyText();
    stand.leave();
    for (const ms of [0, 1600, 5000, 30000]) await settle(ms);
    // Nothing left the device before the page went away: the decision travels in the copy.
    expect(await stored()).toBe(shownVersion);
    expect(sends).not.toHaveBeenCalled();

    await stand.reopen();
    await settle(5000);
    expect(screen.getByText('unsavedDraft.title')).toBeInTheDocument();
    fireEvent.click(screen.getByText('unsavedDraft.restore'));
    await finish();

    expect(hasNoteQuestion()).toBe(false);
    expect(await stored()).toBe(mine);
    expect(sends).toHaveBeenCalledTimes(1);
  });

  it('a version stored after the answer, before the save is captured, is not replaced silently: the question comes back', async () => {
    await askedAboutThePhoneVersion();
    keepMyText();
    // Before the kept text is captured, another version is stored and reaches this device.
    await phoneSave(original + ' Thirdword');
    await finish();

    expect(await stored()).toBe(original + ' Thirdword');
    expect(hasInlineQuestion()).toBe(true);
    expect(sends).not.toHaveBeenCalled();
    expect(stand.autosave.content).toBe(mine);

    // Answered again, about the version now in question: his text replaces it, once.
    keepMyText();
    await finish();
    expect(await stored()).toBe(mine);
    expect(hasNoteQuestion()).toBe(false);
    expect(sends).toHaveBeenCalledTimes(1);
  });

  it('the answer stores his text at once, without the typing pause, with one command and no further question', async () => {
    await askedAboutThePhoneVersion();
    keepMyText();
    await settle(100);
    expect(await stored()).toBe(mine);
    expect(sends).toHaveBeenCalledTimes(1);

    await finish();
    expect(hasNoteQuestion()).toBe(false);
    expect(sends).toHaveBeenCalledTimes(1);
    expect(stand.autosave.content).toBe(mine);
    expect(stand.confirmed?.content).toBe(mine);
  });
});
