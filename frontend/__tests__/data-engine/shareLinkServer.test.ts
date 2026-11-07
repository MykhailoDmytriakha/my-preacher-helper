/** @jest-environment node */
import { inMemoryRelationReader } from '@test-utils/inMemoryRelationReader';

import { planDataCommand } from '@/data-engine/serverRelations';

import type { DataCommand, ResourceSnapshot } from '@/data-engine/types';

const owner = 'owner';
const records = new Map<string, ResourceSnapshot>();
const key = (snapshot: ResourceSnapshot) => `${snapshot.resource.collection}/${snapshot.resource.id}`;
const absent = (id: string): ResourceSnapshot => ({ resource: { collection: 'studyNoteShareLinks', id }, value: null, metadata: null });
const note = (): ResourceSnapshot => ({ resource: { collection: 'studyNotes', id: 'note' },
  value: { userId: owner, content: 'Keep these words' }, metadata: { protocol: 1, generation: 'note-generation', revision: 2, deleted: false } });
const reader = inMemoryRelationReader(owner, resource => records.get(`${resource.collection}/${resource.id}`)
  ?? { resource, value: null, metadata: null }, () => records.values());
const create = (id = 'first', shareRevocation: string | null = null): DataCommand => ({ protocol: 1, owner, operationId: `create-${id}`,
  resource: absent(id).resource, generation: null, dependsOn: [], kind: 'relation', relation: 'share-link-create',
  note: { id: 'note', generation: 'note-generation', shareRevocation }, authorLanguage: 'ru',
} as unknown as DataCommand);
const revoke = (current: ResourceSnapshot, operationId = 'revoke'): DataCommand => ({ protocol: 1, owner, operationId,
  resource: current.resource, generation: current.metadata?.generation ?? null, dependsOn: [], kind: 'relation', relation: 'share-link-revoke',
} as unknown as DataCommand);
const execute = async (command: DataCommand) => {
  const current = records.get(`${command.resource.collection}/${command.resource.id}`) ?? { resource: command.resource, value: null, metadata: null };
  const result = await planDataCommand(command, current, reader);
  for (const write of result.writes) records.set(key(write), write);
  return result;
};
const link = (id = 'first') => records.get(`studyNoteShareLinks/${id}`)!;

beforeEach(() => { records.clear(); const value = note(); records.set(key(value), value); });

