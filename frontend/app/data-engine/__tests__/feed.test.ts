import { collectionHeadRef, feedVersion } from '../feed';
import { validateCommand } from '../protocol';

it('shares unambiguous owner/collection identities without exposing a client writer', () => {
  const resource = collectionHeadRef('owner', 'sermons');
  expect(resource).toEqual({ collection: '_dataEngineHeads', id: '["owner","sermons"]' });
  expect(collectionHeadRef('owner', 'groups')).not.toEqual(resource);
  expect(collectionHeadRef('other', 'sermons')).not.toEqual(resource);
  expect(() => collectionHeadRef('../owner', 'sermons')).toThrow();
  expect(() => collectionHeadRef('owner', '_dataEngineHeads')).toThrow();
  expect(() => collectionHeadRef('owner', 'unknown')).toThrow();
  expect(() => validateCommand({ protocol: 1, owner: 'owner', resource, operationId: 'operation', generation: null, dependsOn: [], kind: 'create', value: {} })).toThrow('read-only');
});

it('rejects unsafe or backwards-compatible ambiguous feed cursors', () => {
  expect(feedVersion(0)).toBe(0); expect(feedVersion(42)).toBe(42);
  for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null]) expect(() => feedVersion(invalid)).toThrow();
});

it('allows owner-scoped derived feeds without allowing direct share-link writes', () => {
  expect(collectionHeadRef('owner', 'studyNoteShareLinks').id).toBe('["owner","studyNoteShareLinks"]');
  expect(() => validateCommand({ protocol: 1, owner: 'owner', resource: { collection: 'studyNoteShareLinks', id: 'link' }, operationId: 'operation', generation: null, dependsOn: [], kind: 'create', value: {} })).toThrow('read-only');
});
