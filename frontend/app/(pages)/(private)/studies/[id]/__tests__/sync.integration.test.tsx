import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { noteRef } from '@test-utils/deviceWorld';
import { finish, hasInlineQuestion, hasNoteQuestion, md, phoneSave, pulse, settle, stand, start, stored } from '@test-utils/noteOrdering';
import { createIndexedDbCheckpoints } from '@/data-engine/checkpoint.client';
import { createIndexedDbCommitStore } from '@/data-engine/commits.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { diffFields } from '@/data-engine/protocol';
import { processCommand } from '@/data-engine/server';
import { draftKey } from '@/utils/durableDraft';
import { useSearchParams } from 'next/navigation';
import StudyNoteEditorPage from '../page';

import type { Editor } from '@tiptap/core';
import type { ResourceRef } from '@/data-engine/types';

const original = 'Original body';
const offerKey = draftKey('owner', noteRef.id, 'note');
const offered = { title: 'Original', content: 'Unsaved from before', tags: [], scriptureRefs: [], type: 'note' };

function replaceBody(text: string, editor: Editor = stand.editor) {
  act(() => editor.view.dispatch(editor.state.tr.insertText(text, 1, editor.state.doc.content.size - 1)));
}

async function advanceWhileSending(ms = 0) {
  await act(async () => { await pulse(ms); });
}

async function drafts(resource: ResourceRef = noteRef) {
  const copies = await createIndexedDbCheckpoints().listRecoverable('owner', resource);
  return copies.map(({ record }) => record.checkpoint.draft?.content);
}

function requestRows(resource: ResourceRef) {
  return createIndexedDbCommitStore().list('owner').then(rows => rows.filter(request =>
    request.baseline.resource.id === resource.id && request.baseline.resource.collection === resource.collection));
}

function delayFirstReply(serverAcceptsBeforeReply = false) {
  const transport = stand.laptop.transport, deliver = transport.send.bind(transport);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const sends = jest.spyOn(transport, 'send').mockImplementationOnce(async command => {
    if (serverAcceptsBeforeReply) {
      const result = await deliver(command);
      await held;
      return result;
    }
    await held;
    return deliver(command);
  });
  return { sends, release };
}

async function openFromLegacyCopy(content = offered.content) {
  await start(original);
  stand.leave();
  localStorage.setItem(offerKey, JSON.stringify({ value: { ...offered, content }, savedAt: Date.now() }));
  await stand.reopen();
}

function noteContents() {
  return stand.view.container.querySelector('.tiptap');
}

async function carryOnFromDialog() {
  fireEvent.click(screen.getByRole('button', { name: /^(common.discardText|dataSync.confirmStoredField)\.keep$/ }));
  await settle();
}

async function askToTakeStored() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^(dataSync.useStoredVersion|dataSync.acceptRemote)$/ })); });
}

function confirmStoredButton() {
  return screen.queryByRole('button', { name: /^(common.discardText|dataSync.confirmStoredField)\.confirm$/ });
}

async function getBodyConflict() {
  await start(original);
  const first = delayFirstReply();
  try {
    replaceBody('Typed on the laptop');
    await settle();
    await advanceWhileSending(1600);
    expect(first.sends).toHaveBeenCalledTimes(1);
    const before = await stand.world.snapshot(noteRef);
    const change = await processCommand('owner', {
      protocol: 1, kind: 'update', owner: 'owner', operationId: stand.world.id('phone'), resource: noteRef,
      generation: before.metadata!.generation, dependsOn: [],
      changes: diffFields(before.value!, { ...before.value!, content: 'Written on the phone' }),
    });
    expect(change.kind).toBe('acknowledged');
  } finally {
    first.release();
    await finish();
  }
  expect(hasInlineQuestion()).toBe(true);
  expect(md()).toBe('Typed on the laptop');
  expect(await stored()).toBe('Written on the phone');
  return first.sends;
}

