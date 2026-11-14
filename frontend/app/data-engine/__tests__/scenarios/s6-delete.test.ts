/** @jest-environment node */
import { DeviceWorld, noteRef, noteValue, sermonRef, sermonValue } from '@test-utils/deviceWorld';

describe('S6: I delete on my phone and edit on my laptop', () => {
  let world: DeviceWorld;
  afterEach(() => world?.dispose());
  for (const kind of ['title', 'date', 'content'] as const) for (const action of ['delete-later', 'edit-later'] as const) it.each(['delete-first', 'edit-first'])(`${kind}, ${action}, %s`, async arrival => {
    const editValue = kind === 'date' ? '2026-12-01' : 'Laptop words';
    const resource = kind === 'content' ? noteRef : sermonRef;
    world = new DeviceWorld(); await world.seed(resource, kind === 'content' ? noteValue() : sermonValue());
    const phone = await world.device('phone'), laptop = await world.device('laptop');
    await phone.open(resource); await laptop.open(resource); phone.goOffline(); laptop.goOffline();
    const edit = async () => kind === 'title' ? laptop.saveField(resource, kind, editValue) : laptop.save(resource, current => ({ ...current, [kind]: editValue }));
    if (action === 'delete-later') { await edit(); await world.advance(60_000); await phone.remove(resource); }
    else { await phone.remove(resource); await world.advance(60_000); await edit(); }
    for (const device of arrival === 'delete-first' ? [phone, laptop] : [laptop, phone]) await device.goOnline();
    await phone.refresh(resource); await laptop.refresh(resource);
    const actual = { server: (await world.snapshot(resource)).value, phone: phone.shown(resource).draft, laptop: laptop.shown(resource).draft, questions: await world.questions(), history: world.history(resource) };
    // Delete requests carry no action-time interval. Neither action order proves a winner to the engine.
    // The retained edit/deletion intent and an explicit question satisfy the unknown-order rule.
    expect(actual.history).toEqual([]);
    expect(actual.phone).toBeNull();
    expect(actual.laptop?.[kind]).toBe(editValue);
    if (arrival === 'delete-first') {
      expect(actual.server).toBeNull();
      expect(actual.questions).toEqual([{ device: 'laptop', document: `${resource.collection}/${resource.id}`, kind: 'deleted', fields: [kind] },
        ...(kind === 'title' ? [{ device: 'laptop', document: `${resource.collection}/${resource.id}`, kind: 'manual:deleted', fields: [kind] }] : [])]);
      expect(phone.shown(resource).confirmed.value).toBeNull();
      expect(laptop.shown(resource).remote?.value).toBeNull();
    } else {
      expect(actual.server?.[kind]).toBe(editValue);
      expect(actual.questions).toEqual([{ device: 'phone', document: `${resource.collection}/${resource.id}`, kind: 'conflict', fields: ['$document'] }]);
      expect(laptop.shown(resource).confirmed.value?.[kind]).toBe(editValue);
      expect(phone.shown(resource).remote?.value?.[kind]).toBe(editValue);
    }
  });
});
