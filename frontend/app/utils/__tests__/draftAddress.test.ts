import { draftAddressKey, draftBelongsToOwner, isDraftAddress, readDraftAddress } from '@/utils/draftAddress';

describe('draft addresses', () => {
  it('keeps the legacy address exact, including aggregate namespaces', () => {
    const address = { owner: 'owner', documentId: 'note', aggregate: 'conflict:outline' };
    expect(draftAddressKey(address)).toBe('draft:v1:owner:note:conflict:outline');
    expect(readDraftAddress(draftAddressKey(address))).toEqual(address);
  });

  it('round-trips every scoped identity without delimiter ambiguity', () => {
    const address = { owner: 'owner:one', documentId: 'note:/%~', aggregate: 'plan:node:%', writerId: 'opening:/%~' };
    expect(readDraftAddress(draftAddressKey(address))).toEqual(address);
    expect(draftAddressKey(address)).not.toBe(draftAddressKey({ ...address, writerId: undefined }));
    expect(draftAddressKey(address)).not.toBe(draftAddressKey({ ...address, writerId: 'other' }));
  });

  it.each(['draft:v2:a:b:c', 'draft:v2:a:b:c:d:e', 'draft:v2:a:b:c:', 'draft:v2:%ZZ:b:c:d',
    'draft:v2:%61:b:c:d', 'draft:v1:a::note', 'draft:v1:a:b:', 'elsewhere:a:b:c'])('rejects malformed or ambiguous address %s', key => {
    expect(readDraftAddress(key)).toBeNull();
    expect(draftBelongsToOwner(key, 'a')).toBe(false);
  });

  it('requires a real scoped writer and matches the exact owner', () => {
    expect(() => draftAddressKey({ owner: 'a', documentId: 'b', aggregate: 'c', writerId: '' })).toThrow();
    expect(draftBelongsToOwner(draftAddressKey({ owner: 'ab', documentId: 'b', aggregate: 'c', writerId: 'd' }), 'a')).toBe(false);
    expect(isDraftAddress('draft:v1:a:b:c')).toBe(true);
    expect(isDraftAddress('draft:v2:a:b:c:d')).toBe(true);
  });
});
