/** @jest-environment node */
import { CouncilsRepository } from '@/api/repositories/councils.repository';
import { ServiceOrdersRepository } from '@/api/repositories/serviceOrders.repository';
import { adminDb } from '@/config/firebaseAdminConfig';

import type { Council, ServiceOrder } from '@/models/models';

/**
 * THE SERVER'S READS OF COUNCILS AND ORDERS OF SERVICE. Both collections are written only through
 * the data engine; what is left on the server is reading for a shipped bundle, filtered by owner,
 * and a tombstone is never handed back as a live record.
 */

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: { collection: jest.fn() } }));
const records = new Map<string, Record<string, unknown>>();
const marker = { protocol: 1, generation: 'engine', revision: 1, deleted: false };
const reference = (path: string) => ({ path, id: path.split('/')[1], get: async () => ({ exists: records.has(path), id: path.split('/')[1], data: () => records.get(path) }) });
const snapshot = (ref: ReturnType<typeof reference>) => ({ ref, id: ref.id, exists: records.has(ref.path), data: () => records.get(ref.path) });
beforeEach(() => {
  records.clear();
  jest.mocked(adminDb.collection).mockImplementation(collection => {
    const query = { collection, field: '', value: '',
      where: (field: string, _operator: string, value: string) => { query.field = field; query.value = value; return query; },
      doc: (id: string) => reference(`${collection}/${id}`),
      get: async () => ({ docs: [...records].filter(([path, data]) => path.startsWith(`${collection}/`) && data[query.field] === query.value).map(([path]) => snapshot(reference(path))) }),
    };
    return query as never;
  });
});
const councils = new CouncilsRepository(), orders = new ServiceOrdersRepository();
const body = (): Omit<Council, 'id' | 'userId'> => ({ title: 'Council', status: 'preparing', topics: [], createdAt: 'T', updatedAt: 'T' });
const draft = (catalogKey: 'funeral' | 'wedding'): Omit<ServiceOrder, 'id'> => ({ userId: 'owner', catalogKey, title: catalogKey, steps: [], rank: 1, createdAt: 'T', updatedAt: 'T' });

it('preserves owner-filtered council and order reads, keeping a buried council and order out', async () => {
  records.set('councils/c', { ...body(), userId: 'owner', rev: 0 });
  records.set('councils/foreign', { ...body(), userId: 'other', rev: 0 });
  records.set('serviceOrders/o', draft('funeral') as unknown as Record<string, unknown>);
  records.set('serviceOrders/foreign', { ...draft('wedding'), userId: 'other' } as unknown as Record<string, unknown>);
  // A tombstone written before 2026-09-18 still carries userId and answers the owner query;
  // hydrated, it would be drawn as a blank, editable record that is not in the database.
  records.set('councils/buried', { userId: 'owner', _dataEngine: { ...marker, deleted: true } });
  records.set('serviceOrders/buried', { userId: 'owner', _dataEngine: { ...marker, deleted: true } });
  expect(await councils.listForOwner('owner')).toHaveLength(1);
  expect(await councils.getForOwner('owner', 'buried')).toBeNull();
  expect((await councils.getForOwner('owner', 'c'))?.title).toBe('Council');
  expect(await councils.getForOwner('owner', 'foreign')).toBeNull();
  expect(await councils.getForOwner('owner', 'missing')).toBeNull();
  expect((await orders.listForOwner('owner')).map(order => order.id)).toEqual(['o']);
});
