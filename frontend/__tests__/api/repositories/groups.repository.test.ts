/** @jest-environment node */
import { GroupsRepository } from '@/api/repositories/groups.repository';
import { adminDb } from '@/config/firebaseAdminConfig';
import { legacyRepositoryFixture } from './legacyRepositoryFixture';
jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), runTransaction: jest.fn() } }));
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (...values: unknown[]) => ({ _op: 'increment', values }) } }));
const repository = new GroupsRepository();
let fixture: ReturnType<typeof legacyRepositoryFixture>;
const group = () => ({ userId: 'owner', title: 'Group' });
const series = () => ({ userId: 'owner', items: [{ id: 'g-item', type: 'group', refId: 'g' }, { id: 's-item', type: 'sermon', refId: 's' }], sermonIds: ['s'], rev: { items: 2 } });
beforeEach(() => { jest.clearAllMocks(); fixture = legacyRepositoryFixture(adminDb); });
it('hydrates legacy defaults and normalizes flow; filters undefined updates', async () => {
  expect(await repository.fetchGroupById('missing')).toBeNull();
  fixture.records.set('groups/g', { ...group(), flow: [{ id: 'later', templateId: 't', order: 9 }, { id: 'first', templateId: 't', order: 1 }, { id: 'bad' }] });
  expect(await repository.fetchGroupById('g')).toMatchObject({ templates: [], meetingDates: [], status: 'draft', flow: [{ id: 'first', order: 1 }, { id: 'later', order: 2 }] });
  expect(await repository.updateGroup('g', { title: 'New', description: undefined })).toMatchObject({ title: 'New' });
  expect(fixture.records.get('groups/g')).not.toHaveProperty('description');
  await expect(repository.updateGroup('missing', {})).rejects.toThrow('not found');
  await repository.updateGroupSeriesInfo('g', 'series', 2);
  expect(fixture.records.get('groups/g')).toMatchObject({ seriesId: 'series', seriesPosition: 2 });
  await repository.updateGroupSeriesInfo('g', undefined as never, undefined as never);
});
it('deletes the group and detaches only owned matching series in one transaction', async () => {
  fixture.records.set('groups/g', group()); fixture.records.set('series/mixed', series());
  fixture.records.set('series/foreign', { ...series(), userId: 'other' });
  await repository.deleteGroup('g', 'owner');
  expect(fixture.records.has('groups/g')).toBe(false);
  expect(fixture.records.get('series/mixed')).toMatchObject({ items: [{ refId: 's' }], sermonIds: ['s'], seriesKind: 'sermon', rev: { items: 3 } });
  expect(fixture.records.get('series/foreign')?.items).toHaveLength(2);
  await repository.deleteGroup('missing', 'owner');
});
it.each([null, {}, { deleted: true }])('rejects protected group edits, linkage and deletion: %j', async marker => {
  fixture.records.set('groups/g', { ...group(), _dataEngine: marker });
  for (const action of [() => repository.updateGroup('g', { title: 'New' }), () => repository.updateGroupSeriesInfo('g', null, null), () => repository.deleteGroup('g', 'owner')]) await expect(action()).rejects.toMatchObject({ code: 'data-engine-required' });
});
it('refuses a protected series participant and racing migration without deleting the group', async () => {
  fixture.records.set('groups/g', group()); fixture.records.set('series/mixed', series());
  fixture.race(() => fixture.records.set('series/mixed', { ...series(), _dataEngine: null }));
  await expect(repository.deleteGroup('g', 'owner')).rejects.toMatchObject({ code: 'data-engine-required' });
  expect(fixture.attempts()).toBe(2); expect(fixture.records.has('groups/g')).toBe(true);
});
it('rejects foreign primary ownership and oversized owner scans before any effects', async () => {
  fixture.records.set('groups/g', group());
  await expect(repository.deleteGroup('g', 'other')).rejects.toMatchObject({ code: 'permission-denied' });
  for (let i = 0; i < 100; i++) fixture.records.set(`series/${i}`, series());
  await expect(repository.deleteGroup('g', 'owner')).rejects.toMatchObject({ code: 'data-engine-required' }); expect(fixture.records.size).toBe(101);
});
