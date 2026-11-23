'use client';

import { readDraftAddress } from '@/utils/draftAddress';
import { clearDraftIfMatches, clearDraftStorageRefusal, draftEditTime, draftKey, findDraftCopies, findDraftDocIds, nextDraftEditTime, readDraft, saveDraft, type DurableDraft } from '@/utils/durableDraft';

import { LocalWriteback } from './localWriteback';
import { createEngineStorageTransaction, engineOwnerRange } from './storage.client';

import type { OutlineTitleOpening } from '@/utils/sermonNoteText';

type DraftValue = { target: OutlineTitleOpening['target']; text: string };
export type OutlineTitleDraftCopy = { key: string; value: DraftValue; editedAt: number; legacy?: DurableDraft<DraftValue> };

const SLOT = 'outline-title';
const RECORD = 'outline-title-draft';
const ENGINE_WRITER = 'engine/';
export const outlineTitleDraftResource = (collection: string, id: string) => JSON.stringify([collection, id]);
export const outlineTitleDraftKey = (owner: string, resource: string, openingId: string) =>
  draftKey(owner, resource, SLOT, ENGINE_WRITER + openingId);

function isDraftValue(value: DraftValue | undefined): value is DraftValue {
  return typeof value?.text === 'string' && Boolean(value.text) && typeof value.target?.id === 'string'
    && (value.target.kind === 'point' || value.target.kind === 'subpoint');
}

function draftResource(resource: string): [collection: string, id: string] | undefined {
  try {
    const parts: unknown = JSON.parse(resource);
    if (Array.isArray(parts) && parts.length === 2 && typeof parts[0] === 'string' && typeof parts[1] === 'string') {
      return [parts[0], parts[1]];
    }
  } catch { /* Legacy data may contain an unreadable address. */ }
}

export function listLegacyOutlineTitleDraftIds(owner: string, collection: string): string[] {
  return findDraftDocIds(owner, SLOT).flatMap(address => {
    const resource = draftResource(address);
    return resource?.[0] === collection ? [resource[1]] : [];
  });
}

function readOutlineTitleReserves(owner: string, resource: string): OutlineTitleDraftCopy[] {
  return findDraftCopies<DraftValue>(owner, resource, SLOT).flatMap(({ key, value, sourceRecord, ...stored }) =>
    isDraftValue(value) ? [{ key, value, editedAt: draftEditTime(stored), legacy: sourceRecord as DurableDraft<DraftValue> }] : []);
}

export function readLegacyOutlineTitleDrafts(owner: string, resource: string): OutlineTitleDraftCopy[] {
  return readOutlineTitleReserves(owner, resource).filter(copy => !readDraftAddress(copy.key)?.writerId?.startsWith(ENGINE_WRITER));
}

export function discardLegacyOutlineTitle(copy: OutlineTitleDraftCopy): OutlineTitleDraftCopy | undefined {
  if (copy.legacy) clearDraftIfMatches(copy.key, copy.value, copy.legacy);
  const remaining = readDraft<DraftValue>(copy.key);
  return remaining && isDraftValue(remaining.value)
    ? { key: copy.key, value: remaining.value, editedAt: draftEditTime(remaining), legacy: remaining } : undefined;
}

function clearReserve(copy: OutlineTitleDraftCopy, through: (editedAt: number) => boolean) {
  const stored = readDraft<DraftValue>(copy.key);
  if (stored && through(draftEditTime(stored))) clearDraftIfMatches(copy.key, stored.value, stored);
  clearDraftStorageRefusal(copy.key, copy.value);
}

export function mergeOutlineTitleDrafts(copies: Iterable<OutlineTitleDraftCopy>): OutlineTitleDraftCopy[] {
  const latest = new Map<string, OutlineTitleDraftCopy>();
  for (const copy of copies) {
    const previous = latest.get(copy.key);
    if (!previous || copy.editedAt >= previous.editedAt) latest.set(copy.key, copy);
  }
  return [...latest.values()].sort((left, right) => right.editedAt - left.editedAt || left.key.localeCompare(right.key));
}

