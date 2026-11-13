/** @jest-environment node */
import { DeviceWorld, noteRef, noteValue, sermonRef, sermonValue } from '@test-utils/deviceWorld';

const group = { collection: 'groups', id: 'group-x' };
const groupValue = { userId: 'owner', title: 'Original', status: 'active', templates: [], flow: [], createdAt: '2026-08-01', updatedAt: '2026-08-01' };

describe('S1: I return to my phone after using only my laptop for ninety days', () => {
  let world: DeviceWorld;
  afterEach(() => world?.dispose());
  it.each(['clean', 'old-autosave', 'unsent-long-typing'] as const)('%s', async variant => {
    world = new DeviceWorld();
    await world.seed(group, groupValue); await world.seed(noteRef, noteValue()); await world.seed(sermonRef, sermonValue());
    const phone = await world.device('phone'), laptop = await world.device('laptop');
    for (const device of [phone, laptop]) for (const ref of [group, noteRef, sermonRef]) await device.open(ref);
    await phone.update(group, current => ({ ...current, title: 'Phone synced title' }), { groupTitle: true }); await world.advance(750);
    await laptop.refresh(group);
    phone.goOffline();
    if (variant === 'old-autosave') {
      await phone.update(group, current => ({ ...current, title: 'Old phone title' }), { groupTitle: true });
      await world.advance(750);
    }
    if (variant === 'unsent-long-typing') await phone.update(noteRef, current => ({ ...current, content: 'Unsent phone words from ninety days ago' }), { autosave: false });
    // An abrupt page loss preserves device storage without flushing private typing.
    await phone.reload();
    for (let day = 1; day <= 90; day++) {
      await world.advance(24 * 60 * 60_000);
      if (day % 3 === 0) {
        await laptop.refresh(group);
        await laptop.update(group, current => ({ ...current, title: `Laptop title ${day}` }), { groupTitle: true }); await world.advance(750);
        await laptop.save(noteRef, current => ({ ...current, content: `Laptop long words ${day}` }));
        await laptop.save(sermonRef, current => ({ ...current, date: new Date(world.now).toISOString().slice(0, 10) }));
      }
    }
    await phone.goOnline();
    for (const ref of [group, noteRef, sermonRef]) { await phone.open(ref); await phone.refresh(ref); await laptop.refresh(ref); }
    const actual = { questions: await world.questions(), title: phone.shown(group).draft?.title,
      content: phone.shown(noteRef).draft?.content, date: phone.shown(sermonRef).draft?.date,
      serverTitle: (await world.snapshot(group)).value?.title, history: world.history(group) };
    expect(actual).toMatchObject({ title: 'Laptop title 90', serverTitle: 'Laptop title 90', content: 'Laptop long words 90', date: '2027-02-10',
      questions: variant === 'unsent-long-typing' ? [{ device: 'phone', document: 'studyNotes/note-x', kind: 'recovery', fields: ['content'] }] : [] });
    for (const device of [phone, laptop]) {
      expect(device.shown(group).confirmed.value?.title).toBe('Laptop title 90');
      expect(device.shown(noteRef).confirmed.value?.content).toBe('Laptop long words 90');
      expect(device.shown(sermonRef).confirmed.value?.date).toBe('2027-02-10');
    }
    if (variant === 'old-autosave') expect(actual.history).toEqual([expect.objectContaining({ title: 'Old phone title', winnerTitle: 'Laptop title 90' })]);
    else expect(actual.history).toEqual([]);
    if (variant === 'unsent-long-typing') {
      const copies = await phone.run(() => phone.engine.listRecoverable(noteRef));
      expect(copies.map(copy => copy.record.checkpoint.draft?.content)).toEqual(['Unsent phone words from ninety days ago']);
    }
  });
});
