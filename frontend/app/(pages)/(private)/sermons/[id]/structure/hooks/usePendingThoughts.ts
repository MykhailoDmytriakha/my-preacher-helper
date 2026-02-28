import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useOptimisticEntitySync } from "@/hooks/useOptimisticEntitySync";
import { Item, Sermon } from "@/models/models";
import {
  buildLocalThoughtId,
  LOCAL_THOUGHT_PREFIX,
  loadPendingThoughts,
  PendingThoughtEntity,
  PendingThoughtRecord,
  PendingThoughtSection,
  PendingThoughtStatus,
  PENDING_THOUGHT_ENTITY_TYPE,
  savePendingThoughts,
} from "@/utils/pendingThoughtsStore";
import { getCanonicalTagForSection } from "@/utils/tagUtils";

import { buildItemForUI, findOutlinePoint, isLocalThoughtId } from "../utils/structure";

import type { OptimisticEntityRecord } from "@/models/optimisticEntities";

const PENDING_TTL_MS = 30 * 60 * 1000;

export type PendingThoughtInput = {
  sectionId: PendingThoughtSection;
  text: string;
  tags: string[];
  outlinePointId?: string;
};

interface UsePendingThoughtsParams {
  sermonId: string | null;
  sermon: Sermon | null;
  allowedTags: { name: string; color: string }[];
  setContainers: React.Dispatch<React.SetStateAction<Record<string, Item[]>>>;
  containersRef: React.MutableRefObject<Record<string, Item[]>>;
  containers: Record<string, Item[]>;
}

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

