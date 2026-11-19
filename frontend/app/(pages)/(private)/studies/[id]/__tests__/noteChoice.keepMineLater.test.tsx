import { stand, hasGlobalNotice, hasInlineQuestion } from '@test-utils/noteChoiceStand';
import { ChoiceMachine, type ChoiceAction } from '@test-utils/noteChoiceHistory';

/*
 * BUG-20261117-note-kept-decision-sent-later-without-base-check, as the person lives it. The opening is the choice
 * instrument's own walk for seed 12900815 (its steps 0-7, then 19-24): his save is refused at delivery and the engine's
 * notice asks; he keeps his text there, and while that send waits his next typing pause is refused by the page's own
 * check, so the page asks too. Then the tracker's tail: he answers the page's question «keep my text» while the notice
 * waits again, so that save is refused «decision required»; he takes the stored version in the notice; the phone saves
 * twice; he types a word and pauses.
 */
const history: ChoiceAction[] = [
  { kind: 'type', word: 'Firstword' }, { kind: 'holdTransport' }, { kind: 'timer' },
  { kind: 'phoneOther', word: 'Phoneone' }, { kind: 'releaseTransport' }, { kind: 'holdTransport' }, { kind: 'openNotice' },
  { kind: 'type', word: 'Secondword' }, { kind: 'pauseKeep' }, { kind: 'timer' }, { kind: 'resume' },
  { kind: 'phoneOther', word: 'Phonetwo' }, { kind: 'releaseTransport' },
];
const answerTheNoticeThenThePhoneSavesTwice: ChoiceAction[] = [
  { kind: 'openNotice' }, { kind: 'take' }, { kind: 'confirmTake' },
  { kind: 'phoneOther', word: 'Phonethree' }, { kind: 'phoneOther', word: 'Phonefour' },
];

it('a kept answer that could not be saved at once does not later replace versions stored since: the question comes back', async () => {
  const machine = new ChoiceMachine();
  await machine.boot();
  try {
    for (const action of history) await machine.step(action);
    // Both questions are open: the page's own and the engine's notice.
    expect(hasInlineQuestion()).toBe(true);
    expect(hasGlobalNotice()).toBe(true);

    await machine.step({ kind: 'inlineKeep' });
    await machine.step({ kind: 'timer' });
    // The kept text could not be saved: the notice still waits for its answer.
    expect(hasGlobalNotice()).toBe(true);
    expect(document.body.textContent).toContain('common.saveError');

    for (const action of answerTheNoticeThenThePhoneSavesTwice) await machine.step(action);
    const phoneVersion = String(stand.world.server.documents.get('studyNotes/note-x')!.content);
    expect(phoneVersion).toContain('Phonefour');
    const sendsBefore = machine.requests.length;

    await machine.step({ kind: 'type', word: 'Thirdword' });
    await machine.step({ kind: 'timer' });

    expect(String(stand.world.server.documents.get('studyNotes/note-x')!.content)).toBe(phoneVersion);
    expect(hasInlineQuestion()).toBe(true);
    expect(stand.autosave.content).toContain('Secondword Thirdword');
    expect(machine.requests).toHaveLength(sendsBefore);
  } finally {
    machine.close();
  }
}, 60000);
