import { getResourcePolicy } from '@/data-engine/protocol';

import type { RelationReader } from '@/data-engine/serverRelations';
import type { ResourceRef, ResourceSnapshot } from '@/data-engine/types';

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Mirror the server reader contract: select owned matches before applying its result limit. */
export function inMemoryRelationReader(owner: string, read: (resource: ResourceRef) => ResourceSnapshot | Promise<ResourceSnapshot>,
  rows: () => Iterable<ResourceSnapshot>): RelationReader {
  return {
    get: async resource => copy(await read(resource)),
    list: async (collection, limit, filter, select) => {
      const { ownerField } = getResourcePolicy(collection);
      return copy([...rows()].filter(snapshot => snapshot.resource.collection === collection
        && (ownerField === 'id' ? snapshot.resource.id === owner : snapshot.value?.[ownerField] === owner))
        .filter(snapshot => !filter || (filter.operator === 'array-contains'
          ? Array.isArray(snapshot.value?.[filter.field]) && (snapshot.value![filter.field] as string[]).includes(filter.value)
          : snapshot.value?.[filter.field] === filter.value))
        .filter(snapshot => !select || select(snapshot)).slice(0, limit));
    },
  };
}
