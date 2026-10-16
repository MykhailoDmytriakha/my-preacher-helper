import { serviceOrderSeedId } from '@/utils/serviceOrderSeedIdentity';
import { advanceResourceSnapshot } from '../protocol';
import { planDataCommand, type RelationFilter, type RelationReader } from '../serverRelations';
import { DataSession } from '../session';

import type { DocumentData, ResourceRef, ResourceSnapshot } from '../types';

const owner = 'owner';
const resource = (id: string): ResourceRef => ({ collection: 'serviceOrders', id });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function order(id: string, catalogKey?: string): DocumentData {
  return {
    userId: owner,
    title: catalogKey ? `Standard ${catalogKey}` : `Custom ${id}`,
    ...(catalogKey ? { catalogKey } : {}),
    steps: [],
    rank: 1000,
    createdAt: '2026-10-16T00:00:00.000Z',
    updatedAt: '2026-10-16T00:00:00.000Z',
  };
}

const absent = (id: string): ResourceSnapshot => ({ resource: resource(id), value: null, metadata: null });
const key = (ref: ResourceRef) => `${ref.collection}/${ref.id}`;

function readerFor(rows: Map<string, ResourceSnapshot>): RelationReader {
  return {
    get: async ref => clone(rows.get(key(ref)) ?? { resource: ref, value: null, metadata: null }),
    list: async (collection, limit, filter?: RelationFilter) => [...rows.values()]
      .filter(row => row.resource.collection === collection && row.value !== null)
      .filter(row => {
        if (!filter) return true;
        const actual = row.value?.[filter.field];
        return filter.operator === 'array-contains'
          ? Array.isArray(actual) && actual.includes(filter.value)
          : actual === filter.value;
      })
      .slice(0, limit)
      .map(clone),
  };
}

function preparedCreate(id: string, operationId: string, value: DocumentData) {
  const session = new DataSession(absent(id));
  session.edit(value);
  const command = session.prepare(operationId, owner);
  if (!command) throw new Error('Expected a create command');
  return { session, command };
}

