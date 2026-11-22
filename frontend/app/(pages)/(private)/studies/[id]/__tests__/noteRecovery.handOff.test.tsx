import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';

import { stand, start, original, stored, settle, phoneSave, insert, finish, hasNoteQuestion, reloadPage } from '@test-utils/noteOrdering';
import { noteRef } from '@test-utils/deviceWorld';
import { DeviceStorage } from '@test-utils/deviceWorld/storage';

import type { ResourceRef } from '@/data-engine/types';

const noteValue = async (resource: ResourceRef = noteRef) => (await stand.world.snapshot(resource)).value;
const typeTitle = (title: string) =>
  fireEvent.change(screen.getByPlaceholderText('studiesWorkspace.titlePlaceholder'), { target: { value: title } });

/** Pause the device's pending transactions without stopping the editor that accepts input. */
function holdDeviceStorage() {
  const storage = stand.laptop.storage as unknown as { tail: Promise<unknown> };
  const previous = storage.tail;
  let release!: () => void;
  storage.tail = new Promise<void>(resolve => { release = resolve; }).then(() => previous);
  return release;
}

async function spin(ms = 0) {
  await act(async () => {
    if (ms) jest.advanceTimersByTime(ms);
    for (let i = 0; i < 3000; i++) {
      await Promise.resolve();
      if (i % 300 === 0) jest.advanceTimersByTime(0);
    }
  });
}

/** A terminated page loses everything except the transactions already committed at that instant. */
async function coldRestartOffline() {
  const committed = new DeviceStorage();
  for (const [name, rows] of stand.laptop.storage.databases) committed.databases.set(name, new Map(rows));
  stand.laptop.goOffline();
  stand.leave();
  (stand.laptop as unknown as { storage: DeviceStorage }).storage = committed;
  await reloadPage();
  return jest.spyOn(stand.laptop.transport, 'send');
}

async function reconnect() {
  await act(async () => { await stand.laptop.goOnline(); });
  await finish();
}

describe('navigation while a note capture is waiting for local storage', () => {
  it.each(['existing', 'new'] as const)('saves the earlier and later words of a %s note', async kind => {
    if (kind === 'new') stand.routeId = 'new';
    await start(kind === 'new' ? '' : original);
    const sends = jest.spyOn(stand.laptop.transport, 'send');
    const id = stand.autosave.noteId;
    const resource = { collection: 'studyNotes', id };
    const first = kind === 'new' ? 'Firstword' : original + ' Firstword';
    if (kind === 'new') expect(id).not.toBe('new');
    act(() => insert(kind === 'new' ? 'Firstword' : ' Firstword'));
    await settle();

    const release = holdDeviceStorage();
    try {
      await spin(1000);
      expect(sends).not.toHaveBeenCalled();
      act(() => insert(' Secondword'));
      stand.leave();
    } finally {
      release();
    }
    await finish();

    expect((await noteValue(resource))?.content).toBe(first + ' Secondword');
    if (kind === 'new') expect(sends.mock.calls.filter(([command]) => command.kind === 'create')).toHaveLength(1);
    await stand.reopen(id);
    expect(hasNoteQuestion()).toBe(false);
  });

  it('keeps words appended after choosing the local version while that choice is being delivered', async () => {
    await start();
    act(() => insert(' Laptopword'));
    await phoneSave(original + ' Phoneword');
    await finish();
    expect(hasNoteQuestion()).toBe(true);

    const send = stand.laptop.transport.send.bind(stand.laptop.transport);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const firstChoice = jest.spyOn(stand.laptop.transport, 'send').mockImplementationOnce(async command => {
      await held;
      return send(command);
    });
    try {
      const workspace = within(document.querySelector('[data-note-workspace]') as HTMLElement);
      fireEvent.click(workspace.getByRole('button', { name: /^(dataSync\.useLocalVersion|freshness\.conflictKeepMine|dataSync\.keepLocal)$/ }));
      await waitFor(() => expect(firstChoice).toHaveBeenCalledTimes(1));
      expect(await stored()).toBe(original + ' Phoneword');
      act(() => insert(' Afterword'));
      stand.leave();
    } finally {
      release();
    }

    await finish();
    expect(await stored()).toBe(original + ' Laptopword Afterword');
    await stand.reopen();
    expect(hasNoteQuestion()).toBe(false);
  });
});

