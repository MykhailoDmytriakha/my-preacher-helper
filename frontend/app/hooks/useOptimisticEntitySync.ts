import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  loadOptimisticEntityRecords,
  saveOptimisticEntityRecords,
} from "@/utils/optimisticEntityStore";

import type {
  OptimisticEntityOperation,
  OptimisticEntityRecord,
  OptimisticEntityStatus,
} from "@/models/optimisticEntities";
import type { OptimisticEntitySyncState } from "@/models/optimisticEntities";

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_LOCAL_ID_PREFIX = "local-entity-";

interface CreateRecordParams<TEntity extends { id: string }> {
  entityId: string;
  operation: OptimisticEntityOperation;
  entity: TEntity;
  snapshot?: TEntity;
  status?: OptimisticEntityStatus;
}

interface UseOptimisticEntitySyncParams<TEntity extends { id: string }> {
  entityType: string;
  scopeId: string | null;
  ttlMs?: number;
  localIdPrefix?: string;
  persistence?: {
    loadRecords?: (
      entityType: string,
      scopeId: string
    ) => Promise<OptimisticEntityRecord<TEntity>[]>;
    saveRecords?: (
      entityType: string,
      scopeId: string,
      records: OptimisticEntityRecord<TEntity>[]
    ) => Promise<void>;
  };
}

export function useOptimisticEntitySync<TEntity extends { id: string }>({
  entityType,
  scopeId,
  ttlMs = DEFAULT_TTL_MS,
  localIdPrefix = DEFAULT_LOCAL_ID_PREFIX,
  persistence,
}: UseOptimisticEntitySyncParams<TEntity>) {
  const [records, setRecords] = useState<OptimisticEntityRecord<TEntity>[]>([]);
  const recordsRef = useRef(records);

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  const persistRecords = useCallback(
    (next: OptimisticEntityRecord<TEntity>[]) => {
      if (!scopeId) return;
      const saveRecords = persistence?.saveRecords ?? saveOptimisticEntityRecords;
      void saveRecords(entityType, scopeId, next);
    },
    [entityType, persistence?.saveRecords, scopeId]
  );

  const updateRecords = useCallback(
    (
      updater: (
        prev: OptimisticEntityRecord<TEntity>[]
      ) => OptimisticEntityRecord<TEntity>[]
    ) => {
      setRecords((prev) => {
        const next = updater(prev);
        recordsRef.current = next;
        persistRecords(next);
        return next;
      });
    },
    [persistRecords]
  );

  const buildLocalId = useCallback(() => {
    return `${localIdPrefix}${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }, [localIdPrefix]);

  const createRecord = useCallback(
    (params: CreateRecordParams<TEntity>) => {
      if (!scopeId) return null;

      const now = new Date();
      const record: OptimisticEntityRecord<TEntity> = {
        localId: buildLocalId(),
        entityType,
        scopeId,
        entityId: params.entityId,
        operation: params.operation,
        status: params.status ?? "pending",
        entity: params.entity,
        snapshot: params.snapshot,
        createdAt: now.toISOString(),
        lastAttemptAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      };

      updateRecords((prev) => [...prev, record]);
      return record;
    },
    [buildLocalId, entityType, scopeId, ttlMs, updateRecords]
  );

  const updateRecord = useCallback(
    (
      localId: string,
      updater: (
        record: OptimisticEntityRecord<TEntity>
      ) => OptimisticEntityRecord<TEntity>
    ) => {
      updateRecords((prev) =>
        prev.map((record) => (record.localId === localId ? updater(record) : record))
      );
    },
    [updateRecords]
  );

  const markRecordStatus = useCallback(
    (
      localId: string,
      status: OptimisticEntityStatus,
      options?: { error?: string; resetExpiry?: boolean; successAt?: string }
    ) => {
      updateRecord(localId, (record) => {
        const now = new Date();
        const shouldResetExpiry =
          options?.resetExpiry ?? (status === "pending" || status === "sending");
        return {
          ...record,
          status,
          lastError: options?.error,
          successAt: options?.successAt ?? record.successAt,
          lastAttemptAt: shouldResetExpiry ? now.toISOString() : record.lastAttemptAt,
          expiresAt: shouldResetExpiry
            ? new Date(now.getTime() + ttlMs).toISOString()
            : record.expiresAt,
        };
      });
    },
    [ttlMs, updateRecord]
  );

  const replaceRecordEntity = useCallback(
    (
      localId: string,
      entity: TEntity,
      options?: { entityId?: string; snapshot?: TEntity }
    ) => {
      updateRecord(localId, (record) => ({
        ...record,
        entityId: options?.entityId ?? record.entityId,
        entity,
        snapshot: options?.snapshot ?? record.snapshot,
      }));
    },
    [updateRecord]
  );

  const removeRecord = useCallback(
    (localId: string) => {
      updateRecords((prev) => prev.filter((record) => record.localId !== localId));
    },
    [updateRecords]
  );

  const getRecordByLocalId = useCallback((localId: string) => {
    return recordsRef.current.find((record) => record.localId === localId);
  }, []);

  const getLatestRecordByEntityId = useCallback((entityId: string) => {
    const matches = recordsRef.current.filter((record) => record.entityId === entityId);
    return matches[matches.length - 1];
  }, []);

  const syncStateById = useMemo<Record<string, OptimisticEntitySyncState>>(() => {
    return records.reduce<Record<string, OptimisticEntitySyncState>>((acc, record) => {
      acc[record.entityId] = {
        status: record.status === "sending" ? "pending" : record.status,
        operation: record.operation,
        expiresAt: record.expiresAt,
        lastError: record.lastError,
        successAt: record.successAt,
      };
      return acc;
    }, {});
  }, [records]);

  useEffect(() => {
    let active = true;

    if (!scopeId) {
      recordsRef.current = [];
      setRecords([]);
      return;
    }

    const loadRecords = persistence?.loadRecords ?? loadOptimisticEntityRecords;

    loadRecords(entityType, scopeId).then((loaded) => {
      if (!active) return;
      const normalized = loaded.map((record) =>
        record.status === "sending" ? { ...record, status: "error" as const } : record
      );
      recordsRef.current = normalized;
      setRecords(normalized);
      persistRecords(normalized);
    });

    return () => {
      active = false;
    };
  }, [entityType, persistRecords, persistence?.loadRecords, scopeId]);

  return {
    records,
    syncStateById,
    buildLocalId,
    createRecord,
    updateRecord,
    markRecordStatus,
    replaceRecordEntity,
    removeRecord,
    getRecordByLocalId,
    getLatestRecordByEntityId,
  };
}
