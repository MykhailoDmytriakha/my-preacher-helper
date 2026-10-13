/** @jest-environment node */
import { StudiesRepository } from '@/api/repositories/studies.repository';
import { adminDb } from '@/config/firebaseAdminConfig';
import { legacyRepositoryFixture } from './legacyRepositoryFixture';

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), runTransaction: jest.fn() } }));
const repository = new StudiesRepository();
let fixture: ReturnType<typeof legacyRepositoryFixture>;
const note = (extra = {}) => ({ userId: 'owner', content: 'Text', materialIds: [], ...extra });
const material = (extra = {}) => ({ userId: 'owner', title: 'Title', type: 'study' as const, noteIds: [] as string[], sections: [], ...extra });
beforeEach(() => { jest.clearAllMocks(); fixture = legacyRepositoryFixture(adminDb); });

it('normalizes missing legacy note fields and reads owned materials with document IDs', async () => {
  expect(await repository.getNote('missing')).toBeNull(); expect(await repository.getMaterial('missing')).toBeNull();
  fixture.records.set('studyNotes/n', note()); fixture.records.set('studyMaterials/m', material());
  expect(await repository.getNote('n')).toMatchObject({ id: 'n', tags: [], scriptureRefs: [], materialIds: [], isDraft: true });
  fixture.records.set('studyNotes/n', note({ tags: ['tag'], scriptureRefs: [{}] }));
  expect(await repository.getNote('n')).toMatchObject({ isDraft: false });
  expect(await repository.listMaterials('owner')).toEqual([{ ...material(), id: 'm' }]);
  expect(await repository.getMaterial('m')).toEqual({ ...material(), id: 'm' });
});
// Notes and materials are written only through the data engine; a tombstone written before
// 2026-09-18 still carries userId and must not come back as a blank live record.
it('treats an engine tombstone as absent in every read', async () => {
  const buried = { userId: 'owner', _dataEngine: { protocol: 1, generation: 'g', revision: 2, deleted: true } };
  fixture.records.set('studyNotes/gone', buried); fixture.records.set('studyMaterials/gone', buried);
  fixture.records.set('studyMaterials/m', material());
  expect(await repository.getNote('gone')).toBeNull();
  expect(await repository.getMaterial('gone')).toBeNull();
  expect((await repository.listMaterials('owner')).map(entry => entry.id)).toEqual(['m']);
});
