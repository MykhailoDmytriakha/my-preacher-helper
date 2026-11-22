import { act, fireEvent, within } from '@testing-library/react';
import { runHistory, stand, insert, finish, md, stored, phoneSave, original, chooseNotice,
  hasInlineQuestion, hasNoteQuestion, settle, pulse } from '@test-utils/noteOrdering';

async function refused() {
  await runHistory([{ kind: 'type', word: 'Typed' }, { kind: 'timer' }, { kind: 'arriveSame', word: 'Phone' }],
    'settled-choice', { keepMounted: true });
  return md();
}

it.each([false, true])('the Keep button preserves text until the replacement is acknowledged (typing=%s)', async typing => {
  const local = await refused();
  const remote = await stored();
  const transport = stand.laptop.transport;
  const sends = jest.mocked(transport.send);
  const sendsBefore = sends.mock.calls.length;
  const deliver = transport.send.bind(transport);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const shown: string[] = [];
  const observe = () => { shown.push(md()); };
  stand.editor.on('transaction', observe);
  sends.mockImplementationOnce(async command => {
    await gate;
    return deliver(command);
  });
  try {
    const workspace = within(document.querySelector<HTMLElement>('[data-note-workspace]')!);
    fireEvent.click(workspace.getByRole('button', { name: 'dataSync.useLocalVersion' }));
    await settle();
    await act(async () => { await pulse(1600); });
    expect(sends).toHaveBeenCalledTimes(sendsBefore + 1);
    expect(md()).toBe(local);
    expect(stand.autosave.content).toBe(local);
    expect(await stored()).toBe(remote);
    if (typing) {
      act(() => insert(' Newergapword'));
      await act(async () => { await pulse(1600); });
      expect(md()).toBe(local + ' Newergapword');
      expect(await stored()).toBe(remote);
    }
  } finally {
    release();
    await finish();
    stand.editor.off('transaction', observe);
  }
  const expected = local + (typing ? ' Newergapword' : '');
  expect(md()).toBe(expected);
  expect(stand.autosave.content).toBe(expected);
  expect(await stored()).toBe(expected);
  expect(shown.every(value => value === local || value === expected)).toBe(true);
  expect(hasNoteQuestion()).toBe(false);
  act(() => insert(' Nextword'));
  await finish();
  expect(md()).toBe(expected + ' Nextword');
  expect(await stored()).toBe(md());
  expect(hasNoteQuestion()).toBe(false);
}, 60000);

it.each([false, true])('the live session keeps text before capturing the replacement (typing=%s)', async typing => {
  const local = await refused();
  const remote = await stored();
  const sends = jest.mocked(stand.laptop.transport.send);
  const sendsBefore = sends.mock.calls.length;
  const session = stand.session!;
  const compared = session.state!.checkpoint;
  await act(async () => { await session.keepLocal(compared); });
  await settle();
  expect(md()).toBe(local);
  expect(stand.autosave.content).toBe(local);
  expect(await stored()).toBe(remote);
  expect(sends).toHaveBeenCalledTimes(sendsBefore);

  if (typing) {
    act(() => insert(' Newergapword'));
    await settle();
    expect(md()).toBe(local + ' Newergapword');
    expect(await stored()).toBe(remote);
  }
  await finish();
  const expected = local + (typing ? ' Newergapword' : '');
  expect(md()).toBe(expected);
  expect(sends).toHaveBeenCalledTimes(sendsBefore + 1);
  if (typing) {
    expect(await stored()).toBe(remote);
    expect(hasInlineQuestion()).toBe(true);
    await chooseNotice('keep');
  }
  expect(md()).toBe(expected);
  expect(await stored()).toBe(expected);
  expect(hasNoteQuestion()).toBe(false);
}, 60000);

it('take other adopts a version equal to the old confirmation and saves the next edit', async () => {
  await refused();
  await phoneSave(original);
  await finish();
  expect(stand.confirmed?.content).toBe(original);
  await chooseNotice('take');
  expect(md()).toBe(original);
  expect(stand.autosave.content).toBe(original);
  expect(stand.autosave.baselineRef.current?.content).toBe(original);
  expect(hasNoteQuestion()).toBe(false);
  act(() => insert(' Nextword'));
  await finish();
  expect(md()).toBe(original + ' Nextword');
  expect(await stored()).toBe(md());
  expect(hasNoteQuestion()).toBe(false);
}, 60000);
