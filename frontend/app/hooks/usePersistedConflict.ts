'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { discoverLegacyRecovery, type LegacyRecoverySource } from '@/data-engine/react.client';
import { newClientId } from '@/utils/clientId';
import { serializeContent } from '@/utils/contentFingerprint';
import { clearDraftIfMatches, draftKey, findDraftCopies, findDraftDocIds, saveDraft } from '@/utils/durableDraft';
import { validConflictEnvelope } from '@/utils/refusedDraftPayloads';

export interface PersistedConflict<T> {
  payload: T;
  actualRevision: number;
}

export interface PersistedConflictCopy<T> {
  key: string;
  documentId: string;
  value: PersistedConflict<T>;
}

export interface PersistedConflictChoices<T> {
  copies: PersistedConflictCopy<T>[];
  selectedKey: string | null;
  activation: number;
  unreadableSources: LegacyRecoverySource[];
  unreadableFailed: boolean;
  select: (key: string) => void;
  nextDocument: (preferred?: string | null) => string | null;
  capture: () => PersistedConflictCopy<T> | null;
}

/** Each physical copy owns a JSON snapshot, even when callers reuse one object. */
function snapshotConflict<T>(value: PersistedConflict<T>): PersistedConflict<T> {
  return JSON.parse(JSON.stringify(value)) as PersistedConflict<T>;
}

