/** @jest-environment node */
import { DeviceWorld, noteRef, noteValue, type WorldDevice } from '@test-utils/deviceWorld';

describe('Delayed first delivery of note text after a deliberate return', () => {
  let world: DeviceWorld;
  afterEach(() => world?.dispose());

  it('preserves the returned paragraph and the offline words when their order cannot be proved', async () => {
    world = new DeviceWorld();
    const opening = noteValue();
    await world.seed(noteRef, opening);
    const phone = await world.device('phone');
    const computer = await world.device('computer');
    await phone.open(noteRef);
    await computer.open(noteRef);

    phone.goOffline();
    await phone.reload();
    await phone.open(noteRef);
    expect(phone.clock.capture('owner')).toBeUndefined();
    const earlier = 'Earlier offline words';
    await phone.save(noteRef, value => ({ ...value, content: earlier }));

    await world.advance(60_000);
    await computer.save(noteRef, value => ({ ...value, content: 'Later desktop words' }));
    await computer.save(noteRef, value => ({ ...value, content: opening.content }));
    expect((await world.snapshot(noteRef)).value?.content).toBe(opening.content);

    await phone.goOnline();
    expect((await world.snapshot(noteRef)).value?.content).toBe(opening.content);
    expect(phone.shown(noteRef).draft?.content).toBe(earlier);
    expect(await world.questions()).toEqual([expect.objectContaining({
      device: 'phone', document: 'studyNotes/note-x', kind: 'conflict', fields: ['content'],
    })]);
  });

  it.each(['phone first', 'computer first'] as const)
  ('retains the later return regardless of delivery order (%s)', async delivery => {
    world = new DeviceWorld();
    const opening = noteValue();
    const originalWords = String(opening.content);
    await world.seed(noteRef, opening);
    const phone = await world.device('phone', 300_000);
    const computer = await world.device('computer', -300_000);
    const phoneEditor = await phone.open(noteRef);
    const computerEditor = await computer.open(noteRef);
    const metadata = phoneEditor.getState().checkpoint.confirmed.metadata!;
    expect(metadata.revision).toBe(1);

    const edit = async (device: WorldDevice, editor: typeof phoneEditor, before: string, after: string, withTags = false) => {
      const time = device.clock.capture('owner');
      expect(time).toBeDefined();
      const basis = editor.getState().checkpoint.confirmed.metadata!;
      await device.run(async () => {
        const receipt = await editor.commitWithReceipt(value => ({
          ...value, content: after, ...(withTags && { tags: ['Independent tag'] }),
        }), { noteContent: { generation: basis.generation, observedRevision: basis.revision, opening: before, time: time! } });
        expect(receipt.kind).toBe('submitted');
      });
      await world.settle();
    };

    phone.goOffline();
    const earlier = 'Earlier offline text';
    await edit(phone, phoneEditor, originalWords, earlier, true);
    computer.goOffline();
    await world.advance(5_000);
    await edit(computer, computerEditor, originalWords, 'New typing');
    await world.advance(5_000);
    await edit(computer, computerEditor, 'New typing', originalWords);
    for (const device of delivery === 'phone first' ? [phone, computer] : [computer, phone]) await device.goOnline();
    await phone.refresh(noteRef);
    await computer.refresh(noteRef);
    expect((await world.snapshot(noteRef)).value).toMatchObject({ content: originalWords, tags: ['Independent tag'] });
    expect(phone.shown(noteRef).draft?.content).toBe(originalWords);
    expect(computer.shown(noteRef).draft?.content).toBe(originalWords);
    expect(await world.questions()).toEqual([]);
    expect(world.history(noteRef)).toContainEqual(expect.objectContaining({
      fields: [expect.objectContaining({ field: 'content', value: earlier, winnerDigest: expect.any(String) })],
    }));
  });

  it('preserves the raw recording link without confirming a transcript that lost by action time', async () => {
    world = new DeviceWorld();
    const opening = noteValue();
    const original = String(opening.content);
    await world.seed(noteRef, opening);
    const phone = await world.device('phone'), desktop = await world.device('desktop');
    const earlier = await phone.open(noteRef), later = await desktop.open(noteRef);
    const generation = earlier.getState().checkpoint.confirmed.metadata!.generation;
    const time = phone.clock.capture('owner')!;
    expect(time).toBeDefined();
    phone.goOffline();
    await phone.run(() => earlier.commitWithReceipt(value => ({ ...value, content: original + '\n\nDraft transcript',
      recordingSourceIds: ['new-source'], dictationSourceIds: ['new-source'], tags: ['Independent tag'],
    }), { noteContent: { generation, observedRevision: 1, opening: original, time } }));
    await world.advance(5_000);
    const saveDesktop = (before: string, after: string) => {
      const observedRevision = later.getState().checkpoint.confirmed.metadata!.revision;
      return desktop.run(() => later.commitWithReceipt(value => ({ ...value, content: after }),
        { noteContent: { generation, observedRevision, opening: before, time: desktop.clock.capture('owner')! } }));
    };
    await saveDesktop(original, 'Desktop edit');
    await world.advance(5_000);
    await saveDesktop('Desktop edit', original);
    await world.settle();
    await phone.goOnline();
    const saved = (await world.snapshot(noteRef)).value!;
    expect(saved).toMatchObject({ content: original, recordingSourceIds: ['new-source'], tags: ['Independent tag'] });
    expect(saved.dictationSourceIds ?? []).toEqual([]);
    expect(await world.questions()).toEqual([]);
  });


  it('continues the same offline content edit through an intervening title save with no clock', async () => {
    world = new DeviceWorld();
    await world.seed(noteRef, noteValue());
    const device = await world.device('phone');
    await device.open(noteRef);
    device.goOffline();
    await device.reload();
    await device.open(noteRef);
    expect(device.clock.capture('owner')).toBeUndefined();
    await device.save(noteRef, value => ({ ...value, content: 'Offline draft one' }));
    await device.save(noteRef, value => ({ ...value, title: 'Independent title' }));
    await device.save(noteRef, value => ({ ...value, content: 'Offline draft two' }));
    await device.goOnline();
    expect((await world.snapshot(noteRef)).value).toMatchObject({
      content: 'Offline draft two', title: 'Independent title',
    });
    expect(await world.questions()).toEqual([]);
  });

});
