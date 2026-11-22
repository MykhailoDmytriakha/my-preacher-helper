import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { applyCommand, diffFields } from '@/data-engine/protocol';
import { noteRef } from '@test-utils/deviceWorld';
import { chooseNotice, finish, hasNoteQuestion, insert, original, phoneSave, reloadPage, settle, stand, start, stored } from '@test-utils/noteOrdering';
import { processCommand } from '@/data-engine/server';
import { DataSession } from '@/data-engine/session';

import { StudyNoteSessionFeedback } from '../StudyNoteSessionFeedback';

import type { DocumentData, ResourceSnapshot } from '@/data-engine/types';
import type { ComponentProps } from 'react';

describe('closing the study-note editor hands its current words to the engine', () => {
  it('sends words typed in the same task as navigation away', async () => {
    await start();

    act(() => {
      insert(' Lastword');
      stand.leave();
    });
    await finish();

    expect(await stored()).toBe(original + ' Lastword');
  });

  it('sends the final words after the earlier pending save is answered', async () => {
    await start();
    const send = stand.laptop.transport.send.bind(stand.laptop.transport);
    let releaseFirst!: () => void;
    const held = new Promise<void>(resolve => { releaseFirst = resolve; });
    const delivery = jest.spyOn(stand.laptop.transport, 'send').mockImplementationOnce(async command => {
      await held;
      return send(command);
    });
    try {
      act(() => insert(' Firstword'));
      await settle();
      await act(async () => {
        jest.advanceTimersByTime(1600);
        for (let turn = 0; turn < 5000; turn += 1) await Promise.resolve();
      });
      expect(delivery).toHaveBeenCalledTimes(1);

      act(() => {
        insert(' Secondword');
        stand.leave();
      });
    } finally {
      releaseFirst();
    }
    await settle();
    await finish();

    expect(await stored()).toBe(original + ' Firstword Secondword');
    expect(delivery).toHaveBeenCalledTimes(2);
  });
});

it('creates one new note with the words typed immediately before leaving', async () => {
  stand.routeId = 'new';
  await start('');
  const send = jest.spyOn(stand.laptop.transport, 'send');

  act(() => {
    insert('A new note');
    stand.leave();
  });
  await finish();

  const created = send.mock.calls.flatMap(([command]) => command.kind === 'create' && command.resource.collection === 'studyNotes' ? [command] : []);
  expect(created).toHaveLength(1);
  const snapshot = await stand.world.snapshot(created[0].resource);
  expect(snapshot.value?.content).toBe('A new note');
});


it('keeps the same editor after the first autosave gives the note its address', async () => {
  const previousUrl = window.location.href;
  window.history.replaceState(null, '', '/studies/new');
  stand.routeId = 'new';
  try {
    await start('');
    const editor = stand.editor;
    const sends = jest.spyOn(stand.laptop.transport, 'send');

    act(() => insert('First words'));
    await finish();
    const created = sends.mock.calls.find(([command]) => command.kind === 'create' && command.resource.collection === 'studyNotes')?.[0];
    expect(created).toBeDefined();
    expect(window.location.pathname).toBe('/studies/' + created!.resource.id);
    expect(stand.editor).toBe(editor);

    act(() => insert(' and more'));
    await finish();
    expect(stand.editor).toBe(editor);
    expect((await stand.world.snapshot(created!.resource)).value?.content).toBe('First words and more');
    expect(sends.mock.calls.filter(([command]) => command.kind === 'create')).toHaveLength(1);
  } finally {
    window.history.replaceState(null, '', previousUrl);
  }
});

it('restores the words of an uncreated note without writing its recovery metadata to the document', async () => {
  stand.routeId = 'new';
  stand.recovery = {
    title: 'Recovered title', content: 'Recovered words', type: 'note', tags: [], scriptureRefs: [],
    targetGeneration: null, reviewLegacyFields: true,
  };
  const previousUrl = window.location.href;
  window.history.replaceState(null, '', '/studies/new');
  try {
    await start('');
    const sends = jest.spyOn(stand.laptop.transport, 'send');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' })); });
    await finish();

    const created = sends.mock.calls.find(([command]) => command.kind === 'create' && command.resource.collection === 'studyNotes')?.[0];
    expect(created).toBeDefined();
    const saved = await stand.world.snapshot(created!.resource);
    expect(saved.value).toMatchObject({ title: 'Recovered title', content: 'Recovered words' });
    expect(saved.value).not.toHaveProperty('reviewLegacyFields');
    expect(saved.value).not.toHaveProperty('targetGeneration');
    expect(window.location.pathname).toBe('/studies/' + created!.resource.id);
  } finally {
    window.history.replaceState(null, '', previousUrl);
  }
});