it('keeps both independent openings when the older editor loses its owner with a write waiting', async () => {
  await start(original);
  stand.laptop.goOffline();
  const older = stand.editor;
  const olderSession = stand.session!;
  const send = jest.spyOn(stand.laptop.transport, 'send');
  replaceBody('older unsaved text', older);
  await settle();
  const newer = stand.laptop.run(() => render(<DataEngineProvider><StudyNoteEditorPage /></DataEngineProvider>));
  try {
    await settle();
    fireEvent.click(within(newer.container).getByRole('button', { name: 'common.edit' }));
    await settle();
    expect(stand.editor).not.toBe(older);
    replaceBody('newer unsaved text, its only copy');
    await settle();
    expect((await drafts()).sort()).toEqual(['newer unsaved text, its only copy', 'older unsaved text']);
    await act(async () => { await olderSession.save(); });
    expect((await requestRows(noteRef)).map(row => row.value?.content)).toContain('older unsaved text');
  } finally {
    newer.unmount();
  }
  await settle();
  act(() => stand.laptop.engine.setOwner(null));
  stand.leave();
  await finish();
  expect((await drafts()).sort()).toEqual(['newer unsaved text, its only copy', 'older unsaved text']);
  expect(send).not.toHaveBeenCalled();
  expect(await stored()).toBe(original);
});

it('clears an own-write echo after acceptance without losing later typing', async () => {
  await start(original);
  const { sends, release } = delayFirstReply(true);
  try {
    replaceBody('Own A');
    await settle();
    await advanceWhileSending(1600);
    expect(sends).toHaveBeenCalledTimes(1);
    expect(await stored()).toBe('Own A');
    await act(async () => {
      await stand.laptop.run(() => stand.laptop.engine.refreshCollection('studyNotes'));
      await pulse();
    });
    replaceBody('Later B');
    await advanceWhileSending();
    expect(md()).toBe('Later B');
    expect(await drafts()).toContain('Later B');
    expect(await stored()).toBe('Own A');
    expect(hasNoteQuestion()).toBe(false);
    act(() => window.dispatchEvent(new Event('pagehide')));
    await advanceWhileSending();
    expect(await drafts()).toContain('Later B');
  } finally {
    release();
    await finish();
  }
  expect(md()).toBe('Later B');
  expect(await stored()).toBe('Later B');
  expect(sends).toHaveBeenCalledTimes(2);
  expect(hasNoteQuestion()).toBe(false);
});

it('keeps typing after create submission unsaved until that exact text reaches the server', async () => {
  stand.routeId = 'new';
  await start('');
  const resource = { collection: 'studyNotes', id: stand.autosave.noteId };
  const snapshot = () => stand.world.snapshot(resource);
  const { sends, release } = delayFirstReply();
  try {
    replaceBody('Create A');
    await settle();
    await advanceWhileSending(1600);
    expect(sends).toHaveBeenCalledTimes(1);
    expect(sends.mock.calls[0]?.[0]).toMatchObject({ kind: 'create', resource, value: { content: 'Create A' } });
    replaceBody('Later B');
    await advanceWhileSending();
    act(() => window.dispatchEvent(new Event('pagehide')));
    await advanceWhileSending();
    expect(await drafts(resource)).toContain('Later B');
    expect((await snapshot()).value).toBeNull();
    expect(sends).toHaveBeenCalledTimes(1);
    expect(hasNoteQuestion()).toBe(false);
  } finally {
    release();
    await finish();
  }
  expect(md()).toBe('Later B');
  expect((await snapshot()).value?.content).toBe('Later B');
  expect(sends.mock.calls.map(([command]) => command.kind)).toEqual(['create', 'update']);
  expect(hasNoteQuestion()).toBe(false);
});

