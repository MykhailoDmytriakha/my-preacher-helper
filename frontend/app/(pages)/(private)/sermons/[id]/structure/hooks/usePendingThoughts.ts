import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Item, Sermon } from '@/models/models';
import { buildLocalThoughtId, loadPendingThoughts, savePendingThoughts } from '@/utils/pendingThoughtsStore';
import { getCanonicalTagForSection } from '@/utils/tagUtils';

import { buildItemForUI, findOutlinePoint, isLocalThoughtId } from '../utils/structure';

import type { PendingThoughtRecord, PendingThoughtSection, PendingThoughtStatus } from '@/utils/pendingThoughtsStore';

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

export const usePendingThoughts = ({
  sermonId,
  sermon,
  allowedTags,
  setContainers,
  containersRef,
  containers,
}: UsePendingThoughtsParams) => {
  const { t } = useTranslation();
  const [pendingThoughts, setPendingThoughts] = useState<PendingThoughtRecord[]>([]);
  const pendingRef = useRef<PendingThoughtRecord[]>(pendingThoughts);

  useEffect(() => {
    pendingRef.current = pendingThoughts;
  }, [pendingThoughts]);

  const persistPending = useCallback((items: PendingThoughtRecord[]) => {
    if (!sermonId) return;
    void savePendingThoughts(sermonId, items);
  }, [sermonId]);

  const updatePending = useCallback((updater: (prev: PendingThoughtRecord[]) => PendingThoughtRecord[]) => {
    setPendingThoughts((prev) => {
      const next = updater(prev);
      persistPending(next);
      return next;
    });
  }, [persistPending]);

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
      syncStatus: pending.status === 'sending' ? 'pending' : pending.status,
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
        const sections = ['introduction', 'main', 'conclusion', 'ambiguous'];
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

  const updateItemSyncStatus = useCallback((itemId: string, status?: 'pending' | 'error' | 'success', meta?: { expiresAt?: string; lastError?: string; successAt?: string }) => {
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
          updatedItem.syncExpiresAt = meta?.expiresAt ?? updatedItem.syncExpiresAt;
          updatedItem.syncLastError = meta?.lastError;
          updatedItem.syncSuccessAt = meta?.successAt ?? updatedItem.syncSuccessAt;
        } else {
          delete updatedItem.syncStatus;
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
    const now = new Date();
    const record: PendingThoughtRecord = {
      localId: buildLocalThoughtId(),
      sermonId,
      sectionId: input.sectionId,
      text: input.text,
      tags: input.tags,
      outlinePointId: input.outlinePointId,
      createdAt: now.toISOString(),
      lastAttemptAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PENDING_TTL_MS).toISOString(),
      status: 'pending',
    };

    updatePending((prev) => [...prev, record]);
    upsertPendingInContainers(record);
    return record;
  }, [sermonId, updatePending, upsertPendingInContainers]);

  const updatePendingThought = useCallback((localId: string, input: Partial<PendingThoughtInput>) => {
    updatePending((prev) => prev.map((item) => {
      if (item.localId !== localId) return item;
      const updated: PendingThoughtRecord = {
        ...item,
        text: input.text ?? item.text,
        tags: input.tags ?? item.tags,
        outlinePointId: input.outlinePointId ?? item.outlinePointId,
      };
      upsertPendingInContainers(updated);
      return updated;
    }));
  }, [updatePending, upsertPendingInContainers]);

  const markPendingStatus = useCallback((localId: string, status: PendingThoughtStatus, options?: { error?: string; resetExpiry?: boolean }) => {
    const now = new Date();
    updatePending((prev) => prev.map((item) => {
      if (item.localId !== localId) return item;
      const shouldReset = options?.resetExpiry ?? (status === 'pending' || status === 'sending');
      const updated: PendingThoughtRecord = {
        ...item,
        status,
        lastError: options?.error,
        lastAttemptAt: shouldReset ? now.toISOString() : item.lastAttemptAt,
        expiresAt: shouldReset ? new Date(now.getTime() + PENDING_TTL_MS).toISOString() : item.expiresAt,
      };
      upsertPendingInContainers(updated);
      return updated;
    }));
  }, [updatePending, upsertPendingInContainers]);

  const removePendingThought = useCallback((localId: string, options?: { removeFromContainers?: boolean }) => {
    updatePending((prev) => prev.filter((item) => item.localId !== localId));
    if (options?.removeFromContainers !== false) {
      removePendingFromContainers(localId);
    }
  }, [removePendingFromContainers, updatePending]);

  const replacePendingThought = useCallback((localId: string, newItem: Item) => {
    replacePendingInContainers(localId, newItem);
  }, [replacePendingInContainers]);

  useEffect(() => {
    let active = true;
    if (!sermonId) {
      setPendingThoughts([]);
      return;
    }

    loadPendingThoughts(sermonId).then((items) => {
      if (!active) return;
      const normalized = items.map((item) => (
        item.status === 'sending'
          ? { ...item, status: 'error' as PendingThoughtStatus }
          : item
      ));
      setPendingThoughts(normalized);
      persistPending(normalized);
    });

    return () => {
      active = false;
    };
  }, [persistPending, sermonId]);

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
        toast.error(t('structure.localThoughtExpired', {
          defaultValue: 'Local thought expired and was removed.'
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