it('keeps the restored text when a device sends an older unseen change for the first time', async () => {
  await start();
  const opened = await stand.world.snapshot(noteRef);
  const delayedChanges = diffFields(opened.value!, { ...opened.value, content: original + ' Offlineword' });
  const sends = jest.spyOn(stand.laptop.transport, 'send');

  act(() => insert(' Laptopword'));
  await finish();
  expect(await stored()).toBe(original + ' Laptopword');
  act(() => { expect(stand.editor.commands.undo()).toBe(true); });
  await finish();
  expect(await stored()).toBe(original);
  const [first, restored] = sends.mock.calls.map(([command]) => command);
  expect(first).toMatchObject({ kind: 'update', studyNoteContentAction: { observedRevision: 1 } });
  expect(restored).toMatchObject({ kind: 'update', studyNoteContentAction: { observedRevision: 2 } });

  const late = await processCommand('owner', {
    protocol: 1, kind: 'update', resource: noteRef, owner: 'owner', operationId: 'delayed-phone',
    generation: opened.metadata!.generation, changes: delayedChanges, dependsOn: [],
  });
  expect(late.kind).toBe('conflict');
  expect(await stored()).toBe(original);
});



it('saves the return to the opening title while the earlier rename is still being sent', async () => {
  await start();
  const send = stand.laptop.transport.send.bind(stand.laptop.transport);
  let releaseFirst!: () => void;
  const held = new Promise<void>(resolve => { releaseFirst = resolve; });
  const delivery = jest.spyOn(stand.laptop.transport, 'send').mockImplementationOnce(async command => {
    await held;
    return send(command);
  });
  const title = screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder');
  try {
    fireEvent.change(title, { target: { value: 'Temporary title' } });
    await settle();
    await act(async () => {
      jest.advanceTimersByTime(1600);
      for (let turn = 0; turn < 5000; turn += 1) await Promise.resolve();
    });
    expect(delivery).toHaveBeenCalledTimes(1);
    fireEvent.change(title, { target: { value: 'Original' } });
    stand.leave();
  } finally {
    releaseFirst();
  }
  await finish();

  expect((await stand.world.snapshot(noteRef)).value?.title).toBe('Original');
  expect(delivery).toHaveBeenCalledTimes(2);
});

it('merges a tag added on the phone before saving the local tag', async () => {
  await start();
  await phoneSave(original, { tags: ['From the phone'] });
  const field = screen.getByPlaceholderText('studiesWorkspace.addTag');
  fireEvent.change(field, { target: { value: 'From the laptop' } });
  fireEvent.keyDown(field, { key: 'Enter' });
  await finish();

  expect((await stand.world.snapshot(noteRef)).value?.tags).toEqual(['From the phone', 'From the laptop']);
  expect(hasNoteQuestion()).toBe(false);
});

it.each([false, true])('keeps the last explicit tag membership when the first write is delayed (opening=%s)', async opening => {
  await start();
  const tag = 'Selected tag';
  const add = () => {
    const input = screen.getByPlaceholderText('studiesWorkspace.addTag');
    fireEvent.change(input, { target: { value: tag } });
    fireEvent.keyDown(input, { key: 'Enter' });
  };
  const remove = () => fireEvent.click(screen.getByRole('button', { name: 'studiesWorkspace.removeTag' }));
  const change = (present: boolean) => present ? add() : remove();
  if (opening) { add(); await finish(); }
  const send = stand.laptop.transport.send.bind(stand.laptop.transport);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const delivery = jest.spyOn(stand.laptop.transport, 'send').mockImplementationOnce(async command => {
    await held;
    return send(command);
  });
  try {
    change(!opening);
    await act(async () => {
      for (let turn = 0; turn < 5000; turn += 1) await Promise.resolve();
    });
    expect(delivery).toHaveBeenCalledTimes(1);
    change(opening);
  } finally {
    release();
  }
  await finish();

  const note = (await stand.world.snapshot(noteRef)).value;
  expect(note?.tags).toEqual(opening ? [tag] : []);
  expect(delivery).toHaveBeenCalledTimes(2);
  expect(hasNoteQuestion()).toBe(false);
});

it('asks before applying an old draft to a different instance of a note with the same opening words', async () => {
  const basis = { title: 'Original', content: original, type: 'note', tags: [], scriptureRefs: [] } as const;
  stand.recoveryBase = { ...basis, tags: [], scriptureRefs: [] };
  stand.recovery = { ...basis, content: 'Words from the previous instance', tags: [], scriptureRefs: [],
    targetGeneration: 'a-different-note-instance' };
  await start();
  const sends = jest.spyOn(stand.laptop.transport, 'send');

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' })); });
  await finish();
  expect(hasNoteQuestion()).toBe(true);
  expect(await stored()).toBe(original);
  expect(sends).not.toHaveBeenCalled();
});

