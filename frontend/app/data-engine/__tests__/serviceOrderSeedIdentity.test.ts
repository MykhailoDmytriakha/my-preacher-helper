import { nextServiceOrderSeedId, serviceOrderSeedCycle, serviceOrderSeedId } from '@/utils/serviceOrderSeedIdentity';
import { validateCommand } from '../protocol';

import type { ResourceSnapshot } from '../types';

it('keeps owner, catalog key and canonical cycle in one identity rule', () => {
  for (const owner of ['owner', 'owner:funeral', 'reader@example.com']) {
    for (const cycle of [0, 1, 12, 12345]) {
      const id = serviceOrderSeedId(owner, 'funeral', cycle);
      expect(serviceOrderSeedCycle(owner, 'funeral', id)).toBe(cycle);
      expect(serviceOrderSeedCycle(owner, 'wedding', id)).toBeNull();
      expect(serviceOrderSeedCycle(owner + 'other', 'funeral', id)).toBeNull();
    }
  }
  for (const suffix of ['', '-1', '01', '1.5', '1e2', 'NaN', '9007199254740992']) {
    expect(serviceOrderSeedCycle('owner', 'funeral', serviceOrderSeedId('owner', 'funeral').slice(0, -1) + suffix)).toBeNull();
  }
});

it('advances only past this owner and catalog tombstones, preserving unrelated history', () => {
  const tombstone = (id: string, collection = 'serviceOrders'): ResourceSnapshot => ({ resource: { collection, id }, value: null,
    metadata: { protocol: 1, generation: 'deleted-generation', revision: 3, deleted: true } });
  const history = [tombstone(serviceOrderSeedId('owner', 'funeral', 0)), tombstone(serviceOrderSeedId('owner', 'funeral', 2)),
    tombstone(serviceOrderSeedId('other', 'funeral', 9)), tombstone(serviceOrderSeedId('owner', 'wedding', 9)),
    tombstone(serviceOrderSeedId('owner', 'funeral', 9), 'studyNotes')];
  expect(nextServiceOrderSeedId('owner', 'funeral', history)).toBe(serviceOrderSeedId('owner', 'funeral', 3));
  expect(nextServiceOrderSeedId('owner', 'wedding', [])).toBe(serviceOrderSeedId('owner', 'wedding', 0));
});

it('validates the explicit seed identity and writable value at the wire boundary', () => {
  const valid = { protocol: 1, owner: 'owner', operationId: 'seed', resource: { collection: 'serviceOrders', id: serviceOrderSeedId('owner', 'funeral') },
    generation: null, dependsOn: [], kind: 'relation', relation: 'service-order-seed', value: { userId: 'owner', catalogKey: 'funeral', title: 'Funeral', steps: [], rank: 1000, createdAt: 'c', updatedAt: 'u' } };
  expect(validateCommand(valid)).toEqual(valid);
  for (const invalid of [{ ...valid, generation: 'existing' }, { ...valid, owner: 'other' },
    { ...valid, resource: { ...valid.resource, id: 'random-id' } },
    { ...valid, value: { ...valid.value, catalogKey: 'unknown' } },
    { ...valid, value: { ...valid.value, arbitraryPrivilege: true } }]) {
    expect(() => validateCommand(invalid)).toThrow();
  }
});

it.each(['wedding', undefined])('reserves a standard target from a mismatched catalog %s', catalogKey => {
  const command = { protocol: 1, owner: 'owner', operationId: 'generic-create',
    resource: { collection: 'serviceOrders', id: serviceOrderSeedId('owner', 'funeral') },
    generation: null, dependsOn: [], kind: 'create', value: { userId: 'owner', title: 'Different rite',
      ...(catalogKey ? { catalogKey } : {}), steps: [], rank: 1000, createdAt: 'c', updatedAt: 'u' } };
  expect(() => validateCommand(command)).toThrow();
});

it('produces route-safe identities for every supported owner spelling', () => {
  for (const owner of ['owner', 'reader@example.com', 'preacher:phone', '\u041c\u0438\u0445\u0430\u0438\u043b']) {
    const id = serviceOrderSeedId(owner, 'funeral', 1);
    expect(encodeURIComponent(id)).toBe(id);
  }
});
