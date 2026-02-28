import { get, set } from "idb-keyval";

import type { OptimisticEntityRecord } from "@/models/optimisticEntities";

const OPTIMISTIC_ENTITY_KEY_PREFIX = "optimistic-entities:";
const hasIndexedDb = typeof indexedDB !== "undefined";
const memoryStore = new Map<string, unknown[]>();

const getKey = (entityType: string, scopeId: string) =>
  `${OPTIMISTIC_ENTITY_KEY_PREFIX}${entityType}:${scopeId}`;

export const loadOptimisticEntityRecords = async <TEntity extends { id: string }>(
  entityType: string,
  scopeId: string
): Promise<OptimisticEntityRecord<TEntity>[]> => {
  const key = getKey(entityType, scopeId);
  if (!hasIndexedDb) {
    return (memoryStore.get(key) as OptimisticEntityRecord<TEntity>[] | undefined) ?? [];
  }

  const stored = await get<OptimisticEntityRecord<TEntity>[]>(key);
  return Array.isArray(stored) ? stored : [];
};

export const saveOptimisticEntityRecords = async <TEntity extends { id: string }>(
  entityType: string,
  scopeId: string,
  records: OptimisticEntityRecord<TEntity>[]
): Promise<void> => {
  const key = getKey(entityType, scopeId);
  if (!hasIndexedDb) {
    memoryStore.set(key, records);
    return;
  }

  await set(key, records);
};
