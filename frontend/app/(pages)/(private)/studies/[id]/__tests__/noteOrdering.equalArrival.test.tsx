import { act, fireEvent, screen } from '@testing-library/react';
import { undoDepth, redoDepth } from '@tiptap/pm/history';
import { writeFileSync } from 'node:fs';

import { noteRef } from '@test-utils/deviceWorld';
import { stand, start, original, md, stored, phoneSave, insert, finish, settle, hasNoteQuestion, chooseNotice } from '@test-utils/noteOrdering';
import { findNoteDraftCopies } from '@/utils/newNoteDrafts';

const records: unknown[] = [];
const observe = process.env.NOTE_ORDERING_OBSERVE === '1';
afterAll(() => {
  if (process.env.NOTE_ORDERING_DIRECTED_OUTPUT) writeFileSync(process.env.NOTE_ORDERING_DIRECTED_OUTPUT, JSON.stringify(records, null, 2));
});
async function snapshot(event: string, sends: jest.SpyInstance) {
  return { event, page: stand.autosave.content, editor: md(), stored: await stored(),
    base: stand.autosave.baselineRef.current, confirmed: stand.confirmed,
    saved: Boolean(screen.queryByText('common.saved')), question: hasNoteQuestion(), blocked: stand.autosave.saveBlocked,
    copies: findNoteDraftCopies('owner', 'note-x', 'note').map(copy => copy.value), sends: sends.mock.calls.length };
}
it.each([false, true])('equal K, silence (offline=%s), K2, then typing converges without resending K', async offline => {
  await start();
  const sends = jest.spyOn(stand.laptop.transport, 'send');
  act(() => insert(' Kword'));
  const k = md();
  // The laptop receives confirmation from the phone before the local timer fires.
  await settle(300);
  await phoneSave(k);
  if (offline) stand.laptop.goOffline();
  await finish();
  const silence = await snapshot('silence', sends);
  if (!observe) {
    expect(silence).toMatchObject({ page: k, editor: k, stored: k, saved: true, question: false, blocked: false, copies: [], sends: 0 });
    expect(silence.base?.content).toBe(k);
    expect(silence.confirmed?.content).toBe(k);
  }
  if (offline) {
    stand.laptop.online = true;
    await act(async () => { stand.laptop.run(() => stand.laptop.engine.setOnline(true)); });
    await finish();
  }
  await phoneSave(k + ' K2word'); await finish();
  const k2 = await snapshot('K2', sends);
  if (!observe) expect(k2).toMatchObject({ page: k + ' K2word', editor: k + ' K2word', saved: true, question: false, sends: 0 });
  act(() => insert(' Laterword')); await finish();
  const typed = await snapshot('later typing', sends);
  records.push({ history: offline ? 'b' : 'a', silence, k2, typed });
  if (!observe) expect(typed).toMatchObject({ page: k + ' K2word Laterword', editor: k + ' K2word Laterword', stored: k + ' K2word Laterword', saved: true, question: false, copies: [], sends: 1 });
});
it('confirms equal content beside a local title edit, then sends only the title', async () => {
  await start();
  const sends = jest.spyOn(stand.laptop.transport, 'send');
  act(() => insert(' Kword'));
  fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder'), { target: { value: 'Local title' } });
  const k = md();
  await phoneSave(k);
  const arrival = await snapshot('equal arrival beside local title', sends);
  await finish();
  const final = await snapshot('title settled', sends);
  records.push({ history: 'c', arrival, final, row: (await stand.world.snapshot(noteRef)).value });
  if (!observe) {
    expect(arrival.confirmed).toMatchObject({ content: k, title: 'Original' });
    expect(arrival.base).toMatchObject({ content: k, title: 'Original' });
    expect(arrival.sends).toBe(0);
    expect(final).toMatchObject({ page: k, editor: k, stored: k, saved: true, question: false, copies: [], sends: 1 });
    expect((await stand.world.snapshot(noteRef)).value!.title).toBe('Local title');
    const command = sends.mock.calls[0][0];
    expect(command.kind).toBe('update');
    if (command.kind === 'update') expect(command.changes.some(change => change.path[0] === 'content')).toBe(false);
  }
});
it('retains an existing refused write for review when the other device stores equal text', async () => {
  await start();
  const sends = jest.spyOn(stand.laptop.transport, 'send');
  act(() => insert(' Kword'));
  const k = md();
  await phoneSave(original + ' Otherword'); await finish();
  expect(hasNoteQuestion()).toBe(true);
  const before = sends.mock.calls.length;
  await phoneSave(k); await finish();
  const equal = await snapshot('equal row while question shown', sends);
  records.push({ history: 'd', equal });
  if (!observe) {
    expect(equal).toMatchObject({ page: k, editor: k, stored: k, question: true, blocked: true, sends: before });
    expect(equal.base?.content).toBe(k);
    expect(equal.confirmed?.content).toBe(original);
  }
  await chooseNotice('keep');
  expect(hasNoteQuestion()).toBe(false);
  expect(md()).toBe(k);
  expect(await stored()).toBe(k);
});
const metadata = {
  title: { title: 'Remote title' }, tags: { tags: ['remote'] }, type: { type: 'question' as const },
  scriptureRefs: { scriptureRefs: [{ id: 'remote-ref', bible: 'kjv' as const, book: 'John', chapter: 3, fromVerse: 16, toVerse: 16 }] },
  dictationSourceIds: { dictationSourceIds: ['remote-source'] },
};
it.each(Object.entries(metadata).flatMap(([field, fields]) => [
  { field, fields, history: 'Undo' }, { field, fields, history: 'Redo' },
]))('retains content $history across a $field-only arrival', async ({ fields, history }) => {
  await start();
  act(() => insert(' Typedword')); await finish();
  if (history === 'Redo') {
    act(() => { expect(stand.editor.commands.undo()).toBe(true); });
    await finish();
  }
  const depth = history === 'Undo' ? undoDepth : redoDepth;
  expect(depth(stand.editor.state)).toBe(1);
  await phoneSave(md(), fields); await finish();
  expect(depth(stand.editor.state)).toBe(1);
  act(() => { expect(history === 'Undo' ? stand.editor.commands.undo() : stand.editor.commands.redo()).toBe(true); });
  expect(md().includes('Typedword')).toBe(history === 'Redo');
});