/** New refusals are independent. Replacing/resolving a choice names its exact held record. */
export function usePersistedConflict<T>(uid: string | null | undefined, docId: string | null | undefined, aggregate: string, validate: (value: unknown, documentId: string) => boolean = validConflictEnvelope) {
  const session = useMemo(() => ({
    owner: uid, aggregate, validate,
    records: new Map<string, PersistedConflictCopy<T>>(),
    bindings: new Map<PersistedConflict<T>, PersistedConflictCopy<T>>(),
    selected: new Map<string, string>(),
    activation: new Map<string, number>(),
    transient: new Map<string, PersistedConflictCopy<T>>(),
    unreadable: new Map<string, LegacyRecoverySource[]>(),
  }), [uid, aggregate, validate]);
  const current = useRef({ session, docId });
  current.current = { session, docId };
  type View = { session: typeof session; documentId: typeof docId; copies: PersistedConflictCopy<T>[]; selectedKey: string | null; activation: number; unreadableSources: LegacyRecoverySource[]; unreadableFailed: boolean; ephemeral?: PersistedConflict<T> | null };
  const [view, setView] = useState<View | null>(null);

  const readCopies = useCallback((documentId: string): PersistedConflictCopy<T>[] => {
    if (!session.owner) return [];
    const stored = findDraftCopies<PersistedConflict<T>>(session.owner, documentId, `conflict:${session.aggregate}`);
    const copies = stored.filter(copy => session.validate(copy.value, documentId)).map(copy => {
      const previous = session.records.get(copy.key);
      if (previous && serializeContent(previous.value) === serializeContent(copy.value)) return previous;
      const next = { key: copy.key, documentId, value: copy.value };
      session.records.set(copy.key, next); session.bindings.set(next.value, next);
      return next;
    });
    session.transient.forEach(copy => {
      if (copy.documentId === documentId && session.validate(copy.value, documentId) && !copies.some(stored => stored.key === copy.key)) copies.unshift(copy);
    });
    return copies;
  }, [session]);
  const refresh = useCallback((documentId: string, preferred?: string | null, activate = false, preserveMissing = false) => {
    const copies = readCopies(documentId);
    let unreadableSources = session.unreadable.get(documentId) ?? [];
    let unreadableFailed = false;
    try {
      unreadableSources = session.owner ? discoverLegacyRecovery(session.owner).filter(source => source.kind === 'draft'
        && source.documentId === documentId && source.aggregate === `conflict:${session.aggregate}`
        && !session.validate((source.payload as { value?: unknown }).value, documentId)) : [];
      session.unreadable.set(documentId, unreadableSources);
    } catch { unreadableFailed = true; }
    const previous = preferred ?? session.selected.get(documentId);
    const held = previous ? session.records.get(previous) : undefined;
    // A passive wake may add choices, but cannot replace words currently being read/edited.
    if (preserveMissing && held && session.owner && !copies.some(copy => copy.key === held.key)) {
      const retained = { ...held, value: snapshotConflict(held.value), key: draftKey(session.owner, documentId, `conflict:${session.aggregate}`, newClientId()) };
      session.records.set(retained.key, retained);
      session.bindings.set(retained.value, retained);
      session.transient.set(retained.key, retained);
      copies.unshift(retained);
    }
    const selectedKey = copies.find(copy => copy.key === previous)?.key ?? copies[0]?.key ?? null;
    if (activate && selectedKey && selectedKey !== session.selected.get(documentId)) {
      session.activation.set(documentId, (session.activation.get(documentId) ?? 0) + 1);
    }
    if (selectedKey) session.selected.set(documentId, selectedKey);
    else session.selected.delete(documentId);
    if (current.current.session === session && current.current.docId === documentId) {
      setView({ session, documentId, copies, selectedKey, activation: session.activation.get(documentId) ?? 0, unreadableSources, unreadableFailed });
    }
  }, [readCopies, session]);

  useEffect(() => {
    if (!uid || !docId) return;
    refresh(docId);
    const wake = () => refresh(docId, undefined, false, true);
    window.addEventListener('storage', wake); window.addEventListener('focus', wake);
    return () => { window.removeEventListener('storage', wake); window.removeEventListener('focus', wake); };
  }, [docId, refresh, uid]);

  const showEphemeral = useCallback((next: PersistedConflict<T> | null) => {
    if (current.current.session === session && current.current.docId === docId) {
      setView({ session, documentId: docId, copies: [], selectedKey: null, activation: 0, unreadableSources: [], unreadableFailed: false, ephemeral: next });
    }
  }, [docId, session]);

  /** `expected` distinguishes editing/resolving a shown choice from a new refused attempt. */
  const setConflict = useCallback((next: PersistedConflict<T> | null, documentOverride?: string, expected?: PersistedConflict<T>) => {
    const documentId = documentOverride ?? docId;
    if (!session.owner || !documentId) {
      showEphemeral(next);
      return;
    }
    const previousKey = session.selected.get(documentId);
    const selectedRecord = previousKey ? session.records.get(previousKey) : undefined;
    const held = expected ? session.bindings.get(expected) : selectedRecord;
    const matching = held?.documentId === documentId ? held : undefined;
    if (expected && !matching) return;
    if (next) {
      const key = draftKey(session.owner, documentId, `conflict:${session.aggregate}`, newClientId());
      const copy = { key, documentId, value: snapshotConflict(next) };
      const landed = saveDraft(key, copy.value);
      session.records.set(key, copy); session.bindings.set(copy.value, copy);
      // Immediate feature callbacks may hold their fresh input until React renders.
      // Never rebind an already shown object to a different physical copy.
      if (!session.bindings.has(next)) session.bindings.set(next, copy);
      if (!landed) session.transient.set(key, copy);
      // Editing a shown choice is write-new-before-retire, never an overwrite of an unknown slot.
      if (expected && matching && (landed || session.transient.has(matching.key))) {
        clearDraftIfMatches(matching.key, expected);
        session.transient.delete(matching.key);
      }
      const keepCurrent = expected && matching && previousKey !== matching.key;
      refresh(documentId, keepCurrent ? previousKey : key);
      return;
    }
    if (!matching) return;
    clearDraftIfMatches(matching.key, matching.value);
    session.transient.delete(matching.key);
    refresh(documentId, previousKey === matching.key ? null : previousKey, true);
  }, [docId, refresh, session, showEphemeral]);

  const visible = view?.session === session && view.documentId === docId ? view : null;
  const conflict = visible?.ephemeral ?? visible?.copies.find(copy => copy.key === visible.selectedKey)?.value ?? null;
  const select = useCallback((key: string) => {
    if (current.current.session !== session || current.current.docId !== docId || !docId) return;
    const copies = readCopies(docId);
    if (!copies.some(copy => copy.key === key)) return;
    refresh(docId, key, true);
  }, [docId, readCopies, refresh, session]);
  const capture = useCallback((): PersistedConflictCopy<T> | null => {
    if (current.current.session !== session || current.current.docId !== docId || !docId) return null;
    const key = session.selected.get(docId);
    return key ? session.records.get(key) ?? null : null;
  }, [docId, session]);
  /** The owning screen must not rebuild this index from disk and lose transient work. */
  const nextDocument = useCallback((preferred: string | null = null): string | null => {
    if (!session.owner) return null;
    const ids = [...new Set([...findDraftDocIds(session.owner, `conflict:${session.aggregate}`),
      ...[...session.transient.values()].map(copy => copy.documentId)])];
    const readable = (id: string) => readCopies(id).length > 0;
    if (preferred && ids.includes(preferred) && readable(preferred)) return preferred;
    return ids.find(readable) ?? (preferred && ids.includes(preferred) ? preferred : ids[0]) ?? null;
  }, [readCopies, session]);
  const choices = useMemo<PersistedConflictChoices<T>>(() => ({ copies: visible?.copies ?? [], selectedKey: visible?.selectedKey ?? null, activation: visible?.activation ?? 0, unreadableSources: visible?.unreadableSources ?? [], unreadableFailed: visible?.unreadableFailed ?? false, select, nextDocument, capture }), [capture, nextDocument, select, visible]);
  return [conflict, setConflict, !uid || !docId || Boolean(visible), choices] as const;
}
