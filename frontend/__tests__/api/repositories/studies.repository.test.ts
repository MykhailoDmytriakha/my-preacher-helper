/** @jest-environment node */
import { StudiesRepository } from '@/api/repositories/studies.repository';
import { adminDb } from '@/config/firebaseAdminConfig';
import { legacyRepositoryFixture } from './legacyRepositoryFixture';

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), runTransaction: jest.fn() } }));
jest.mock('firebase-admin/firestore', () => ({ FieldValue: {
  arrayUnion: (...values: unknown[]) => ({ _op: 'union', values }), arrayRemove: (...values: unknown[]) => ({ _op: 'remove', values }),
} }));
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
it('creates a material and deduplicates owned reverse references atomically', async () => {
  fixture.records.set('studyNotes/a', note()); fixture.records.set('studyNotes/foreign', note({ userId: 'other' }));
  const result = await repository.createMaterial(material({ noteIds: ['a', 'a', 'foreign', 'missing'] }));
  expect(result).toMatchObject({ id: 'auto-1', noteIds: ['a'], createdAt: expect.any(String), updatedAt: expect.any(String) });
  expect(fixture.records.get('studyNotes/a')?.materialIds).toEqual(['auto-1']);
  expect(fixture.records.get('studyNotes/foreign')?.materialIds).toEqual([]);
  expect((await repository.createMaterial(material())).noteIds).toEqual([]);
});
it('updates both relation directions, preserves untouched fields and filters foreign notes', async () => {
  fixture.records.set('studyMaterials/m', material({ noteIds: ['a'], description: 'Keep' }));
  fixture.records.set('studyNotes/a', note({ materialIds: ['m'] })); fixture.records.set('studyNotes/b', note());
  fixture.records.set('studyNotes/foreign', note({ userId: 'other' }));
  expect(await repository.updateMaterial('m', { title: 'New', noteIds: ['b', 'foreign'] }, 'owner')).toMatchObject({ noteIds: ['b'], description: 'Keep', title: 'New' });
  expect(fixture.records.get('studyNotes/a')?.materialIds).toEqual([]); expect(fixture.records.get('studyNotes/b')?.materialIds).toEqual(['m']);
  expect((await repository.updateMaterial('m', { title: 'Again' }, 'owner')).noteIds).toEqual(['b']);
});
it('deletes notes, owned material references and owned share links in one commit', async () => {
  fixture.records.set('studyNotes/n', note()); fixture.records.set('studyMaterials/m', material({ noteIds: ['n', 'keep'] }));
  fixture.records.set('studyMaterials/foreign', material({ userId: 'other', noteIds: ['n'] }));
  fixture.records.set('studyNoteShareLinks/link', { ownerId: 'owner', noteId: 'n' });
  fixture.records.set('studyNoteShareLinks/foreign', { ownerId: 'other', noteId: 'n' });
  fixture.race(() => fixture.records.set('studyMaterials/m', material({ noteIds: ['n', 'keep', 'concurrent'] })));
  await repository.deleteNote('n', 'owner');
  expect(fixture.attempts()).toBe(2); expect(fixture.records.get('studyMaterials/m')?.noteIds).toEqual(['keep', 'concurrent']);
  expect(fixture.records.has('studyNotes/n')).toBe(false); expect(fixture.records.has('studyNoteShareLinks/link')).toBe(false);
  expect(fixture.records.get('studyMaterials/foreign')?.noteIds).toEqual(['n']); expect(fixture.records.has('studyNoteShareLinks/foreign')).toBe(true);
});
it('deletes materials and cleans owned reverse references including legacy omissions', async () => {
  fixture.records.set('studyMaterials/m', material({ noteIds: ['a', 'foreign'] }));
  fixture.records.set('studyNotes/a', note({ materialIds: ['m', 'keep'] })); fixture.records.set('studyNotes/b', note({ materialIds: ['m'] }));
  fixture.records.set('studyNotes/foreign', note({ userId: 'other', materialIds: ['m'] }));
  await repository.deleteMaterial('m', 'owner');
  expect(fixture.records.has('studyMaterials/m')).toBe(false); expect(fixture.records.get('studyNotes/a')?.materialIds).toEqual(['keep']);
  expect(fixture.records.get('studyNotes/b')?.materialIds).toEqual([]); expect(fixture.records.get('studyNotes/foreign')?.materialIds).toEqual(['m']);
  await repository.deleteMaterial('missing', 'owner'); await repository.deleteNote('missing', 'owner');
});
it.each([null, {}, { deleted: true }, { revision: 2 }])('refuses every primary marker shape without mutation: %j', async marker => {
  fixture.records.set('studyMaterials/m', material({ _dataEngine: marker })); fixture.records.set('studyNotes/n', note({ _dataEngine: marker }));
  const before = JSON.stringify([...fixture.records]);
  for (const action of [() => repository.updateMaterial('m', { title: 'New' }, 'owner'), () => repository.deleteMaterial('m', 'owner'), () => repository.deleteNote('n', 'owner')]) await expect(action()).rejects.toMatchObject({ code: 'data-engine-required' });
  expect(JSON.stringify([...fixture.records])).toBe(before);
});
it.each(['create', 'update', 'delete'])('refuses protected note participants during material %s without partial effects', async action => {
  fixture.records.set('studyNotes/n', note({ materialIds: ['m'], _dataEngine: null })); fixture.records.set('studyMaterials/m', material({ noteIds: ['n'] }));
  const before = JSON.stringify([...fixture.records]);
  const request = action === 'create' ? repository.createMaterial(material({ noteIds: ['n'] })) : action === 'update' ? repository.updateMaterial('m', { noteIds: [] }, 'owner') : repository.deleteMaterial('m', 'owner');
  await expect(request).rejects.toMatchObject({ code: 'data-engine-required' }); expect(JSON.stringify([...fixture.records])).toBe(before);
});
it.each(['studyMaterials/m', 'studyNoteShareLinks/link'])('refuses protected note-delete participants: %s', async target => {
  fixture.records.set('studyNotes/n', note()); fixture.records.set('studyMaterials/m', material({ noteIds: ['n'] }));
  fixture.records.set('studyNoteShareLinks/link', { ownerId: 'owner', noteId: 'n' });
  fixture.records.set(target, { ...fixture.records.get(target), _dataEngine: null }); const before = JSON.stringify([...fixture.records]);
  await expect(repository.deleteNote('n', 'owner')).rejects.toMatchObject({ code: 'data-engine-required' }); expect(JSON.stringify([...fixture.records])).toBe(before);
});
it('recomputes material relations after concurrent edits and rejects a racing migration', async () => {
  fixture.records.set('studyMaterials/m', material()); fixture.records.set('studyNotes/n', note());
  fixture.race(() => fixture.records.set('studyMaterials/m', material({ description: 'Concurrent' })));
  expect(await repository.updateMaterial('m', { noteIds: ['n'] }, 'owner')).toMatchObject({ description: 'Concurrent' });
  fixture.race(() => fixture.records.set('studyNotes/n', note({ materialIds: ['m'], _dataEngine: null })));
  await expect(repository.deleteMaterial('m', 'owner')).rejects.toMatchObject({ code: 'data-engine-required' }); expect(fixture.records.has('studyMaterials/m')).toBe(true);
});
it('rejects foreign owners, malformed fields, oversized cascades and failed commits', async () => {
  fixture.records.set('studyMaterials/m', material()); fixture.records.set('studyNotes/n', note());
  await expect(repository.updateMaterial('m', {}, 'other')).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(repository.updateMaterial('m', { userId: 'other' }, 'owner')).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(repository.deleteMaterial('m', 'other')).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(repository.deleteNote('n', 'other')).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(repository.updateMaterial('missing', {})).rejects.toThrow('not found');
  await expect(repository.updateMaterial('m', { id: 'injected' })).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(repository.createMaterial(material({ noteIds: ['bad/id'] }))).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(repository.createMaterial(material({ noteIds: Array.from({ length: 100 }, (_, i) => String(i)) }))).rejects.toMatchObject({ code: 'data-engine-required' });
  fixture.fail(); const before = JSON.stringify([...fixture.records]);
  await expect(repository.updateMaterial('m', { noteIds: ['n'] })).rejects.toThrow('Commit failed'); expect(JSON.stringify([...fixture.records])).toBe(before);
});
it('refuses note cleanup beyond its full cascade budget instead of truncating', async () => {
  fixture.records.set('studyNotes/n', note());
  for (let i = 0; i < 100; i++) fixture.records.set(`studyMaterials/${i}`, material({ noteIds: ['n'] }));
  await expect(repository.deleteNote('n', 'owner')).rejects.toMatchObject({ code: 'data-engine-required' }); expect(fixture.records.size).toBe(101);
});
