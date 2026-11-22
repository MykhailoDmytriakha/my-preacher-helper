import { appendFileSync } from 'node:fs';
import { act, fireEvent, within } from '@testing-library/react';
import { noteRef } from '@test-utils/deviceWorld';
import { runHistory, stand, insert, finish, md, stored, hasNoteQuestion, hasInlineQuestion,
  hasGlobalNotice, chooseNotice, reloadPage, start, settle, pulse, original, type OrderingEvent } from '@test-utils/noteOrdering';

// Exact T/A/B/Q1/Q2 schedules from research/116; transport stays held until the
// competing write is known, so these exercise a late refusal, not preflight.
const histories: { name: string; events: OrderingEvent[] }[] = [
  { name: 'T', events: [{ kind: 'type', word: 'Typed' }, { kind: 'timer' }, { kind: 'arriveSame', word: 'Phone' }] },
  { name: 'A', events: [{ kind: 'type', word: 'Local0' }, { kind: 'doneEdit' }, { kind: 'typeDictate', word: 'Local3' }, { kind: 'arriveSame', word: 'Phone4' }, { kind: 'doneEdit' }] },
  { name: 'B', events: [{ kind: 'arriveLive' }, { kind: 'typeDictate', word: 'Local2' }, { kind: 'doneEdit' }, { kind: 'arriveOther', word: 'Phone4' }] },
  { name: 'Q1', events: [{ kind: 'offline' }, { kind: 'type', word: 'Queued' }, { kind: 'timer' }, { kind: 'arriveSame', word: 'Phone' }, { kind: 'online' }] },
  { name: 'Q2', events: [{ kind: 'offline' }, { kind: 'dictate', word: 'Voice' }, { kind: 'timer' }, { kind: 'arriveSame', word: 'Phone' }, { kind: 'online' }] },
];
const choices = ['keep', 'take'] as const;
const firstA = original + ' Local0';
const laterA = {
  content: firstA + ' Local3K\n\nLocal3D',
  recordingSourceIds: ['source-Local3D'],
  dictationSourceIds: ['source-Local3D'],
};

async function restoreLaterA() {
  // The first choice answers the submitted text. Its already captured successor has its own copy.
  const sources = await stand.session!.listRecoverable();
  expect(sources).toHaveLength(1);
  expect(sources[0].record.checkpoint.draft).toMatchObject(laterA);
  const workspace = within(document.querySelector<HTMLElement>('[data-note-workspace]')!);
  fireEvent.change(workspace.getByRole('combobox'), { target: { value: sources[0].id } });
  fireEvent.click(workspace.getByRole('button', { name: 'dataSync.recover' }));
  await finish();
  expect(md()).toBe(laterA.content);
  if (hasNoteQuestion()) await chooseNotice('keep');
  expect((await stand.world.snapshot(noteRef)).value).toMatchObject(laterA);
  expect(await stand.session!.listRecoverable()).toEqual([]);
  expectConfirmed(laterA.content);
}
function expectChosen(content: string) {
  expect(stand.autosave.content).toBe(content);
  expect(md()).toBe(content);
  expect(stand.autosave.baselineRef.current?.content).toBe(content);
  expect(hasNoteQuestion()).toBe(false);
}
function expectConfirmed(content: string) {
  expectChosen(content);
  expect(stand.confirmed?.content).toBe(content);
}

it.each(histories.flatMap(history => choices.map(choice => ({ ...history, choice }))))(
  '$name: late refusal, $choice, then the next edit saves without a question', async ({ name, events, choice }) => {
    const row = await runHistory(events, `${name}:${choice}`, { keepMounted: true });
    expect(row.requests.some(request => request.response?.kind === 'conflict' && request.refused! > request.issued)).toBe(true);
    expect(hasInlineQuestion()).toBe(true);
    expect(hasGlobalNotice()).toBe(false);
    const beforeChoice = md();
    if (name === 'A') expect(beforeChoice).toBe(laterA.content);
    const chosen = choice === 'keep' ? (name === 'A' ? firstA : beforeChoice) : String(await stored());
    const shown: string[] = [];
    const observe = () => { shown.push(md()); };
    stand.editor.on('transaction', observe);
    const before = jest.mocked(stand.laptop.transport.send).mock.calls.length;
    await chooseNotice(choice);
    if (process.env.NOTE_ORDERING_DECISIONS_OUTPUT) appendFileSync(process.env.NOTE_ORDERING_DECISIONS_OUTPUT, JSON.stringify({
      name, choice, chosen, page: stand.autosave.content, editor: md(), confirmed: stand.confirmed,
      stored: await stored(), before, requests: jest.mocked(stand.laptop.transport.send).mock.calls,
    }) + '\n');
    expect(await stored()).toBe(chosen);
    expectChosen(chosen);
    if (choice === 'take') expect(stand.confirmed?.content).toBe(chosen);
    if (choice === 'keep') expect(shown.every(value => value === beforeChoice || value === chosen)).toBe(true);
    stand.editor.off('transaction', observe);
    const choiceSends = jest.mocked(stand.laptop.transport.send).mock.calls.length;
    const receipts = row.final.pageValues.recordingSourceIds?.filter(
      id => !row.final.storedValues.recordingSourceIds?.includes(id),
    ) ?? [];
    if (choice === 'take' && name !== 'A' && receipts.length) {
      // Taking the saved text keeps the recording itself, independently of its transcript.
      expect(choiceSends).toBe(before + 1);
      expect(jest.mocked(stand.laptop.transport.send).mock.calls[before][0]).toMatchObject({
        kind: 'update', changes: [{
          path: ['recordingSourceIds'],
          after: { exists: true, value: [...(row.final.storedValues.recordingSourceIds ?? []), ...receipts] },
        }],
      });
    } else {
      expect(choiceSends).toBe(before + Number(choice === 'keep'));
    }
    if (name === 'A') await restoreLaterA();
    const textAfterChoice = md();
    const writesAfterChoice = jest.mocked(stand.laptop.transport.send).mock.calls.length;
    act(() => insert(' Nextword'));
    await finish();
    expect(await stored()).toBe(textAfterChoice + ' Nextword');
    expectConfirmed(textAfterChoice + ' Nextword');
    expect(jest.mocked(stand.laptop.transport.send)).toHaveBeenCalledTimes(writesAfterChoice + 1);
  }, 60000);

