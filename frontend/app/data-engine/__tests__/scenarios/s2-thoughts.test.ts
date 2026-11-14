/** @jest-environment node */
import { DeviceWorld, sermonRef, sermonValue } from '@test-utils/deviceWorld';

describe('S2: I add one thought on my phone and another on my laptop while offline', () => {
  let world: DeviceWorld;
  afterEach(() => world?.dispose());

  it.each(['phone-first', 'laptop-first'])('keeps both additions without asking me (%s)', async arrival => {
    world = new DeviceWorld(); await world.seed(sermonRef, sermonValue());
    const phone = await world.device('phone', 60_000), laptop = await world.device('laptop', -120_000);
    await phone.open(sermonRef); await laptop.open(sermonRef);
    phone.goOffline(); laptop.goOffline();
    await phone.sleep(60_000);
    expect(phone.clock.capture('owner')).toBeUndefined();
    await phone.addThought(sermonRef, 't1', 'Thought from my phone');
    await phone.leave(sermonRef);
    await world.advance(3 * 60 * 60_000);
    await laptop.addThought(sermonRef, 't2', 'Thought from my laptop');
    for (const device of arrival === 'phone-first' ? [phone, laptop] : [laptop, phone]) await device.goOnline();
    await phone.open(sermonRef);
    await phone.refresh(sermonRef); await laptop.refresh(sermonRef);
    for (const value of [(await world.snapshot(sermonRef)).value, phone.shown(sermonRef).draft, laptop.shown(sermonRef).draft, phone.shown(sermonRef).confirmed.value, laptop.shown(sermonRef).confirmed.value]) {
      expect(value?.thoughts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 't1', text: 'Thought from my phone' }), expect.objectContaining({ id: 't2', text: 'Thought from my laptop' })]));
      expect(value?.thoughts).toHaveLength(2);
    }
    expect(await world.questions()).toEqual([]);
    expect(world.history()).toEqual([]);
  });
});
