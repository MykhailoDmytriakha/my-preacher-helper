/** @jest-environment node */
import { CouncilsRepository } from '@/api/repositories/councils.repository';
import { ServiceOrdersRepository } from '@/api/repositories/serviceOrders.repository';
import { adminDb } from '@/config/firebaseAdminConfig';

import type { CouncilBody } from '@/api/councils/writeSupport';
import type { ServiceOrder } from '@/models/models';

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn(), runTransaction: jest.fn() } }));
const records = new Map<string, Record<string, unknown>>();
const marker = { protocol: 1, generation: 'engine', revision: 1, deleted: false };
const reference = (path: string) => ({ path, id: path.split('/')[1], get: async () => ({ exists: records.has(path), id: path.split('/')[1], data: () => records.get(path) }) });
const snapshot = (ref: ReturnType<typeof reference>) => ({ ref, id: ref.id, exists: records.has(ref.path), data: () => records.get(ref.path) });
let transition: (() => void) | undefined;
let attempts = 0;
beforeEach(() => {
  records.clear(); transition = undefined; attempts = 0;
  jest.mocked(adminDb.collection).mockImplementation(collection => {
    const query = { collection, field: '', value: '', maximum: 1000,
      where: (field: string, _operator: string, value: string) => { query.field = field; query.value = value; return query; },
      limit: (maximum: number) => { query.maximum = maximum; return query; },
      doc: (id: string) => reference(`${collection}/${id}`),
      get: async () => ({ docs: [...records].filter(([path, data]) => path.startsWith(`${collection}/`) && data[query.field] === query.value).map(([path]) => snapshot(reference(path))) }),
    };
    return query as never;
  });
  jest.mocked(adminDb.runTransaction).mockImplementation(async callback => {
    for (;;) {
      attempts++;
      const before = JSON.stringify([...records]);
      const writes: Array<() => void> = [];
      let writing = false;
      const result = await callback({
        get: async (target: any) => {
          if (writing) throw new Error('Reads must precede writes');
          if (!target.collection) return snapshot(target);
          return { docs: [...records].filter(([path, data]) => path.startsWith(`${target.collection}/`) && data[target.field] === target.value)
            .slice(0, target.maximum).map(([path]) => snapshot(reference(path))) };
        },
        create: (ref: ReturnType<typeof reference>, data: Record<string, unknown>) => { writing = true; writes.push(() => records.set(ref.path, data)); },
        set: (ref: ReturnType<typeof reference>, data: Record<string, unknown>) => { writing = true; writes.push(() => records.set(ref.path, data)); },
        delete: (ref: ReturnType<typeof reference>) => { writing = true; writes.push(() => records.delete(ref.path)); },
      } as never);
      const race = transition; transition = undefined; race?.();
      if (before !== JSON.stringify([...records])) continue;
      writes.forEach(write => write());
      return result;
    }
  });
});
const councils = new CouncilsRepository(), orders = new ServiceOrdersRepository();
const body = (): CouncilBody => ({ title: 'Council', status: 'preparing', topics: [], createdAt: 'T', updatedAt: 'T' });
const draft = (catalogKey: 'funeral' | 'wedding'): Omit<ServiceOrder, 'id'> => ({ userId: 'owner', catalogKey, title: catalogKey, steps: [], rank: 1, createdAt: 'T', updatedAt: 'T' });

