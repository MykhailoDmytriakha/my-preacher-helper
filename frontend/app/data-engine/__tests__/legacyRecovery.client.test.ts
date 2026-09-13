import { discoverLegacyRecovery, exportLegacyRecovery } from '../legacyRecovery.client';

const entry = { id: 'old', uid: 'owner', collection: 'sermons', docId: 'sermon', aggregate: 'core', patch: { title: 'my title' }, expectedBaseline: { title: 'old' }, baseRevision: 1, status: 'migration-required', savedAt: 20 };

describe('legacy recovery discovery', () => {
  beforeEach(() => localStorage.clear());
  it('exports the exact original bytes, including baseline and unknown fields, without importing or deleting', () => {
    const raw = JSON.stringify({ ...entry, unknownLegacyField: { retained: true } }, null, 3);
    localStorage.setItem('outbox:v1:old', raw);
    const [source] = discoverLegacyRecovery('owner', { resource: { collection: 'sermons', id: 'sermon' } });
    expect(source).toMatchObject({ importable: false, reason: 'incomplete-original-document', payload: entry });
    expect(exportLegacyRecovery(source, 'owner')).toBe(raw);
    expect(localStorage.getItem(source.id)).toBe(raw);
    expect(() => exportLegacyRecovery(source, 'other')).toThrow('ownership');
  });
  it('never infers a full baseline from a schema-shaped field baseline or semantic aggregates', () => {
    localStorage.setItem('outbox:v1:old', JSON.stringify({ ...entry, expectedBaseline: { userId: 'owner', title: 'old', verse: '', thoughts: [], date: '2026-09-12' }, merge: { kind: 'applyScratch', base: { outline: {}, scratch: [] } } }));
    expect(discoverLegacyRecovery('owner')[0].importable).toBe(false);
  });
  it('filters owner, resource and malformed records before returning contents', () => {
    localStorage.setItem('outbox:v1:old', JSON.stringify(entry));
    localStorage.setItem('outbox:v1:other', JSON.stringify({ ...entry, id: 'other', uid: 'other' }));
    localStorage.setItem('outbox:v1:wrong-key', JSON.stringify(entry));
    localStorage.setItem('outbox:v1:bad', '{');
    localStorage.setItem('outbox:v1:primitive', 'true');
    localStorage.setItem('unrelated', 'secret');
    expect(discoverLegacyRecovery('owner')).toHaveLength(1);
    expect(discoverLegacyRecovery('owner', { resource: { collection: 'groups', id: 'sermon' } })).toEqual([]);
    expect(discoverLegacyRecovery('owner', { resource: { collection: 'sermons', id: 'other' } })).toEqual([]);
    expect(() => discoverLegacyRecovery('owner:ambiguous')).toThrow('Ambiguous');
  });
  it('keeps drafts separate until the owning feature explicitly supplies their collection mapping', () => {
    localStorage.setItem('draft:v1:owner:sermon:preparation', JSON.stringify({ value: { text: 'unsent' }, savedAt: 10 }));
    localStorage.setItem('draft:v1:other:sermon:preparation', JSON.stringify({ value: 'foreign' }));
    localStorage.setItem('draft:v1:owner:missing-separator', '{}');
    localStorage.setItem('draft:v1:owner::note', JSON.stringify({ value: 'invalid' }));
    localStorage.setItem('draft:v1:owner:sermon:', JSON.stringify({ value: 'invalid' }));
    localStorage.setItem('draft:v1:owner:sermon:malformed', JSON.stringify({ savedAt: 0 }));
    const resource = { collection: 'sermons', id: 'sermon' };
    expect(discoverLegacyRecovery('owner')).toEqual([expect.objectContaining({ kind: 'draft', resource: null, importable: false })]);
    expect(discoverLegacyRecovery('owner', { resource })).toEqual([]);
    expect(discoverLegacyRecovery('owner', { resource, draftAggregates: ['preparation'] })[0].resource).toEqual(resource);
  });
  it('surfaces storage failures, skips vanished entries and sorts unknown dates deterministically', () => {
    expect(() => discoverLegacyRecovery('owner', { storage: { length: 1, key: () => { throw new Error('unavailable'); }, getItem: () => null } })).toThrow('unavailable');
    expect(discoverLegacyRecovery('owner', { storage: { length: 1, key: () => 'outbox:v1:old', getItem: () => null } })).toEqual([]);
    localStorage.setItem('outbox:v1:old', JSON.stringify(entry));
    localStorage.setItem('draft:v1:owner:a:note', JSON.stringify({ value: 'a' }));
    localStorage.setItem('draft:v1:owner:b:note', JSON.stringify({ value: 'b' }));
    expect(discoverLegacyRecovery('owner').map(source => source.documentId)).toEqual(['a', 'b', 'sermon']);
  });
});