it.each(choices.flatMap(choice => [false, true].map(reload => ({ choice, reload }))))(
  'Q3: newer words survive $choice and get their own saving decision (reload=$reload)', async ({ choice, reload }) => {
  await runHistory(histories[0].events, `Q3:${choice}`, { keepMounted: true });
  if (reload) await reloadPage();
  const submitted = md();
  act(() => insert(' Pendingword'));
  await finish();
  const newer = md();
  const remote = String(await stored());
  await chooseNotice(choice);
  expect(md()).toBe(newer);
  expect(stand.autosave.content).toBe(newer);
  if (choice === 'keep') {
    expect(await stored()).toBe(newer);
    expectConfirmed(newer);
  } else {
    expect(await stored()).toBe(remote);
    expect(hasGlobalNotice()).toBe(false);
    expect(hasInlineQuestion()).toBe(true);
    expect(md()).toContain('Pendingword');
    // The new words were outside the engine's chosen, submitted payload. Their
    // existing inline choice can save them; answering it does not resurrect G.
    await chooseNotice('keep');
    expect(await stored()).toBe(newer);
    expectConfirmed(newer);
  }
  expect(newer).toBe(submitted + ' Pendingword');
  act(() => insert(' Nextword'));
  await finish();
  expect(await stored()).toBe(newer + ' Nextword');
  expectConfirmed(newer + ' Nextword');
}, 60000);

it.each(histories.flatMap(history => choices.map(choice => ({ ...history, choice }))))(
  '$name reload after late refusal: $choice follows the existing recovery path', async ({ name, events, choice }) => {
  await runHistory(events, `reload:${name}:${choice}`, { keepMounted: true });
  if (name === 'A') expect(md()).toBe(laterA.content);
  const chosen = choice === 'keep' ? (name === 'A' ? firstA : md()) : String(await stored());
  const oldEngine = stand.laptop.engine;
  await reloadPage();
  expect(stand.laptop.engine).not.toBe(oldEngine);
  expect(hasInlineQuestion()).toBe(true);
  expect(hasGlobalNotice()).toBe(false);
  await chooseNotice(choice);
  expect(await stored()).toBe(chosen);
  expectChosen(chosen);
  if (choice === 'take') expect(stand.confirmed?.content).toBe(chosen);
  if (name === 'A') await restoreLaterA();
  const textAfterChoice = md();
  act(() => insert(' Nextword'));
  await finish();
  expect(await stored()).toBe(textAfterChoice + ' Nextword');
  expectConfirmed(textAfterChoice + ' Nextword');
}, 60000);

it.each([false, true])('ordinary pending save (offline=%s) protects submitted text from the old row', async offline => {
  await start();
  const waiting: (() => void)[] = [];
  const deliver = stand.laptop.transport.send.bind(stand.laptop.transport);
  const sends = jest.spyOn(stand.laptop.transport, 'send').mockImplementation(async command => {
    await new Promise<void>(resolve => waiting.push(resolve));
    return deliver(command);
  });
  if (offline) stand.laptop.goOffline();
  act(() => insert(' Submittedword'));
  await settle();
  await act(async () => { await pulse(1600); });
  expect(md()).toBe(original + ' Submittedword');
  expect(stand.autosave.content).toBe(md());
  expect(await stored()).toBe(original);
  expect(hasNoteQuestion()).toBe(false);
  expect(stand.laptop.engine.getPending()).toHaveLength(1);
  expect(stand.confirmed?.content).toBe(original);
  if (offline) await act(async () => {
    stand.laptop.online = true;
    stand.laptop.run(() => stand.laptop.engine.setOnline(true));
    await pulse();
  });
  expect(waiting).toHaveLength(1);
  waiting.splice(0).forEach(release => release());
  await finish();
  expectConfirmed(original + ' Submittedword');
  expect(await stored()).toBe(md());
  expect(sends).toHaveBeenCalledTimes(1);
}, 60000);
