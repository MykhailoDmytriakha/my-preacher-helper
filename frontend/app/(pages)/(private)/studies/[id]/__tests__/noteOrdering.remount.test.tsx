import { finish, hasNoteQuestion, insert, md, original, phoneSave, settle, stand, start, stored } from '@test-utils/noteOrdering';

import { act, fireEvent, screen } from '@testing-library/react';

import { actionClock } from '@/data-engine/actionClock.client';
import { diffFields } from '@/data-engine/protocol';
import { processCommand } from '@/data-engine/server';
import { noteRef } from '@test-utils/deviceWorld';

async function reopenEditor() {
  const previous = stand.editor;
  fireEvent.click(screen.getByTitle('common.done'));
  await settle();
  expect(stand.view.container.querySelector('.tiptap')).toBeNull();
  fireEvent.click(screen.getByTitle('common.edit'));
  await settle();
  expect(stand.editor).not.toBe(previous);
  stand.editor.view.setProps({ handleScrollToSelection: () => true });
}

function type(word: string) {
  act(() => insert(' ' + word));
}

it.each(['online', 'offline'])('keeps the same unfinished note after Done and Edit (%s)', async mode => {
  await start();
  if (mode === 'offline') {
    stand.laptop.goOffline();
    await settle();
  }

  type('Firstword');
  await reopenEditor();
  type('Secondword');
  expect(await stored()).toBe(original);
  expect(md()).toBe(original + ' Firstword Secondword');

  if (mode === 'offline') {
    await finish();
    expect(await stored()).toBe(original);
    stand.laptop.online = true;
    stand.laptop.run(() => stand.laptop.engine.setOnline(true));
  }
  await finish();

  expect(hasNoteQuestion()).toBe(false);
  expect(stand.autosave.saveBlocked).toBe(false);
  expect(await stored()).toBe(original + ' Firstword Secondword');
});

it('can type after a real accepted arrival that is identical to the private draft at remount', async () => {
  await start();
  type('Firstword');
  await phoneSave(original + ' Firstword');
  await reopenEditor();
  type('Secondword');
  await finish();

  expect(hasNoteQuestion()).toBe(false);
  expect(await stored()).toBe(original + ' Firstword Secondword');
});

it.each(['typing-first', 'dictation-first'])('keeps transcription and both typed words after remount (%s)', async order => {
  await start();
  act(() => stand.voice.onSourcePersisted?.('source-1'));
  type('Firstword');
  await reopenEditor();
  act(() => {
    stand.editor.commands.setTextSelection(stand.editor.state.doc.content.size - 1);
    if (order === 'typing-first') {
      insert(' Secondword');
      void stand.voice.onText('Dictatedword', 'source-1');
    } else {
      void stand.voice.onText('Dictatedword', 'source-1');
      insert(' Secondword');
    }
  });
  await finish();

  const text = original + ' Firstword Secondword\n\nDictatedword';
  expect(hasNoteQuestion()).toBe(false);
  expect(md()).toBe(text);
  expect(await stored()).toBe(text);
  expect((await stand.world.snapshot(noteRef)).value?.dictationSourceIds).toEqual(['source-1']);
  if (order === 'dictation-first') {
    expect(stand.editor.state.selection.$head.parent.textContent).toBe('Second paragraph. Firstword Secondword');
    act(() => { expect(stand.editor.commands.undo()).toBe(true); });
    expect(md()).toBe(original + ' Firstword Secondword');
    act(() => { expect(stand.editor.commands.undo()).toBe(true); });
    expect(md()).toBe(original + ' Firstword');
    act(() => { expect(stand.editor.commands.redo()).toBe(true); });
    act(() => { expect(stand.editor.commands.redo()).toBe(true); });
    await finish();
    expect(await stored()).toBe(text);
  }
});

it('continues editing after the outbox accepts the first edit while the note is offline', async () => {
  await start();
  stand.laptop.goOffline();
  await settle();
  type('Firstword');
  await finish();
  expect(stand.laptop.engine.getPending()).toHaveLength(1);
  expect(await stored()).toBe(original);

  await reopenEditor();
  type('Secondword');
  await finish();
  stand.laptop.online = true;
  stand.laptop.run(() => stand.laptop.engine.setOnline(true));
  await finish();

  expect(hasNoteQuestion()).toBe(false);
  expect(await stored()).toBe(original + ' Firstword Secondword');
});

it('still asks when a genuinely different stored paragraph overlaps the private edit across remount', async () => {
  await start();
  const rewriteLastParagraph = (value: string) => act(() => {
    const { state, view } = stand.editor;
    const final = state.doc.lastChild!;
    const end = state.doc.content.size - 1;
    view.dispatch(state.tr.insertText(value, end - final.content.size, end));
  });
  stand.laptop.goOffline();
  await settle();
  rewriteLastParagraph('My private conclusion.');
  await reopenEditor();
  rewriteLastParagraph('My last conclusion.');

  stand.laptop.online = true;
  stand.laptop.run(() => stand.laptop.engine.setOnline(true));
  const storedVersion = original.replace('Second paragraph.', 'Other device conclusion.');
  await phoneSave(storedVersion);
  await finish();

  expect(hasNoteQuestion()).toBe(true);
  expect(await stored()).toBe(storedVersion);
  expect(md()).toContain('My last conclusion.');
});

