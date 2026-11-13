/** @jest-environment node */
import { DeviceWorld, sermonRef, sermonValue } from '@test-utils/deviceWorld';

describe('DeviceWorld control boundaries', () => {
  let world: DeviceWorld;
  afterEach(() => world?.dispose());

  it('isolates three device stores, keeps a captured creation over reload and uses real list/change reads', async () => {
    world = new DeviceWorld();
    const phone = await world.device('phone'), laptop = await world.device('laptop'), tablet = await world.device('tablet');
    phone.goOffline();
    await phone.open(sermonRef, true); await phone.save(sermonRef, () => sermonValue());
    expect((await world.snapshot(sermonRef)).value).toBeNull();
    expect(phone.storage.databases.get('preacher-data-engine-state-v1')?.size).toBeGreaterThan(0);
    expect(laptop.storage.databases.get('preacher-data-engine-state-v1')?.size).toBe(0);
    expect(tablet.storage.databases.get('preacher-data-engine-state-v1')?.size).toBe(0);
    await phone.reload(); expect(phone.clock.capture('owner')).toBeUndefined();
    await phone.goOnline(); await phone.open(sermonRef); await phone.refresh(sermonRef);
    expect((await laptop.openList('sermons')).snapshots[0].value?.title).toBe('Original');
    expect(laptop.clock.capture('owner')).toBeDefined();
    await phone.saveField(sermonRef, 'title', 'New title');
    const changes = await laptop.transport.changes('owner', 'sermons', 1);
    expect(changes).toMatchObject({ cursor: 2, version: 2, hasMore: false, snapshots: [expect.objectContaining({ value: expect.objectContaining({ title: 'New title' }) })] });
    expect(await world.questions()).toEqual([]);
  });

  it('invalidates samples after sleep, wall-clock jumps, reload and twenty-four hours', async () => {
    world = new DeviceWorld(); await world.seed(sermonRef, sermonValue());
    const phone = await world.device('phone', 1_000_000); await phone.open(sermonRef);
    expect(phone.clock.capture('owner')).toEqual({ earliestMs: world.now - 2, latestMs: world.now + 2 });
    phone.goOffline(); await phone.sleep(1000); expect(phone.clock.capture('owner')).toBeUndefined();
    await phone.goOnline(); await phone.refresh(sermonRef); expect(phone.clock.capture('owner')).toBeDefined();
    phone.skew += 51; expect(phone.clock.capture('owner')).toBeUndefined();
    await phone.reload(); expect(phone.clock.capture('owner')).toBeUndefined();
    await phone.refresh(sermonRef); phone.goOffline();
    await world.advance(24 * 60 * 60_000 + 1); expect(phone.clock.capture('owner')).toBeUndefined();
    await expect(phone.transport.read('owner', sermonRef)).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('flushes a last autosave on leaving and bounds a nonquiet settle', async () => {
    world = new DeviceWorld(); await world.seed(sermonRef, sermonValue());
    const phone = await world.device('phone'); await phone.open(sermonRef); phone.goOffline();
    await phone.update(sermonRef, current => ({ ...current, date: '2026-12-01' }));
    await phone.leave(sermonRef); await phone.reload(); await phone.goOnline();
    expect((await world.snapshot(sermonRef)).value?.date).toBe('2026-12-01');
    await expect(world.settle(1)).rejects.toThrow('World did not settle');
    expect(await world.questions()).toEqual([]);
  });
});