it('adds a scripture passage once even across two additions and preserves unrelated text', async () => {
  await start();
  const field = screen.getByPlaceholderText('studiesWorkspace.quickRefPlaceholder');
  for (let count = 0; count < 2; count += 1) {
    fireEvent.change(field, { target: { value: 'John 3:16' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await finish();
  }

  const note = (await stand.world.snapshot(noteRef)).value;
  expect(note?.content).toBe(original);
  expect(note?.scriptureRefs).toEqual([expect.objectContaining({ book: 'John', chapter: 3, fromVerse: 16 })]);
  expect(hasNoteQuestion()).toBe(false);
});

it.each([false, true])('saves shortened note text after a size refusal (reopened=%s)', async reopened => {
  await start();
  const delivery = jest.spyOn(stand.laptop.transport, 'send').mockImplementationOnce(async command =>
    ({ kind: 'refused', operationId: command.operationId, code: 'resource-exhausted' }));
  act(() => insert(' An earlier longer note that hit the save limit'));
  await finish();
  expect(await stored()).toBe(original);
  expect(screen.getByText('dataSync.phase.refused')).toBeInTheDocument();

  if (reopened) await reloadPage();
  const corrections = reopened ? jest.spyOn(stand.laptop.transport, 'send') : delivery;
  act(() => { stand.editor.commands.setContent('Shortened note'); });
  await finish();

  expect(stand.autosave.content).toBe('Shortened note');
  expect(await stored()).toBe('Shortened note');
  expect(screen.getByText('common.saved')).toBeInTheDocument();
  expect(corrections).toHaveBeenCalledTimes(reopened ? 1 : 2);
  expect(corrections.mock.lastCall?.[0]).toMatchObject({
    dependsOn: [],
    changes: [expect.objectContaining({
      path: ['content'], before: { exists: true, value: original }, after: { exists: true, value: 'Shortened note' },
    })],
  });
});

it('keeps an independent restored title when the person takes the stored body', async () => {
  const basis = { title: 'Original', content: original, type: 'note' as const, tags: [], scriptureRefs: [] };
  stand.recoveryBase = basis;
  stand.recovery = { ...basis, title: 'Title from the restored draft', content: 'Words from the restored draft' };
  await start();
  await phoneSave('Words already stored from the phone');
  const sends = jest.spyOn(stand.laptop.transport, 'send');

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'unsavedDraft.restore' })); });
  await finish();
  expect(hasNoteQuestion()).toBe(true);
  expect(sends).not.toHaveBeenCalled();

  await chooseNotice('take');
  expect((await stand.world.snapshot(noteRef)).value).toMatchObject({
    title: 'Title from the restored draft', content: 'Words already stored from the phone',
  });
  expect(hasNoteQuestion()).toBe(false);
});

it('shows the disputed body as well as the references before applying their shared choice', async () => {
  const reference = { id: 'phone-ref', bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 };
  const opening: DocumentData = { userId: 'owner', type: 'note', title: 'Title', content: 'Opening body',
    scriptureRefs: [reference], tags: [], isDraft: true, createdAt: '2026-11-12', updatedAt: '2026-11-12' };
  const saved: DocumentData = { ...opening, content: 'Saved body from the phone',
    scriptureRefs: [{ ...reference, id: 'pc-ref', fromVerse: 17 }] };
  const baseline: ResourceSnapshot = { resource: noteRef, value: opening,
    metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } };
  const current: ResourceSnapshot = { resource: noteRef, value: saved,
    metadata: { ...baseline.metadata!, revision: 2, studyNoteReferenceAliases: [{ from: 'phone-ref', to: 'pc-ref' }] } };
  const draft = { ...opening, content: 'Draft body from the laptop', scriptureRefs: [] };
  const result = applyCommand({ protocol: 1, kind: 'update', resource: noteRef, owner: 'owner', operationId: 'laptop-edit',
    generation: 'g', changes: diffFields(opening, draft), dependsOn: [] }, current);
  expect(result.kind).toBe('conflict');
  const session = new DataSession(baseline);
  session.edit(draft);
  session.registerCommit('laptop-edit', 1, draft);
  session.accept(result);
  session.release('laptop-edit');
  const checkpoint = session.checkpoint();
  const acceptRemote = jest.fn(() => { session.acceptRemote(); return Promise.resolve(); });
  const document = {
    state: { checkpoint }, recoveryIdentity: { owner: 'owner', id: noteRef.id },
    status: { phase: 'conflict', canAcceptRemote: true, canKeepLocal: true },
    acceptRemote, keepLocal: async () => undefined, retry: async () => undefined,
  } as unknown as ComponentProps<typeof StudyNoteSessionFeedback>['document'];
  render(<StudyNoteSessionFeedback document={document} onRecover={() => undefined} />);
  const comparison = within(screen.getByRole('region', { name: 'dataSync.versionComparison' }));
  expect(comparison.getByLabelText('dataSync.yourVersion')).toHaveTextContent('Draft body from the laptop');
  expect(comparison.getByLabelText('dataSync.storedVersion')).toHaveTextContent('Saved body from the phone');
  expect(comparison.getByLabelText('dataSync.storedVersion')).toHaveTextContent(/John 3:17/);

  fireEvent.click(screen.getByRole('button', { name: 'dataSync.useStoredVersion' }));
  const confirm = await screen.findByRole('button', { name: 'dataSync.confirmStoredFields.confirm' });
  await act(async () => { fireEvent.click(confirm); });
  expect(acceptRemote).toHaveBeenCalledWith(checkpoint);
  expect(session.checkpoint().draft).toMatchObject({ content: saved.content, scriptureRefs: saved.scriptureRefs });
});
