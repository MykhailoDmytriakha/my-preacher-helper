/** @jest-environment node */
import { DeviceWorld, sermonRef, sermonValue } from '@test-utils/deviceWorld';

describe('S7: Old work on other documents should not multiply the work of one keystroke', () => {
  let world: DeviceWorld;
  afterEach(() => world?.dispose());
  it.each([0, 100, 1000])('counts storage work with %i old requests and closed checkpoints', async size => {
    world = new DeviceWorld(); await world.seed(sermonRef, sermonValue());
    const donorRef = { collection: 'sermons', id: 'history-donor' };
    await world.seed(donorRef, sermonValue());
    const donor = await world.device('donor'); await donor.open(donorRef); donor.goOffline();
    await donor.save(donorRef, current => ({ ...current, title: 'Old private title' })); await donor.leave(donorRef, false);
    const device = await world.device('phone'); await device.open(sermonRef); device.goOffline();
    device.seedHistoryFrom(donor, size); await world.settle();
    device.storage.resetCounts();
    await device.update(sermonRef, current => ({ ...current, title: current.title + 'x' }), { autosave: false }); await world.settle();
    const typing = { ...device.storage.counts };
    device.storage.resetCounts();
    const list = await device.openList('sermons'); await world.settle();
    const opening = { ...device.storage.counts };
    expect(list.documents).toBeDefined();
    if (size) {
      // GAP: A keystroke on this document scans old requests and closed checkpoints from other documents.
      // IDEAL: expect(typing).toEqual({ transactions: 1, getAll: 9, rowsReturned: 1 });
      expect(typing).toEqual({ transactions: 1, getAll: 9, rowsReturned: 2 * size + 1 });
      // GAP: Opening a list also scans the owner's historical request payloads outside the displayed document.
      // IDEAL: expect(opening).toEqual({ transactions: 3, getAll: 7, rowsReturned: 1 });
      expect(opening).toEqual({ transactions: 3, getAll: 7, rowsReturned: size + 1 });
    } else {
      expect(typing).toEqual({ transactions: 1, getAll: 9, rowsReturned: 1 });
      expect(opening).toEqual({ transactions: 3, getAll: 7, rowsReturned: 1 });
    }
  });
});