/** A title opening owns its exact words on this device until an explicit submit or discard. */
export function createOutlineTitleDraftStore(writes = new LocalWriteback()) {
  const transaction = createEngineStorageTransaction();
  const pending = new Map<string, OutlineTitleDraftCopy>();
  const retirements = new Set<(owner: string, resource: string, copy: OutlineTitleDraftCopy) => void>();
  const forDocument = (owner: string, resource: string) => {
    const parts = draftResource(resource);
    if (!parts) return null;
    const scoped = (key: string) => {
      const address = readDraftAddress(key);
      return address?.owner === owner && address.documentId === resource && address.aggregate === SLOT ? address : undefined;
    };
    const readLocal = () => mergeOutlineTitleDrafts([
      ...readOutlineTitleReserves(owner, resource), ...[...pending.values()].filter(copy => scoped(copy.key)),
    ]);
    const localAddress = (id: string) => ({ owner, kind: RECORD, id }) as const;
    const storageKey = (key: string) => [RECORD, owner, ...parts, key];
    const retired = (copy: OutlineTitleDraftCopy) => {
      for (const notify of retirements) notify(owner, resource, copy);
    };
    return {
      subscribeRetirements(notify: (copy: OutlineTitleDraftCopy) => void) {
        const listener = (from: string, document: string, copy: OutlineTitleDraftCopy) => {
          if (from === owner && document === resource) notify(copy);
        };
        retirements.add(listener);
        return () => { retirements.delete(listener); };
      },
      readLocal,
      readStored: async (): Promise<OutlineTitleDraftCopy[]> => {
        const stored = await transaction<OutlineTitleDraftCopy[]>('readonly', (store, read, done) =>
          read(store.getAll(engineOwnerRange(RECORD, owner, ...parts)), done));
        return mergeOutlineTitleDrafts([...stored.filter(copy => scoped(copy.key) && isDraftValue(copy.value)), ...readLocal()]);
      },
      remember(openingId: string, value: DraftValue, prior?: OutlineTitleDraftCopy): OutlineTitleDraftCopy {
        const key = outlineTitleDraftKey(owner, resource, openingId);
        const copy = { key, value, editedAt: nextDraftEditTime(prior?.editedAt) };
        pending.set(key, copy);
        // The reserve covers a tab closing before IndexedDB acknowledges the exact keystroke.
        saveDraft(key, value, undefined, false, copy.editedAt);
        void writes.write(localAddress(key), async () => {
          if (pending.get(key) !== copy) return;
          await transaction<void>('readwrite', (store, _read, done) => {
            store.put(copy, storageKey(key));
            done(undefined);
          });
          if (pending.get(key) !== copy) return;
          clearReserve(copy, editedAt => editedAt === copy.editedAt);
          pending.delete(key);
        }).catch(() => undefined);
        return copy;
      },
      async discard(copy: OutlineTitleDraftCopy): Promise<OutlineTitleDraftCopy | undefined> {
        const address = scoped(copy.key);
        if (!address) return undefined;
        if (!address.writerId?.startsWith(ENGINE_WRITER)) {
          const remaining = discardLegacyOutlineTitle(copy);
          if (!remaining) retired(copy);
          return remaining;
        }
        const laterLocal = () => readLocal().find(candidate => candidate.key === copy.key && candidate.editedAt > copy.editedAt);
        const previous = laterLocal();
        if (previous) return previous;
        return writes.write(localAddress(copy.key), async () => {
          const newer = await transaction<OutlineTitleDraftCopy | undefined>('readwrite', (store, read, done) => {
            const key = storageKey(copy.key);
            read(store.get(key), (saved: OutlineTitleDraftCopy | undefined) => {
              if (saved && saved.editedAt > copy.editedAt) return done(saved);
              if (saved) store.delete(key);
              done(undefined);
            });
          });
          const live = laterLocal();
          if (newer || live) return live && (!newer || live.editedAt > newer.editedAt) ? live : newer;
          clearReserve(copy, editedAt => editedAt <= copy.editedAt);
          pending.delete(copy.key);
          const remaining = readLocal().find(candidate => candidate.key === copy.key);
          if (!remaining) retired(copy);
          return remaining;
        });
      },
    };
  };
  const listDocuments = async (owner: string, collection: string) => transaction<string[]>('readonly', (store, read, done) => {
    read(store.getAllKeys(engineOwnerRange(RECORD, owner, collection)), keys => done([...new Set(keys.flatMap(key =>
      Array.isArray(key) && key.length === 5 && typeof key[3] === 'string' ? [key[3]] : []))]));
  });
  return { forDocument, listDocuments };
}

export type OutlineTitleDraftStore = ReturnType<typeof createOutlineTitleDraftStore>;
