import { validateCommand } from '../protocol';
import { validateResourceDocument } from '../resourceSchemas';

const envelope = {
  protocol: 1,
  operationId: 'share-link-operation',
  owner: 'owner',
  resource: { collection: 'studyNoteShareLinks', id: 'operation-alias' },
  generation: null,
  dependsOn: [],
};

const createCommand = (overrides: Record<string, unknown> = {}) => ({
  ...envelope,
  kind: 'relation',
  relation: 'share-link-create',
  note: { id: 'note', generation: 'note-generation' },
  authorLanguage: 'en',
  ...overrides,
});

const revokeCommand = (overrides: Record<string, unknown> = {}) => ({
  ...envelope,
  kind: 'relation',
  relation: 'share-link-revoke',
  ...overrides,
});

const shareLink = (overrides: Record<string, unknown> = {}) => ({
  ownerId: 'owner',
  noteId: 'note',
  token: 'opaque-token',
  createdAt: '2026-11-02T00:00:00.000Z',
  viewCount: 0,
  ...overrides,
});

it('accepts the exact server-owned share-link create and revoke relation envelopes', () => {
  expect(validateCommand(createCommand())).toMatchObject({ relation: 'share-link-create', note: { id: 'note' }, authorLanguage: 'en' });
  expect(validateCommand(revokeCommand())).toMatchObject({ relation: 'share-link-revoke', generation: null });
  expect(validateCommand(revokeCommand({ generation: 'link-generation' }))).toMatchObject({ generation: 'link-generation' });
});

it('requires the share-link create operation alias to be unversioned', () => {
  expect(() => validateCommand(createCommand({ generation: 'already-exists' }))).toThrow('Invalid share-link creation');
});

it('validates the target note identity and author locale for create', () => {
  expect(() => validateCommand(createCommand({ note: { id: '', generation: null } }))).toThrow('Invalid share-link creation');
  expect(() => validateCommand(createCommand({ note: null }))).toThrow('Invalid share-link creation');
  expect(() => validateCommand(createCommand({ note: { id: 'note', generation: 'bad/generation' } }))).toThrow('Invalid share-link creation');
  expect(() => validateCommand(createCommand({ authorLanguage: 'fr' }))).toThrow('Invalid share-link creation');
});

it('rejects payload fields and nested note fields outside the exact relation contract', () => {
  expect(() => validateCommand(createCommand({ token: 'client-token' }))).toThrow('Unexpected share-link command field');
  expect(() => validateCommand(createCommand({ value: shareLink() }))).toThrow('Unexpected share-link command field');
  expect(() => validateCommand(createCommand({ patch: { token: 'client-token' } }))).toThrow('Unexpected share-link command field');
  expect(() => validateCommand(createCommand({ note: { id: 'note', generation: null, title: 'extra' } }))).toThrow('Invalid share-link creation');
  expect(() => validateCommand(revokeCommand({ note: { id: 'note', generation: null } }))).toThrow('Unexpected share-link command field');
  expect(() => validateCommand(revokeCommand({ token: 'client-token' }))).toThrow('Unexpected share-link command field');
  expect(() => validateCommand(revokeCommand({ value: shareLink() }))).toThrow('Unexpected share-link command field');
  expect(() => validateCommand(revokeCommand({ patch: { revoked: true } }))).toThrow('Unexpected share-link command field');
  expect(() => validateCommand(revokeCommand({ changes: [] }))).toThrow('Unexpected share-link command field');
});

it('keeps generic document writes and unrelated relations read-only for share links', () => {
  expect(() => validateCommand({ ...envelope, kind: 'create', value: shareLink() })).toThrow('The resource is read-only');
  expect(() => validateCommand({ ...envelope, kind: 'update', changes: [{ path: ['token'], before: { exists: false }, after: { exists: true, value: 'x' } }] })).toThrow('The resource is read-only');
  expect(() => validateCommand({ ...envelope, kind: 'delete', baseline: shareLink() })).toThrow('The resource is read-only');
  expect(() => validateCommand({ ...envelope, relation: 'service-order-seed', kind: 'relation', value: {} })).toThrow('The resource is read-only');
});

it('limits both share-link relations to the share-link collection', () => {
  expect(() => validateCommand(createCommand({ resource: { collection: 'studyNotes', id: 'operation-alias' } }))).toThrow('Invalid share-link creation');
  expect(() => validateCommand(revokeCommand({ resource: { collection: 'studyNotes', id: 'operation-alias' } }))).toThrow('Invalid share-link revocation');
});

it('validates the exact share-link document fields while allowing omitted authorLanguage', () => {
  expect(() => validateResourceDocument('studyNoteShareLinks', shareLink(), { kind: 'create' })).not.toThrow();
  expect(() => validateResourceDocument('studyNoteShareLinks', shareLink({ authorLanguage: 'uk' }), { kind: 'create' })).not.toThrow();
  expect(() => validateResourceDocument('studyNoteShareLinks', shareLink({ updatedAt: 'ignored' }), { kind: 'create' })).toThrow('Unknown field in new document');
  expect(() => validateResourceDocument('studyNoteShareLinks', shareLink({ id: 'link-id' }), { kind: 'create' })).toThrow('Unknown field in new document');
});

it('requires nonnegative integer viewCount and a supported optional authorLanguage', () => {
  for (const viewCount of [-1, 1.5]) {
    expect(() => validateResourceDocument('studyNoteShareLinks', shareLink({ viewCount }), { kind: 'create' })).toThrow('Invalid studyNoteShareLinks.viewCount');
  }
  expect(() => validateResourceDocument('studyNoteShareLinks', shareLink({ authorLanguage: 'fr' }), { kind: 'create' })).toThrow('Invalid studyNoteShareLinks.authorLanguage');
});
