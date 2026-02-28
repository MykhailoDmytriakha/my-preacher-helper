import { get, set } from "idb-keyval";

import { loadOptimisticEntityRecords, saveOptimisticEntityRecords } from "@/utils/optimisticEntityStore";

import type { OptimisticEntityRecord } from "@/models/optimisticEntities";

export type PendingThoughtStatus = "pending" | "error" | "sending" | "success";

export type PendingThoughtSection = "introduction" | "main" | "conclusion";

export interface PendingThoughtRecord {
  localId: string;
  sermonId: string;
  sectionId: PendingThoughtSection;
  text: string;
  tags: string[];
  outlinePointId?: string;
  createdAt: string;
  lastAttemptAt: string;
  expiresAt: string;
  status: PendingThoughtStatus;
  lastError?: string;
}

export interface PendingThoughtEntity {
  id: string;
  sectionId: PendingThoughtSection;
  text: string;
  tags: string[];
  outlinePointId?: string;
}

const PENDING_THOUGHTS_KEY_PREFIX = "pending-thoughts:";
export const PENDING_THOUGHT_ENTITY_TYPE = "thought-structure-create";
export const LOCAL_THOUGHT_PREFIX = "local-";

export const buildLocalThoughtId = () =>
  `${LOCAL_THOUGHT_PREFIX}${Date.now()}-${Math.random().toString(16).slice(2)}`;

const getPendingThoughtsKey = (sermonId: string) => `${PENDING_THOUGHTS_KEY_PREFIX}${sermonId}`;

const hasIndexedDb = typeof indexedDB !== "undefined";
const legacyMemoryStore = new Map<string, PendingThoughtRecord[]>();

const toOptimisticRecord = (
  record: PendingThoughtRecord
): OptimisticEntityRecord<PendingThoughtEntity> => ({
  localId: record.localId,
  entityType: PENDING_THOUGHT_ENTITY_TYPE,
  scopeId: record.sermonId,
  entityId: record.localId,
  operation: "create",
  status: record.status,
  entity: {
    id: record.localId,
    sectionId: record.sectionId,
    text: record.text,
    tags: record.tags,
    outlinePointId: record.outlinePointId,
  },
  createdAt: record.createdAt,
  lastAttemptAt: record.lastAttemptAt,
  expiresAt: record.expiresAt,
  lastError: record.lastError,
});

const toPendingThoughtRecord = (
  record: OptimisticEntityRecord<PendingThoughtEntity>
): PendingThoughtRecord => ({
  localId: record.entityId,
  sermonId: record.scopeId,
  sectionId: record.entity.sectionId,
  text: record.entity.text,
  tags: record.entity.tags,
  outlinePointId: record.entity.outlinePointId,
  createdAt: record.createdAt,
  lastAttemptAt: record.lastAttemptAt,
  expiresAt: record.expiresAt,
  status: record.status,
  lastError: record.lastError,
});

const loadLegacyPendingThoughts = async (sermonId: string): Promise<PendingThoughtRecord[]> => {
  const key = getPendingThoughtsKey(sermonId);
  if (!hasIndexedDb) {
    return legacyMemoryStore.get(key) ?? [];
  }

  const stored = await get<PendingThoughtRecord[]>(key);
  return Array.isArray(stored) ? stored : [];
};

const clearLegacyPendingThoughts = async (sermonId: string): Promise<void> => {
  const key = getPendingThoughtsKey(sermonId);
  if (!hasIndexedDb) {
    legacyMemoryStore.delete(key);
    return;
  }

  await set(key, []);
};

export const loadPendingThoughtOptimisticRecords = async (
  sermonId: string
): Promise<OptimisticEntityRecord<PendingThoughtEntity>[]> => {
  const currentRecords = await loadOptimisticEntityRecords<PendingThoughtEntity>(
    PENDING_THOUGHT_ENTITY_TYPE,
    sermonId
  );

  if (currentRecords.length > 0) {
    return currentRecords;
  }

  const legacyRecords = await loadLegacyPendingThoughts(sermonId);
  if (legacyRecords.length === 0) {
    return [];
  }

  const migratedRecords = legacyRecords.map(toOptimisticRecord);
  await saveOptimisticEntityRecords(PENDING_THOUGHT_ENTITY_TYPE, sermonId, migratedRecords);
  await clearLegacyPendingThoughts(sermonId);
  return migratedRecords;
};

export const savePendingThoughtOptimisticRecords = async (
  sermonId: string,
  records: OptimisticEntityRecord<PendingThoughtEntity>[]
): Promise<void> => {
  await saveOptimisticEntityRecords(PENDING_THOUGHT_ENTITY_TYPE, sermonId, records);
  await clearLegacyPendingThoughts(sermonId);
};

export const loadPendingThoughts = async (
  sermonId: string
): Promise<PendingThoughtRecord[]> => {
  const records = await loadPendingThoughtOptimisticRecords(sermonId);
  return records.map(toPendingThoughtRecord);
};

export const savePendingThoughts = async (
  sermonId: string,
  items: PendingThoughtRecord[]
): Promise<void> => {
  await savePendingThoughtOptimisticRecords(
    sermonId,
    items.map(toOptimisticRecord)
  );
};
