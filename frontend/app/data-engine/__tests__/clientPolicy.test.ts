import { assertLegacyClientWriteAllowed, isCollectionOnEngine, isDataEngineEnabled } from '../clientPolicy';
import { ENGINE_OWNED_COLLECTIONS } from '../engineOwnedCollections';

const enabled = process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED, collections = process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
// Never a real collection, so the tests hold while the owned list grows.
const UNLISTED = 'collectionNobodyOwns';
afterEach(() => {
  if (enabled === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED; else process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED = enabled;
  if (collections === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; else process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = collections;
});
it('refuses legacy replay only for the migrated collection with a terminal upgrade result', () => {
  process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED = 'false'; process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = ' users, studyNoteShareLinks ';
  expect(isDataEngineEnabled()).toBe(true); expect(isCollectionOnEngine('users')).toBe(true);
  expect(() => assertLegacyClientWriteAllowed('users')).toThrow(expect.objectContaining({ code: 'data-engine-required', status: 426 }));
  expect(() => assertLegacyClientWriteAllowed(UNLISTED)).not.toThrow();
});
it('keeps an engine-owned collection on the engine with no switch set, and the global switch still covers the rest', () => {
  delete process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED; delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
  expect(ENGINE_OWNED_COLLECTIONS.length).toBeGreaterThan(0);
  expect(isDataEngineEnabled()).toBe(true);
  for (const owned of ENGINE_OWNED_COLLECTIONS) {
    expect(isCollectionOnEngine(owned)).toBe(true);
    expect(() => assertLegacyClientWriteAllowed(owned)).toThrow(expect.objectContaining({ code: 'data-engine-required', status: 426 }));
  }
  expect(() => assertLegacyClientWriteAllowed(UNLISTED)).not.toThrow();
  process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED = 'true';
  expect(() => assertLegacyClientWriteAllowed(UNLISTED)).toThrow();
});