it('does not acknowledge an older retained snapshot after a newer save', async () => {
  await start(original);
  const cached = await stand.world.snapshot(noteRef);
  replaceBody('Saved B');
  await finish();
  expect(await stored()).toBe('Saved B');
  const transport = stand.laptop.transport;
  const read = transport.read.bind(transport);
  const observe = jest.spyOn(transport, 'read').mockImplementation((owner, resource, request) =>
    resource.collection === noteRef.collection && resource.id === noteRef.id
      ? Promise.resolve({ ...cached, value: { ...cached.value!, content: 'Retained A' } })
      : read(owner, resource, request));
  try {
    await act(async () => {
      await stand.laptop.run(() => stand.laptop.engine.refreshCollection('studyNotes'));
      await pulse();
    });
    expect(observe).toHaveBeenCalledWith('owner', noteRef);
    expect(stand.confirmed?.content).toBe('Saved B');
    expect(md()).toBe('Saved B');
  } finally {
    observe.mockRestore();
  }
  replaceBody('Retained A');
  await settle();
  expect(await drafts()).toContain('Retained A');
  expect(await stored()).toBe('Saved B');
  act(() => window.dispatchEvent(new Event('pagehide')));
  await finish();
  expect(await stored()).toBe('Retained A');
  expect(hasNoteQuestion()).toBe(false);
});

it('does not enqueue an unchanged update after a queued create', async () => {
  stand.routeId = 'new';
  await start('');
  const resource = { collection: 'studyNotes', id: stand.autosave.noteId };
  stand.laptop.goOffline();
  const send = jest.spyOn(stand.laptop.transport, 'send');
  replaceBody('Queued create A');
  await finish();
  act(() => window.dispatchEvent(new Event('pagehide')));
  await finish();
  expect(await requestRows(resource)).toEqual([expect.objectContaining({ value: expect.objectContaining({ content: 'Queued create A' }) })]);
  expect(await drafts(resource)).toContain('Queued create A');
  expect(send).not.toHaveBeenCalled();
  await act(async () => { await stand.laptop.goOnline(); });
  await finish();
  expect(send.mock.calls.map(([command]) => command.kind)).toEqual(['create']);
  expect((await stand.world.snapshot(resource)).value?.content).toBe('Queued create A');
});

it('follows the engine row while the editor is clean, with no banner and no draft left behind', async () => {
  await start(original);
  fireEvent.click(screen.getByRole('button', { name: 'common.done' }));
  await settle();
  await phoneSave('Written on the phone');
  expect(screen.getByText('Written on the phone')).toBeInTheDocument();
  expect(hasNoteQuestion()).toBe(false);
  act(() => window.dispatchEvent(new Event('pagehide')));
  await finish();
  expect(await drafts()).toEqual([]);
});

it('keeps words being typed when the row changes underneath', async () => {
  await start(original);
  replaceBody('Typed on the laptop');
  await settle();
  await phoneSave('Written on the phone');
  expect(md()).toBe('Typed on the laptop');
  expect(await drafts()).toContain('Typed on the laptop');
  expect(await stored()).toBe('Written on the phone');
});