describe('restarting with committed drafts and interrupted delivery', () => {
  it('submits an existing note draft that was stored before the autosave timer', async () => {
    await start();
    const sendsBeforeCrash = jest.spyOn(stand.laptop.transport, 'send');
    act(() => insert(' Firstword'));
    await settle();
    expect(stand.session?.state?.durable).toBe(true);
    expect(sendsBeforeCrash).not.toHaveBeenCalled();

    const commands = await coldRestartOffline();
    expect(await stored()).toBe(original);
    expect(commands).not.toHaveBeenCalled();

    await reconnect();

    expect(await stored()).toBe(original + ' Firstword');
    expect(commands).toHaveBeenCalledTimes(1);
    expect(hasNoteQuestion()).toBe(false);
  });

  it('keeps the new note address and submits its durable words once after reconnecting', async () => {
    stand.routeId = 'new';
    await start('');
    const id = stand.autosave.noteId;
    expect(id).not.toBe('new');
    const resource = { collection: 'studyNotes', id };
    act(() => insert('Words before interruption'));
    await settle();
    expect(stand.session?.state?.durable).toBe(true);
    expect(await noteValue(resource)).toBeNull();

    const commands = await coldRestartOffline();
    expect(commands).not.toHaveBeenCalled();
    await reconnect();

    expect((await noteValue(resource))?.content).toBe('Words before interruption');
    expect(commands.mock.calls.filter(([command]) => command.kind === 'create' && command.resource.id === id)).toHaveLength(1);
    await stand.remount(id);
    expect(hasNoteQuestion()).toBe(false);
  });

  it.each([
    { first: 'title', title: 'Laptop title', content: original + ' Afterword' },
    { first: 'body', title: 'Original', content: original + ' Firstword Afterword' },
    { first: 'both', title: 'Laptop title', content: original + ' Firstword Afterword' },
  ])('resumes $first and any later words after the captured request answers', async ({ first, title, content }) => {
    await start();
    stand.laptop.goOffline();
    await act(async () => {
      if (first !== 'body') typeTitle(title);
      if (first !== 'title') insert(' Firstword');
    });
    await settle();
    await settle(1000);
    expect(stand.session?.status?.phase).toBe('queued');
    expect(Object.keys(stand.session?.state?.checkpoint.pending ?? {})).toHaveLength(1);

    act(() => insert(' Afterword'));
    await settle();
    expect(stand.session?.state?.durable).toBe(true);
    expect(stand.session?.data?.content).toBe(content);

    const commands = await coldRestartOffline();
    expect(await stored()).toBe(original);
    expect(commands).not.toHaveBeenCalled();
    await reconnect();

    expect(await noteValue()).toEqual(expect.objectContaining({ title, content }));
    expect(commands).toHaveBeenCalledTimes(2);
    expect(hasNoteQuestion()).toBe(false);
  });

  it('recovers a title and the last durable word after the app was hidden', async () => {
    await start();
    typeTitle('Laptop title');
    await settle();
    act(() => {
      insert(' Hiddenword');
      stand.laptop.run(() => stand.laptop.engine.setVisible(false));
    });
    await settle();
    expect(stand.session?.state?.durable).toBe(true);
    expect(await stored()).toBe(original);

    const commands = await coldRestartOffline();
    await reconnect();

    expect(await noteValue()).toEqual(expect.objectContaining({ title: 'Laptop title', content: original + ' Hiddenword' }));
    expect(commands).toHaveBeenCalledTimes(1);
    expect(hasNoteQuestion()).toBe(false);
  });

  it('holds both copies through restart when the two devices changed the same words', async () => {
    await start();
    act(() => insert(' Laptopword'));
    await settle();
    const phone = original + ' Phoneword';
    await phoneSave(phone);
    await finish();
    expect(hasNoteQuestion()).toBe(true);
    expect(await stored()).toBe(phone);
    expect(stand.autosave.content).toBe(original + ' Laptopword');

    const commands = await coldRestartOffline();
    await reconnect();

    expect(hasNoteQuestion()).toBe(true);
    expect(await stored()).toBe(phone);
    expect(stand.autosave.content).toBe(original + ' Laptopword');
    expect(commands).not.toHaveBeenCalled();
  });
});
