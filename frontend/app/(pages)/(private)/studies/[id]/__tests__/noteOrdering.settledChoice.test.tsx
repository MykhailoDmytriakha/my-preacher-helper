import { act, fireEvent, screen } from '@testing-library/react';
import { noteRef } from '@test-utils/deviceWorld';
import { runHistory, stand, insert, finish, md, stored, phoneSave, original, openNotice, chooseNotice,
  hasInlineQuestion, hasNoteQuestion } from '@test-utils/noteOrdering';

async function refused() {
  await runHistory([{ kind: 'type', word: 'Typed' }, { kind: 'timer' }, { kind: 'arriveSame', word: 'Phone' }],
    'settled-choice', { keepMounted: true });
  return md();
}

// Stretch the real keepLocal -> save boundary, without fabricating delivery or row state.
it.each([false, true])('actual keep button preserves text before replacement capture (gap typing=%s)', async typing => {
  const local = await refused();
  const sendsBefore = jest.mocked(stand.laptop.transport.send).mock.calls.length;
  const shown: string[] = [];
  const observe = () => { shown.push(md()); };
  stand.editor.on('transaction', observe);
  const engine = stand.laptop.engine;
  const open = engine.openEditor.bind(engine);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered = false;
  jest.spyOn(engine, 'openEditor').mockImplementation(async (...args) => {
    const editor = await open(...args);
    const save = editor.save.bind(editor);
    editor.save = async () => { entered = true; await gate; return save(); };
    return editor;
  });
  await openNotice();
  fireEvent.click(screen.getByRole('button', { name: 'freshness.conflictKeepMine' }));
  await finish();
  expect(entered).toBe(true);
  try {
    expect(md()).toBe(local);
    expect(stand.autosave.content).toBe(local);
    if (typing) {
      act(() => insert(' Newergapword'));
      await finish();
      expect(md()).toBe(local + ' Newergapword');
      expect(await stored()).not.toContain('Newergapword');
      expect(stand.laptop.transport.send).toHaveBeenCalledTimes(sendsBefore);
    }
  } finally {
    await act(async () => { release(); });
    await finish();
  }
  expect(md()).toBe(local + (typing ? ' Newergapword' : ''));
  expect(stand.autosave.content).toBe(md());
  expect(await stored()).toBe(local);
  expect(stand.laptop.transport.send).toHaveBeenCalledTimes(sendsBefore + 1);
  expect(shown.every(value => value === local || (typing && value === local + ' Newergapword'))).toBe(true);
  stand.editor.off('transaction', observe);
  if (typing) expect(hasInlineQuestion()).toBe(true);
  else {
    expect(stand.confirmed?.content).toBe(local);
    expect(hasNoteQuestion()).toBe(false);
  }
}, 60000);

it.each([false, true])('direct keepLocal then save preserves text in the two-step boundary (gap typing=%s)', async typing => {
  const local = await refused();
  const sendsBefore = jest.mocked(stand.laptop.transport.send).mock.calls.length;
  const shown: string[] = [];
  const observe = () => { shown.push(md()); };
  stand.editor.on('transaction', observe);
  const [recovery] = await stand.laptop.engine.listRecoverable();
  const editor = await stand.laptop.run(() => stand.laptop.engine.openEditor(noteRef, recovery.record.editorId));
  try {
    await act(async () => { await editor.keepLocal(); });
    await finish();
    expect(md()).toBe(local);
    expect(stand.autosave.content).toBe(local);
    if (typing) {
      act(() => insert(' Newergapword'));
      await finish();
      expect(md()).toBe(local + ' Newergapword');
      expect(await stored()).not.toContain('Newergapword');
      expect(stand.laptop.transport.send).toHaveBeenCalledTimes(sendsBefore);
    }
    await act(async () => { await editor.save(); });
    await finish();
    expect(md()).toBe(local + (typing ? ' Newergapword' : ''));
    expect(await stored()).toBe(local);
    expect(stand.laptop.transport.send).toHaveBeenCalledTimes(sendsBefore + 1);
    expect(shown.every(value => value === local || (typing && value === local + ' Newergapword'))).toBe(true);
    stand.editor.off('transaction', observe);
    if (typing) expect(hasInlineQuestion()).toBe(true);
  } finally { editor.close({ flush: false }); }
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