describe('server-owned share capability planning', () => {
  it('creates one server token without changing the authored note', async () => {
    const original = structuredClone(note());
    const plan = await execute(create());
    expect(plan.result.kind).toBe('acknowledged');
    expect(plan.writes).toHaveLength(1);
    expect(link()).toMatchObject({ value: { ownerId: owner, noteId: 'note', authorLanguage: 'ru', viewCount: 0, token: expect.any(String), createdAt: expect.any(String) },
      metadata: { generation: 'create-first', operationId: 'create-first', revision: 1, deleted: false } });
    expect(records.get('studyNotes/note')).toEqual(original);
  });

  it('revokes the exact capability and permits a new explicit creation with a different token', async () => {
    expect((await execute(create())).result.kind).toBe('acknowledged');
    const first = structuredClone(link());
    expect((await execute(revoke(first))).result.kind).toBe('acknowledged');
    expect(link()).toMatchObject({ value: null, metadata: { deleted: true, operationId: 'revoke' } });
    expect(records.get('studyNotes/note')).toMatchObject({ value: note().value,
      metadata: { generation: 'note-generation', revision: 3, shareRevocation: 'revoke' } });
    expect((await execute(create('second', 'revoke'))).result.kind).toBe('acknowledged');
    expect(link('second').value?.token).not.toEqual(first.value?.token);
    expect((await execute(revoke(first, 'later-revoke-first'))).result.kind).toBe('acknowledged');
    expect(link('second').value?.token).toBeTruthy();
    expect(records.get('studyNotes/note')?.metadata?.shareRevocation).toBe('revoke');
    expect(link()).toMatchObject({ value: null, metadata: { deleted: true } });
  });

  it('refuses a first delivery captured before a later link was created and revoked', async () => {
    const earlier = create('held');
    expect((await execute(create('later'))).result.kind).toBe('acknowledged');
    expect((await execute(revoke(link('later')))).result.kind).toBe('acknowledged');

    const result = await execute(earlier);

    expect(result).toEqual({ result: { kind: 'refused', operationId: earlier.operationId, code: 'share-link-review-required' }, writes: [] });
    expect(link('held')).toBeUndefined();
    expect(link('later').value).toBeNull();
  });

  it('retains a legacy pending creation without treating missing evidence as current access', async () => {
    const modern = create('legacy');
    if (modern.kind !== 'relation' || modern.relation !== 'share-link-create') throw new Error('Expected create');
    delete modern.note.shareRevocation;
    expect(await execute(modern)).toMatchObject({ result: { kind: 'refused', code: 'share-link-review-required' }, writes: [] });
  });

  it('permits revoking an owned legacy link even when its note now belongs to another owner', async () => {
    const legacy = { ...absent('legacy'), value: { ownerId: owner, noteId: 'note', token: 'legacy-token', createdAt: 'created', viewCount: 3 } };
    records.set(key(legacy), legacy);
    records.get('studyNotes/note')!.value!.userId = 'other';
    expect(await execute(revoke(legacy))).toMatchObject({ result: { kind: 'acknowledged', snapshot: { value: null } } });
    expect(records.get('studyNotes/note')?.metadata?.shareRevocation).toBeUndefined();
  });

  it('gives a second explicit creation an alias proof for the existing active link, without minting another capability', async () => {
    expect((await execute(create())).result.kind).toBe('acknowledged');
    const first = structuredClone(link());
    const plan = await execute(create('second'));
    expect(plan.result).toMatchObject({ kind: 'acknowledged', snapshot: { value: null, metadata: { deleted: true, operationId: 'create-second' } },
      affected: [{ resource: first.resource, metadata: { operationId: 'create-second' } }] });
    expect(link('second').value).toBeNull();
    expect(link().value).toEqual(first.value);
  });

  it('can revoke a legacy capability and remembers an absent exact target as a tombstone', async () => {
    const legacy = { resource: absent('legacy').resource, value: { ownerId: owner, noteId: 'note', token: 'legacy-token', createdAt: 'created', viewCount: 3 }, metadata: null };
    records.set(key(legacy), legacy);
    expect((await execute(revoke(legacy))).result.kind).toBe('acknowledged');
    expect(link('legacy')).toMatchObject({ value: null, metadata: { deleted: true } });
    expect((await execute(revoke(absent('never-seen'), 'absent-revoke'))).result.kind).toBe('acknowledged');
    expect(link('never-seen')).toMatchObject({ value: null, metadata: { deleted: true } });
  });

  it.each(['missing', 'deleted', 'foreign', 'stale-generation'])('refuses creation from a %s note without exposing any write', async variant => {
    const current = records.get('studyNotes/note')!;
    if (variant === 'missing') records.delete('studyNotes/note');
    if (variant === 'deleted') { current.value = null; current.metadata!.deleted = true; }
    if (variant === 'foreign') current.value!.userId = 'other';
    if (variant === 'stale-generation') current.metadata!.generation = 'replacement';
    const plan = await execute(create());
    expect(plan.result.kind).toBe('refused');
    expect(plan.writes).toEqual([]);
  });

  it('refuses an occupied target ID and an ambiguous pair of active legacy capabilities', async () => {
    expect((await execute(create())).result.kind).toBe('acknowledged');
    expect((await execute(create())).result.kind).toBe('refused');
    const duplicate = structuredClone(link()); duplicate.resource.id = 'duplicate'; duplicate.value!.token = 'another-token';
    records.set(key(duplicate), duplicate);
    expect(await execute(create('third'))).toMatchObject({ result: { kind: 'refused', code: 'ambiguous-share-links' }, writes: [] });
  });

  it('refuses a revocation for another owner or another live generation', async () => {
    expect((await execute(create())).result.kind).toBe('acknowledged');
    const snapshot = link();
    const old = revoke(snapshot);
    snapshot.metadata!.generation = 'replacement';
    expect(await execute(old)).toMatchObject({ result: { kind: 'refused', code: 'generation-mismatch' }, writes: [] });
    snapshot.value!.ownerId = 'other';
    expect(await execute(revoke(snapshot))).toMatchObject({ result: { kind: 'refused', code: 'permission-denied' }, writes: [] });
  });
});