describe('while unsaved text from last time waits for an answer', () => {
  it('keeps the words on offer when the person starts writing without answering', async () => {
    await openFromLegacyCopy();
    expect(screen.getByText('unsavedDraft.title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
    act(() => window.dispatchEvent(new Event('pagehide')));
    await finish();
    expect(JSON.parse(localStorage.getItem(offerKey)!).value.content).toBe(offered.content);
    expect(screen.getByText('unsavedDraft.title')).toBeInTheDocument();
    expect(noteContents()).toBeNull();
    expect(screen.getByRole('button', { name: 'common.edit' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'studiesWorkspace.aiAnalyze.button' })).toBeNull();
  });

  it('shows the words on offer, so the answer is not given blind', async () => {
    await openFromLegacyCopy();
    const offer = screen.getByText('unsavedDraft.title').closest('[role="status"]') as HTMLElement;
    expect(within(offer).getByText(offered.content)).toBeVisible();
  });

  it('opens for writing once the words are brought back, with those words in it', async () => {
    await openFromLegacyCopy();
    fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
    await settle();
    expect(noteContents()).not.toBeNull();
    expect(md()).toBe(offered.content);
  });

  it('takes a draft equal to the note as settled: typing opens no offer and keeps the editor', async () => {
    await openFromLegacyCopy(original);
    expect(screen.queryByText('unsavedDraft.title')).toBeNull();
    const editor = stand.editor;
    replaceBody('Original body, and more');
    await settle();
    expect(screen.queryByText('unsavedDraft.title')).toBeNull();
    expect(stand.editor).toBe(editor);
    expect(md()).toBe('Original body, and more');
    expect(JSON.parse(localStorage.getItem(offerKey)!).value.content).toBe(original);
    expect(await drafts()).toContain('Original body, and more');
  });

  it('holds a new note, which opens straight into writing, until the words left in it last time are answered', async () => {
    await start(original);
    stand.leave();
    const docId = 'new~pending-note';
    const key = draftKey('owner', docId, 'note');
    localStorage.setItem(key, JSON.stringify({
      value: { ...offered, title: '', content: 'Half a new note' }, savedAt: Date.now(), creationTargetId: 'pending-note',
    }));
    const query = useSearchParams() as URLSearchParams;
    query.set('draft', docId);
    query.set('draftOwner', 'owner');
    try {
      await stand.reopen('new');
      expect(screen.getByText('unsavedDraft.title')).toBeInTheDocument();
      expect(noteContents()).toBeNull();
      act(() => window.dispatchEvent(new Event('pagehide')));
      await settle();
      expect(JSON.parse(localStorage.getItem(key)!).value.content).toBe('Half a new note');
      fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' }));
      await settle();
      expect(md()).toBe('Half a new note');
      // Import transfers the legacy words to a recoverable engine checkpoint.
      expect(await drafts({ collection: 'studyNotes', id: stand.autosave.noteId })).toContain('Half a new note');
    } finally {
      query.delete('draft');
      query.delete('draftOwner');
    }
  });

  it('opens for writing once the words are let go, with the saved note in it', async () => {
    await openFromLegacyCopy();
    fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.discard' }));
    expect(screen.getByRole('dialog', { name: 'common.discardText.title' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.discardText.confirm' }));
    await settle();
    const edit = screen.getByRole('button', { name: 'common.edit' });
    expect(edit).toBeEnabled();
    fireEvent.click(edit);
    await settle();
    expect(md()).toBe(original);
    expect(localStorage.getItem(offerKey)).toBeNull();
  });
});

it('offers the row when a save is refused, and "take theirs" shows it', async () => {
  await getBodyConflict();
  await askToTakeStored();
  expect(md()).toBe('Typed on the laptop');
  expect(confirmStoredButton()).toBeVisible();
  await carryOnFromDialog();
  expect(md()).toBe('Typed on the laptop');
  expect(hasInlineQuestion()).toBe(true);
  await askToTakeStored();
  fireEvent.click(confirmStoredButton()!);
  await finish();
  expect(md()).toBe('Written on the phone');
  expect(await stored()).toBe(md());
  expect(await drafts()).toEqual([]);
});

it.each(['stored row', 'local words'])('keeps the current text when %s changes under an open discard question', async changed => {
  const sends = await getBodyConflict();
  await askToTakeStored();
  expect(confirmStoredButton()).toBeVisible();
  if (changed === 'stored row') await phoneSave('Later stored words');
  else {
    replaceBody('Later local words');
    await settle();
  }
  const savesBeforeYes = sends.mock.calls.length;
  const confirm = confirmStoredButton();
  if (confirm) fireEvent.click(confirm);
  await finish();
  const local = changed === 'stored row' ? 'Typed on the laptop' : 'Later local words';
  expect(md()).toBe(local);
  expect(await drafts()).toContain(local);
  expect(await stored()).toBe(changed === 'stored row' ? 'Later stored words' : 'Written on the phone');
  expect(hasInlineQuestion()).toBe(true);
  expect(sends).toHaveBeenCalledTimes(savesBeforeYes);
});
