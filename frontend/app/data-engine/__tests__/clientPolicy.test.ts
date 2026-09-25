import { assertLegacyClientWriteAllowed, isCollectionOnEngine, isDataEngineEnabled } from '../clientPolicy';
const enabled = process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED, collections = process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
afterEach(() => {
  if (enabled === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED; else process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED = enabled;
  if (collections === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; else process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = collections;
});
it('refuses legacy replay only for the migrated collection with a terminal upgrade result', () => {
  process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED = 'false'; process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = ' councils, groups ';
  expect(isDataEngineEnabled()).toBe(true); expect(isCollectionOnEngine('groups')).toBe(true);
  expect(() => assertLegacyClientWriteAllowed('groups')).toThrow(expect.objectContaining({ code: 'data-engine-required', status: 426 }));
  expect(() => assertLegacyClientWriteAllowed('series')).not.toThrow();
});
it('preserves the global switch and the inactive deployment', () => {
  process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED = 'true'; process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = '';
  expect(() => assertLegacyClientWriteAllowed('groups')).toThrow();
  process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED = 'false';
  expect(isDataEngineEnabled()).toBe(false); expect(() => assertLegacyClientWriteAllowed('groups')).not.toThrow();
});