it('keeps unseen transcription when Undo removes the last typed word', async () => {
  await start();
  act(() => stand.voice.onSourcePersisted?.('source-1'));
  type('Firstword');
  await reopenEditor();
  type('Secondword');

  act(() => {
    void stand.voice.onText('Dictatedword', 'source-1');
    expect(stand.editor.commands.undo()).toBe(true);
  });
  await finish();

  const text = original + ' Firstword\n\nDictatedword';
  expect(md()).toBe(text);
  expect(await stored()).toBe(text);
  expect((await stand.world.snapshot(noteRef)).value?.dictationSourceIds).toEqual(['source-1']);
});

it('continues typing in the displayed note before its transcription save is acknowledged to the editor', async () => {
  await start();
  expect(stand.laptop.clock.capture('owner')).toBeDefined();
  jest.spyOn(actionClock, 'capture').mockImplementation(owner => stand.laptop.clock.capture(owner));
  act(() => stand.voice.onSourcePersisted?.('source-1'));
  type('Firstword');
  await reopenEditor();
  type('Secondword');
  const beforeThird = original + ' Firstword Secondword\n\nDictatedword';
  const deliver = stand.laptop.transport.send.bind(stand.laptop.transport);
  let typedBeforeReceipt = false;
  jest.spyOn(stand.laptop.transport, 'send').mockImplementationOnce(async command => {
    expect(md()).toBe(beforeThird);
    const { state, view } = stand.editor;
    const typedParagraph = state.doc.child(1);
    view.dispatch(state.tr.insertText(' Thirdword', state.doc.child(0).nodeSize + typedParagraph.nodeSize - 1));
    typedBeforeReceipt = true;
    jest.advanceTimersByTime(30);
    return deliver(command);
  });
  act(() => { void stand.voice.onText('Dictatedword', 'source-1'); });
  await finish();

  expect(typedBeforeReceipt).toBe(true);
  expect(hasNoteQuestion()).toBe(false);
  expect(await stored()).toBe(original + ' Firstword Secondword Thirdword\n\nDictatedword');
});

it.each(['confirmed', 'cancelled'])('retains transcription when composition is %s in the same task', async disposition => {
  await start();
  act(() => stand.voice.onSourcePersisted?.('source-1'));
  type('Firstword');
  await reopenEditor();
  const editor = stand.editor;
  act(() => { editor.commands.setTextSelection(editor.state.doc.content.size - 1); });
  fireEvent.compositionStart(editor.view.dom, { data: '' });

  await act(async () => {
    void stand.voice.onText('Dictatedword', 'source-1');
    insert(' 日本語');
    fireEvent.compositionEnd(editor.view.dom, { data: disposition === 'confirmed' ? '日本語' : '' });
    await Promise.resolve();
  });
  await finish();

  const typed = original + ' Firstword' + (disposition === 'confirmed' ? ' 日本語' : '');
  const text = typed + '\n\nDictatedword';
  expect(hasNoteQuestion()).toBe(false);
  expect(md()).toBe(text);
  expect(await stored()).toBe(text);
  expect((await stand.world.snapshot(noteRef)).value?.dictationSourceIds).toEqual(['source-1']);
});

it('keeps the accepted paragraph and later dictation when the earlier save is refused', async () => {
  await start();
  expect(stand.laptop.clock.capture('owner')).toBeDefined();
  jest.spyOn(actionClock, 'capture').mockImplementation(owner => stand.laptop.clock.capture(owner));
  act(() => stand.voice.onSourcePersisted?.('source-1'));
  const deliver = stand.laptop.transport.send.bind(stand.laptop.transport);
  const arrived = original + '\n\nArrivedword';
  let interleaved = false;
  jest.spyOn(stand.laptop.transport, 'send').mockImplementationOnce(async command => {
    const before = await stand.world.snapshot(noteRef);
    expect((await processCommand('owner', {
      protocol: 1, kind: 'update', owner: 'owner', operationId: stand.world.id('phone'), resource: noteRef,
      generation: before.metadata!.generation, dependsOn: [],
      changes: diffFields(before.value!, { ...before.value!, content: arrived }),
    })).kind).toBe('acknowledged');
    await stand.laptop.run(() => stand.laptop.engine.refreshCollection('studyNotes'));
    expect(md()).toBe(original + ' Privateword');
    void stand.voice.onText('Dictatedword', 'source-1');
    expect(stand.editor.commands.undo()).toBe(true);
    interleaved = true;
    return deliver(command);
  });
  type('Privateword');
  await finish();

  expect(interleaved).toBe(true);
  expect(await stored()).toContain('Arrivedword');
  expect(md()).toContain('Dictatedword');
  expect(md()).not.toContain('Privateword');
});