export const usePendingThoughts = ({
  sermonId,
  sermon,
  allowedTags,
  setContainers,
  containersRef,
  containers,
}: UsePendingThoughtsParams) => {
  const { t } = useTranslation();
  const loadRecords = useCallback(async (_entityType: string, scopeId: string) => {
    const items = await loadPendingThoughts(scopeId);
    return items.map(toOptimisticRecord);
  }, []);

  const saveRecords = useCallback(
    async (
      _entityType: string,
      scopeId: string,
      records: OptimisticEntityRecord<PendingThoughtEntity>[]
    ) => {
      await savePendingThoughts(scopeId, records.map(toPendingThoughtRecord));
    },
    []
  );

  const pendingSync = useOptimisticEntitySync<PendingThoughtEntity>({
    entityType: PENDING_THOUGHT_ENTITY_TYPE,
    scopeId: sermonId,
    ttlMs: PENDING_TTL_MS,
    localIdPrefix: LOCAL_THOUGHT_PREFIX,
    persistence: {
      loadRecords,
      saveRecords,
    },
  });
  const pendingThoughts = useMemo(
    () => pendingSync.records.map(toPendingThoughtRecord),
    [pendingSync.records]
  );
  const pendingRef = useRef<PendingThoughtRecord[]>(pendingThoughts);

  useEffect(() => {
    pendingRef.current = pendingThoughts;
  }, [pendingThoughts]);

  const buildPendingItem = useCallback((pending: PendingThoughtRecord): Item => {
    const outlinePoint = findOutlinePoint(pending.outlinePointId, sermon);
    const sectionTag = getCanonicalTagForSection(pending.sectionId);
    const item = buildItemForUI({
      id: pending.localId,
      text: pending.text,
      tags: pending.tags,
      allowedTags,
      sectionTag,
      outlinePointId: pending.outlinePointId,
      outlinePoint,
    });

    return {
      ...item,
      syncStatus: pending.status === "sending" ? "pending" : pending.status,
      syncExpiresAt: pending.expiresAt,
      syncLastError: pending.lastError,
    };
  }, [allowedTags, sermon]);

  const upsertPendingInContainers = useCallback((pending: PendingThoughtRecord) => {
    setContainers((prev) => {
      const next = { ...prev };
      let updated = false;
      const section = pending.sectionId;
      const existingIndex = (next[section] || []).findIndex((item) => item.id === pending.localId);
      const pendingItem = buildPendingItem(pending);
      const insertAtOutlineGroupEnd = (items: Item[], item: Item): Item[] => {
        if (!item.outlinePointId) return [...items, item];
        let lastIndex = -1;
        items.forEach((existing, index) => {
          if (existing.outlinePointId === item.outlinePointId) {
            lastIndex = index;
          }
        });
        if (lastIndex === -1) return [...items, item];
        const nextItems = [...items];
        nextItems.splice(lastIndex + 1, 0, item);
        return nextItems;
      };

      const removeFromOtherSections = (current: Record<string, Item[]>) => {
        const sections = ["introduction", "main", "conclusion", "ambiguous"];
        sections.forEach((sec) => {
          if (sec === section) return;
          if (!current[sec]) return;
          const filtered = current[sec].filter((item) => item.id !== pending.localId);
          if (filtered.length !== current[sec].length) {
            current[sec] = filtered;
            updated = true;
          }
        });
      };

      if (existingIndex === -1) {
        const sectionItems = next[section] || [];
        next[section] = insertAtOutlineGroupEnd(sectionItems, pendingItem);
        updated = true;
        removeFromOtherSections(next);
      } else {
        const updatedSection = [...next[section]];
        updatedSection[existingIndex] = pendingItem;
        next[section] = updatedSection;
        updated = true;
        removeFromOtherSections(next);
      }

      if (updated) {
        containersRef.current = next;
        return next;
      }

      return prev;
    });
  }, [buildPendingItem, containersRef, setContainers]);

  const removePendingFromContainers = useCallback((localId: string) => {
    setContainers((prev) => {
      const next = { ...prev };
      let updated = false;
      Object.keys(next).forEach((section) => {
        const filtered = (next[section] || []).filter((item) => item.id !== localId);
        if (filtered.length !== next[section].length) {
          next[section] = filtered;
          updated = true;
        }
      });
      if (updated) {
        containersRef.current = next;
        return next;
      }
      return prev;
    });
  }, [containersRef, setContainers]);

  const replacePendingInContainers = useCallback((localId: string, newItem: Item) => {
    setContainers((prev) => {
      const next = { ...prev };
      let replaced = false;
      Object.keys(next).forEach((section) => {
        const items = next[section] || [];
        const index = items.findIndex((item) => item.id === localId);
        if (index === -1) return;
        const updatedSection = [...items];
        updatedSection[index] = newItem;
        next[section] = updatedSection;
        replaced = true;
      });
      if (replaced) {
        containersRef.current = next;
        return next;
      }
      return prev;
    });
  }, [containersRef, setContainers]);

  const updateItemSyncStatus = useCallback((itemId: string, status?: "pending" | "error" | "success", meta?: { expiresAt?: string; lastError?: string; successAt?: string; operation?: "create" | "update" | "delete" }) => {
    setContainers((prev) => {
      const next = { ...prev };
      let updated = false;
      Object.keys(next).forEach((section) => {
        const items = next[section] || [];
        const index = items.findIndex((item) => item.id === itemId);
        if (index === -1) return;
        const updatedItem: Item = { ...items[index] };
        if (status) {
          updatedItem.syncStatus = status;
          updatedItem.syncOperation = meta?.operation ?? updatedItem.syncOperation;
          updatedItem.syncExpiresAt = meta?.expiresAt ?? updatedItem.syncExpiresAt;
          updatedItem.syncLastError = meta?.lastError;
          updatedItem.syncSuccessAt = meta?.successAt ?? updatedItem.syncSuccessAt;
        } else {
          delete updatedItem.syncStatus;
          delete updatedItem.syncOperation;
          delete updatedItem.syncExpiresAt;
          delete updatedItem.syncLastError;
          delete updatedItem.syncSuccessAt;
        }
        const updatedSection = [...items];
        updatedSection[index] = updatedItem;
        next[section] = updatedSection;
        updated = true;
      });

      if (updated) {
        containersRef.current = next;
        return next;
      }
      return prev;
    });
  }, [containersRef, setContainers]);

  const getPendingById = useCallback((localId: string) => {
    return pendingRef.current.find((item) => item.localId === localId);
  }, []);

  const createPendingThought = useCallback((input: PendingThoughtInput): PendingThoughtRecord | null => {
    if (!sermonId) return null;

    const localId = buildLocalThoughtId();
    const record = pendingSync.createRecord({
      entityId: localId,
      operation: "create",
      entity: {
        id: localId,
        sectionId: input.sectionId,
        text: input.text,
        tags: input.tags,
        outlinePointId: input.outlinePointId,
      },
      status: "pending",
    });

    if (!record) return null;

    const pendingRecord = toPendingThoughtRecord(record);
    upsertPendingInContainers(pendingRecord);
    return pendingRecord;
  }, [pendingSync, sermonId, upsertPendingInContainers]);

  const updatePendingThought = useCallback((localId: string, input: Partial<PendingThoughtInput>) => {
    const record = pendingSync.getLatestRecordByEntityId(localId);
    if (!record) return;

    const updatedEntity: PendingThoughtEntity = {
      ...record.entity,
      sectionId: input.sectionId ?? record.entity.sectionId,
      text: input.text ?? record.entity.text,
      tags: input.tags ?? record.entity.tags,
      outlinePointId: input.outlinePointId ?? record.entity.outlinePointId,
    };

    pendingSync.replaceRecordEntity(record.localId, updatedEntity, {
      entityId: localId,
    });
    upsertPendingInContainers(
      toPendingThoughtRecord({
        ...record,
        entity: updatedEntity,
      })
    );
  }, [pendingSync, upsertPendingInContainers]);

  const markPendingStatus = useCallback((localId: string, status: PendingThoughtStatus, options?: { error?: string; resetExpiry?: boolean }) => {
    const record = pendingSync.getLatestRecordByEntityId(localId);
    if (!record) return;

    pendingSync.markRecordStatus(record.localId, status, {
      error: options?.error,
      resetExpiry: options?.resetExpiry,
    });
  }, [pendingSync]);

  const removePendingThought = useCallback((localId: string, options?: { removeFromContainers?: boolean }) => {
    const record = pendingSync.getLatestRecordByEntityId(localId);
    if (record) {
      pendingSync.removeRecord(record.localId);
    }
    if (options?.removeFromContainers !== false) {
      removePendingFromContainers(localId);
    }
  }, [pendingSync, removePendingFromContainers]);

  const replacePendingThought = useCallback((localId: string, newItem: Item) => {
    replacePendingInContainers(localId, newItem);
  }, [replacePendingInContainers]);

  useEffect(() => {
    if (!pendingThoughts.length) return;
    pendingThoughts.forEach((pending) => {
      if (!isLocalThoughtId(pending.localId)) return;
      upsertPendingInContainers(pending);
    });
  }, [pendingThoughts, upsertPendingInContainers]);

  useEffect(() => {
    if (!pendingThoughts.length) return;
    const current = containersRef.current;
    const hasLocalId = (localId: string) =>
      Object.values(current).some((items) => (items || []).some((item) => item.id === localId));
    pendingThoughts.forEach((pending) => {
      if (!isLocalThoughtId(pending.localId)) return;
      if (hasLocalId(pending.localId)) return;
      upsertPendingInContainers(pending);
    });
  }, [containers, containersRef, pendingThoughts, upsertPendingInContainers]);

  useEffect(() => {
    if (!sermonId) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const expired = pendingRef.current.filter((item) => new Date(item.expiresAt).getTime() <= now);
      if (expired.length === 0) return;
      expired.forEach((item) => {
        removePendingThought(item.localId);
        toast.error(t("structure.localThoughtExpired", {
          defaultValue: "Local thought expired and was removed.",
        }));
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [removePendingThought, sermonId, t]);

  const pendingById = useMemo(() => {
    const map = new Map<string, PendingThoughtRecord>();
    pendingThoughts.forEach((item) => map.set(item.localId, item));
    return map;
  }, [pendingThoughts]);

  return {
    pendingThoughts,
    pendingById,
    createPendingThought,
    updatePendingThought,
    markPendingStatus,
    removePendingThought,
    replacePendingThought,
    updateItemSyncStatus,
    getPendingById,
  };
};