describe('standard service-order seed planning', () => {
  it('accepts a second capture of the same resource without replacing fields edited after the first ACK', async () => {
    const id = serviceOrderSeedId('owner', 'funeral');
    const original = { ...order(id, 'funeral'), steps: [{ id: 'template-device-one', title: 'Default one' }] };
    const otherTemplate = { ...original, steps: [{ id: 'template-device-two', title: 'Default two' }] };
    const first = preparedCreate(id, 'seed-device-one', original);
    const second = preparedCreate(id, 'seed-device-two', otherTemplate);
    const rows = new Map<string, ResourceSnapshot>();
    const reader = readerFor(rows);

    // Both devices captured the same absent resource before either request was acknowledged.
    const firstPlan = await planDataCommand(first.command, absent(id), reader);
    expect(firstPlan.result.kind).toBe('acknowledged');
    firstPlan.writes.forEach(snapshot => rows.set(key(snapshot.resource), clone(snapshot)));

    // A preacher edits the accepted rite before the delayed second create arrives.
    const accepted = rows.get(key(resource(id)))!;
    const current = advanceResourceSnapshot(accepted, {
      ...accepted.value!,
      title: 'Funeral service, edited on the phone',
      steps: [{ id: 'step-authored', title: 'Welcome', body: 'Keep this wording', scriptureRefs: [] }],
      rank: 9300,
    }, 'preacher-edit', ['title', 'steps', 'rank']);
    rows.set(key(current.resource), current);

    const secondPlan = await planDataCommand(second.command, current, reader);
    expect(secondPlan.result.kind).toBe('acknowledged');
    expect(secondPlan.writes).toHaveLength(1);
    expect(secondPlan.writes[0].value).toEqual(current.value);
    expect(secondPlan.writes[0].metadata).toMatchObject({
      operationId: 'seed-device-two',
      generation: current.metadata?.generation,
      revision: (current.metadata?.revision ?? 0) + 1,
      deleted: false,
    });
    secondPlan.writes.forEach(snapshot => rows.set(key(snapshot.resource), clone(snapshot)));
    second.session.accept(secondPlan.result);

    expect(second.session.checkpoint()).toMatchObject({
      dirty: false,
      conflicts: [],
      confirmed: { value: current.value },
      draft: current.value,
    });
    expect(rows.get(key(resource(id)))?.value).toEqual(current.value);
    expect(rows.get(key(resource(id)))?.metadata?.operationId).toBe('seed-device-two');
  });

  it('refuses a duplicate live catalog rite without writing or replacing another resource', async () => {
    const rows = new Map<string, ResourceSnapshot>();
    const existing = { resource: resource('legacy-funeral'), value: order('legacy-funeral', 'funeral'),
      metadata: { protocol: 1 as const, generation: 'legacy', revision: 4, deleted: false } };
    rows.set(key(existing.resource), existing);
    const reader = readerFor(rows);

    const duplicate = preparedCreate('new-funeral-copy', 'seed-duplicate', order('new-funeral-copy', 'funeral'));
    const duplicatePlan = await planDataCommand(duplicate.command, absent('new-funeral-copy'), reader);
    expect(duplicatePlan.result.kind).toBe('refused');
    expect(duplicatePlan.writes).toEqual([]);
    expect([...rows.values()].filter(row => row.value?.catalogKey === 'funeral')).toHaveLength(1);
    expect(rows.has('serviceOrders/new-funeral-copy')).toBe(false);
    expect(rows.get(key(existing.resource))).toEqual(existing);
  });

  it('allows a missing rite beside more than one hundred unrelated custom rites', async () => {
    const rows = new Map<string, ResourceSnapshot>();
    for (let index = 0; index < 125; index += 1) {
      const custom = { resource: resource(`custom-${index}`), value: order(`custom-${index}`),
        metadata: { protocol: 1 as const, generation: `custom-${index}`, revision: 1, deleted: false } };
      rows.set(key(custom.resource), custom);
    }
    const reader = readerFor(rows);
    const missing = preparedCreate('new-wedding', 'seed-wedding', order('new-wedding', 'wedding'));
    const missingPlan = await planDataCommand(missing.command, absent('new-wedding'), reader);
    expect(missingPlan.result.kind).toBe('acknowledged');
    expect(missingPlan.writes).toHaveLength(1);
    expect(missingPlan.writes[0].value?.catalogKey).toBe('wedding');
  });

  it('keeps a deleted prior resource deleted while permitting an explicit new resource cycle', async () => {
    const oldId = serviceOrderSeedId('owner', 'funeral');
    const deleted: ResourceSnapshot = {
      resource: resource(oldId), value: null,
      metadata: { protocol: 1, generation: 'old-generation', revision: 2, deleted: true },
    };
    const rows = new Map([[key(deleted.resource), deleted]]);
    const oldSession = new DataSession(deleted);
    oldSession.edit(order(oldId, 'funeral'));
    expect(() => oldSession.prepare('delayed-seed', owner)).toThrow('Deleted documents require a new copy');
    expect(rows.get(key(deleted.resource))).toEqual(deleted);

    // This earlier create captured absence before the deletion reached its device.
    const delayed = preparedCreate(oldId, 'delayed-old-seed', order(oldId, 'funeral'));
    const delayedPlan = await planDataCommand(delayed.command, deleted, readerFor(rows));
    expect(delayedPlan.result.kind).toBe('deleted');
    expect(delayedPlan.writes).toEqual([]);

    const newId = serviceOrderSeedId('owner', 'funeral', 1);
    const next = preparedCreate(newId, 'explicit-new-cycle', order(newId, 'funeral'));
    const plan = await planDataCommand(next.command, absent(newId), readerFor(rows));
    expect(plan.result.kind).toBe('acknowledged');
    expect(plan.writes[0].resource.id).toBe(newId);
    expect(rows.get(key(deleted.resource))).toEqual(deleted);
  });

  it('keeps a custom create without catalog identity as an ordinary create', async () => {
    const rows = new Map<string, ResourceSnapshot>();
    const custom = preparedCreate('custom-home-visit', 'custom-create', order('custom-home-visit'));
    const plan = await planDataCommand(custom.command, absent('custom-home-visit'), readerFor(rows));

    expect(plan.result.kind).toBe('acknowledged');
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0].value).not.toHaveProperty('catalogKey');
  });
});