it('preserves legacy council create replay, CAS rejection, replacement and deletion', async () => {
  expect((await councils.createForOwner('owner', 'c', body())).rev).toBe(0);
  expect((await councils.createForOwner('owner', 'c', { ...body(), title: 'Replay' })).title).toBe('Council');
  const conflict = await councils.replaceForOwner('owner', 'c', { ...body(), title: 'New' }, 1);
  expect(conflict.conflict).toBe(true); expect(records.get('councils/c')?.title).toBe('Council');
  expect((await councils.replaceForOwner('owner', 'c', { ...body(), title: 'New' }, 0)).current.rev).toBe(1);
  await councils.deleteForOwner('owner', 'c'); expect(records.size).toBe(0);
});
it.each([null, {}, marker, { ...marker, deleted: true }])('refuses all council mutations on any marker: %j', async metadata => {
  records.set('councils/c', { ...body(), userId: 'owner', rev: 2, _dataEngine: metadata });
  const before = JSON.stringify([...records]);
  for (const operation of [() => councils.createForOwner('owner', 'c', body()), () => councils.replaceForOwner('owner', 'c', body(), null), () => councils.replaceForOwner('owner', 'c', body(), 0), () => councils.deleteForOwner('owner', 'c')]) await expect(operation()).rejects.toMatchObject({ code: 'data-engine-required' });
  expect(JSON.stringify([...records])).toBe(before);
});
it('retries a legacy council replace against migration and keeps the engine version', async () => {
  records.set('councils/c', { ...body(), userId: 'owner', rev: 0 });
  transition = () => records.set('councils/c', { ...body(), title: 'Engine', userId: 'owner', rev: 1, _dataEngine: marker });
  await expect(councils.replaceForOwner('owner', 'c', body(), 0)).rejects.toMatchObject({ code: 'data-engine-required' });
  expect(attempts).toBe(2); expect(records.get('councils/c')?.title).toBe('Engine');
});
it('does not return foreign council create collisions', async () => {
  records.set('councils/c', { userId: 'other', _dataEngine: marker });
  await expect(councils.createForOwner('owner', 'c', body())).rejects.toMatchObject({ code: 'permission-denied' });
});
it('seeds deterministic missing orders atomically and preserves legacy random-ID catalog entries', async () => {
  records.set('serviceOrders/old-random-id', { ...draft('funeral'), title: 'Edited' });
  const result = await orders.seedMissingForOwner('owner', [draft('funeral'), draft('wedding')]);
  expect(result).toHaveLength(2); expect(records.has('serviceOrders/owner__funeral')).toBe(false);
  expect(records.get('serviceOrders/old-random-id')?.title).toBe('Edited'); expect(records.has('serviceOrders/owner__wedding')).toBe(true);
  expect(await orders.seedMissingForOwner('owner', [draft('funeral'), draft('wedding')])).toHaveLength(2); expect(records.size).toBe(2);
});
it.each([null, {}, marker, { ...marker, deleted: true }])('refuses a protected seed collision without partial creates: %j', async metadata => {
  records.set('serviceOrders/owner__wedding', { userId: 'owner', _dataEngine: metadata });
  await expect(orders.seedMissingForOwner('owner', [draft('funeral'), draft('wedding')])).rejects.toMatchObject({ code: 'data-engine-required' });
  expect(records.size).toBe(1); expect(records.has('serviceOrders/owner__funeral')).toBe(false);
});
it('refuses migrated catalog entries even when their document ID predates deterministic keys', async () => {
  records.set('serviceOrders/random-id', { ...draft('funeral'), _dataEngine: marker });
  await expect(orders.seedMissingForOwner('owner', [draft('funeral'), draft('wedding')])).rejects.toMatchObject({ code: 'data-engine-required' });
  expect(records.size).toBe(1);
});
it('refuses foreign deterministic collisions and skips unrelated tombstones in its reply', async () => {
  records.set('serviceOrders/owner__funeral', { userId: 'other' });
  await expect(orders.seedMissingForOwner('owner', [draft('funeral')])).rejects.toMatchObject({ code: 'permission-denied' });
  records.clear(); records.set('serviceOrders/deleted-custom', { userId: 'owner', _dataEngine: { ...marker, deleted: true } });
  expect(await orders.seedMissingForOwner('owner', [draft('funeral')])).toHaveLength(1);
});
it('refuses oversized seeds and owner scans before partial writes', async () => {
  await expect(orders.seedMissingForOwner('owner', Array.from({ length: 101 }, () => draft('funeral')))).rejects.toMatchObject({ code: 'data-engine-required' });
  for (let i = 0; i < 101; i++) records.set(`serviceOrders/${i}`, { userId: 'owner' });
  await expect(orders.seedMissingForOwner('owner', [draft('funeral')])).rejects.toMatchObject({ code: 'data-engine-required' });
  expect(records.size).toBe(101);
});
it('retries seed ownership reads when migration wins after the first attempt', async () => {
  transition = () => records.set('serviceOrders/owner__wedding', { ...draft('wedding'), _dataEngine: marker });
  await expect(orders.seedMissingForOwner('owner', [draft('funeral'), draft('wedding')])).rejects.toMatchObject({ code: 'data-engine-required' });
  expect(attempts).toBe(2); expect(records.size).toBe(1);
});


it('preserves owner-filtered legacy reads and refusal for missing or foreign council edits', async () => {
  records.set('councils/c', { ...body(), userId: 'owner', rev: 0 });
  records.set('councils/foreign', { ...body(), userId: 'other', rev: 0 });
  records.set('serviceOrders/o', draft('funeral') as unknown as Record<string, unknown>);
  expect(await councils.listForOwner('owner')).toHaveLength(1);
  expect((await councils.getForOwner('owner', 'c'))?.title).toBe('Council');
  expect(await councils.getForOwner('owner', 'foreign')).toBeNull();
  expect(await councils.getForOwner('owner', 'missing')).toBeNull();
  expect(await orders.listForOwner('owner')).toHaveLength(1);
  await expect(councils.replaceForOwner('owner', 'foreign', body(), null)).rejects.toMatchObject({ code: 'not-found' });
  await expect(councils.deleteForOwner('owner', 'missing')).rejects.toMatchObject({ code: 'not-found' });
});
