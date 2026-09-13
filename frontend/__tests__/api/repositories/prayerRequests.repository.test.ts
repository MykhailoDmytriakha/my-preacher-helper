/** @jest-environment node */
import { PrayerRequestsRepository } from '@/api/repositories/prayerRequests.repository';
import { adminDb } from '@/config/firebaseAdminConfig';
import { legacyRepositoryFixture } from './legacyRepositoryFixture';
jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), runTransaction: jest.fn() } }));
const repository = new PrayerRequestsRepository();
let fixture: ReturnType<typeof legacyRepositoryFixture>;
const payload = () => ({ userId: 'owner', title: 'Prayer', status: 'active' as const, tags: [], updates: [] });
beforeEach(() => { jest.clearAllMocks(); fixture = legacyRepositoryFixture(adminDb); });
it('creates normalized prayers with server or client identity and strips undefined', async () => {
  const created = await repository.create({ ...payload(), description: undefined });
  expect(created).toMatchObject({ id: 'auto-1', status: 'active', updates: [], tags: [], createdAt: expect.any(String) });
  expect(fixture.records.get('prayerRequests/auto-1')).not.toHaveProperty('description');
  expect(await repository.create(payload(), 'client')).toMatchObject({ id: 'client' });
});
it('returns an existing same-owner legacy prayer without overwriting its mutable state', async () => {
  fixture.records.set('prayerRequests/p', { ...payload(), title: 'Edited', status: 'answered', updates: [{ text: 'Update' }] });
  expect(await repository.create(payload(), 'p')).toMatchObject({ title: 'Edited', status: 'answered', updates: [{ text: 'Update' }] });
  expect(fixture.records.get('prayerRequests/p')?.title).toBe('Edited');
});
it.each([null, {}, { deleted: true }])('rejects migrated create collisions including tombstones: %j', async marker => {
  fixture.records.set('prayerRequests/p', { ...payload(), _dataEngine: marker });
  await expect(repository.create(payload(), 'p')).rejects.toMatchObject({ code: 'data-engine-required' });
});
it('rejects foreign collisions and retries when migration wins a create overlap', async () => {
  fixture.records.set('prayerRequests/foreign', { ...payload(), userId: 'other' });
  await expect(repository.create(payload(), 'foreign')).rejects.toMatchObject({ status: 403 });
  fixture.race(() => fixture.records.set('prayerRequests/p', { ...payload(), _dataEngine: null }));
  await expect(repository.create(payload(), 'p')).rejects.toMatchObject({ code: 'data-engine-required' });
  expect(fixture.records.get('prayerRequests/p')).toHaveProperty('_dataEngine', null);
});
