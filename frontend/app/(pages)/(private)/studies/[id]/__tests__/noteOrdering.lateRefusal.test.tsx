import { appendFileSync } from 'node:fs';
import { act, fireEvent, within } from '@testing-library/react';
import { runHistory, stand, insert, finish, md, stored, hasNoteQuestion, hasInlineQuestion,
  hasGlobalNotice, chooseNotice, reloadPage, start, pulse, original, type OrderingEvent } from '@test-utils/noteOrdering';

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
function expectConfirmed(content: string) {
  expect(stand.autosave.content).toBe(content);
  expect(md()).toBe(content);
  expect(stand.autosave.baselineRef.current?.content).toBe(content);
  expect(stand.confirmed?.content).toBe(content);
  expect(hasNoteQuestion()).toBe(false);
}

it.each(histories.flatMap(history => choices.map(choice => ({ ...history, choice }))))(
  '$name: late refusal, $choice, then the next edit saves without a question', async ({ name, events, choice }) => {
    const row = await runHistory(events, `${name}:${choice}`, { keepMounted: true });
    expect(row.requests.some(request => request.response?.kind === 'conflict' && request.refused! > request.issued)).toBe(true);
    expect(hasGlobalNotice()).toBe(true);
    expect(hasInlineQuestion()).toBe(false);
    const chosen = choice === 'keep' ? md() : String(await stored());
    const before = jest.mocked(stand.laptop.transport.send).mock.calls.length;
    await chooseNotice(choice);
    if (process.env.NOTE_ORDERING_DECISIONS_OUTPUT) appendFileSync(process.env.NOTE_ORDERING_DECISIONS_OUTPUT, JSON.stringify({
      name, choice, chosen, page: stand.autosave.content, editor: md(), confirmed: stand.confirmed,
      stored: await stored(), before, requests: jest.mocked(stand.laptop.transport.send).mock.calls,
    }) + '\n');
    expect(await stored()).toBe(chosen);
    expectConfirmed(chosen);
    const choiceSends = jest.mocked(stand.laptop.transport.send).mock.calls.length;
    act(() => insert(' Nextword'));
    await finish();
    expect(await stored()).toBe(chosen + ' Nextword');
    expectConfirmed(chosen + ' Nextword');
    expect(jest.mocked(stand.laptop.transport.send)).toHaveBeenCalledTimes(choiceSends + 1);
    // A choice must not introduce a metadata normalization write either.
    expect(choiceSends).toBe(before + Number(choice === 'keep'));
  }, 60000);

it.each(choices)('Q3: newer words survive %s and get their own saving decision', async choice => {
  await runHistory(histories[0].events, `Q3:${choice}`, { keepMounted: true });
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
    const workspace = within(document.querySelector('[data-note-workspace]') as HTMLElement);
    fireEvent.click(workspace.getByRole('button', { name: 'freshness.conflictKeepMine' }));
    await finish();
    expect(await stored()).toBe(newer);
    expectConfirmed(newer);
  }
  expect(newer).toBe(submitted + ' Pendingword');
  act(() => insert(' Nextword'));
  await finish();
  expect(await stored()).toBe(newer + ' Nextword');
  expectConfirmed(newer + ' Nextword');
}, 60000);

it.each(choices)('reload after late refusal: %s and the next edit complete', async choice => {
  await runHistory(histories[0].events, `reload:${choice}`, { keepMounted: true });
  const chosen = choice === 'keep' ? md() : String(await stored());
  const oldEngine = stand.laptop.engine;
  await reloadPage();
  expect(stand.laptop.engine).not.toBe(oldEngine);
  expect(hasGlobalNotice()).toBe(true);
  await chooseNotice(choice);
  expect(await stored()).toBe(chosen);
  expectConfirmed(chosen);
  act(() => insert(' Nextword'));
  await finish();
  expect(await stored()).toBe(chosen + ' Nextword');
  expectConfirmed(chosen + ' Nextword');
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
  await act(async () => { await pulse(1600); await pulse(30000); });
  expect(md()).toBe(original + ' Submittedword');
  expect(stand.autosave.content).toBe(md());
  expect(await stored()).toBe(original);
  expect(hasNoteQuestion()).toBe(false);
  expect(stand.laptop.engine.getPending()).toHaveLength(1);
  expect(stand.confirmed?.content).toBe(original);
  if (offline) await act(async () => { stand.laptop.online = true; stand.laptop.run(() => stand.laptop.engine.setOnline(true)); await pulse(); });
  expect(waiting).toHaveLength(1);
  waiting.splice(0).forEach(release => release());
  await finish();
  expectConfirmed(original + ' Submittedword');
  expect(await stored()).toBe(md());
  expect(sends).toHaveBeenCalledTimes(1);
}, 60000);
