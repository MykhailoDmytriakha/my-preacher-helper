'use client';

import { useMemo } from 'react';

import { isLiveCollectionDocument, useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { useAuth } from '@/providers/AuthProvider';
import { isBibleId, type BibleId } from '@/utils/bibles';
import { newClientId } from '@/utils/clientId';
import { awaitWriteOperation } from '@/utils/recoverableWrite';
import { versesHeldIn } from '@/utils/scriptureReferenceNumbering';

import type { WriteOperation } from '@/utils/recoverableWrite';
import type { ScriptureRefShape } from '@/utils/scriptureReference';

/** A place as the pastor wrote it: in the Bible he wrote it in, chapter required. */
export type OwnPlaceRef = ScriptureRefShape & { bible: BibleId; chapter: number };
/**
 * One place on the screen. `ids` — every document that holds it: the same place added on two
 * devices before either saw the other is two documents, shown once and removed together.
 */
export type OwnPlace = { ids: string[]; ref: OwnPlaceRef; createdAt: string };

const isOwnPlaceRef = (value: unknown): value is OwnPlaceRef => {
  const ref = value as Partial<OwnPlaceRef> | null;
  return Boolean(ref) && isBibleId(ref?.bible) && typeof ref?.book === 'string' && Number.isInteger(ref?.chapter);
};

/** The verses a place holds, as one key: two writings of the same verses are the same place. */
export const ownPlaceKey = (ref: ScriptureRefShape & { bible: BibleId }): string =>
  versesHeldIn(ref, 'kjv').map((v) => `${v.book}:${v.chapter}:${v.verse}`).join('|');

/**
 * THE PASTOR'S OWN PLACES in a topic of the word for the occasion (`/care/word/<topic>`).
 *
 * The owner, 2026-11-10: the Gideons' lists are short, and he adds what he reads himself — by hand,
 * a place at a time, rather than have them filled with much he would not use. These are not his
 * notes and not his tags (his words: tags belong to the notes, places are what he picks quickly
 * before a visit), so they live in their own collection, one document per place: added and
 * removed, never edited, so two devices adding at once never meet in one document.
 *
 * Through the data engine like every user collection: kept on the device first, delivered when the
 * network allows, the same list on every device. `complete` says the list is known whole — until
 * then "no places" is not a fact, and the screen must not say it.
 */
export function useOccasionPlaces(occasionId: string | null) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const collection = useDataCollection(uid ? 'occasionPlaces' : null);
  const actions = useDocumentActions();

  const places = useMemo<OwnPlace[]>(() => {
    const byPlace = new Map<string, OwnPlace>();
    for (const row of (collection.state?.documents ?? []).filter(isLiveCollectionDocument)) {
      const value = row.value as { occasionId?: unknown; ref?: unknown; createdAt?: unknown } | null;
      if (!value || value.occasionId !== occasionId || !isOwnPlaceRef(value.ref)) continue;
      const createdAt = typeof value.createdAt === 'string' ? value.createdAt : '';
      const key = ownPlaceKey(value.ref);
      const known = byPlace.get(key);
      if (!known) byPlace.set(key, { ids: [row.resource.id], ref: value.ref, createdAt });
      else byPlace.set(key, { ...known, ids: [...known.ids, row.resource.id], createdAt: known.createdAt < createdAt ? known.createdAt : createdAt });
    }
    return [...byPlace.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [collection.state?.documents, occasionId]);

  return {
    places,
    /** The engine's view of the list, for the shared list status (`DataCollectionStatus`). */
    state: collection.state,
    /** The list is known whole: only then is an empty list "no places". */
    complete: Boolean(collection.state?.complete),
    /** Only a signed-in person on a known topic adds a place. */
    canAdd: Boolean(uid && occasionId),
    loading: Boolean(uid) && collection.loading,
    add: (ref: OwnPlaceRef): WriteOperation => {
      if (!uid || !occasionId) return Promise.reject(new Error('No signed-in person or topic for this place'));
      const now = new Date().toISOString();
      // A document is plain JSON: the place's own fields, nothing undefined.
      const kept = Object.fromEntries(Object.entries(ref).filter(([, value]) => value !== undefined)) as Record<string, string | number>;
      return actions.create({ collection: 'occasionPlaces', id: newClientId() }, { userId: uid, occasionId, ref: kept, createdAt: now, updatedAt: now });
    },
    /** Removes every document that holds the place, so a place added twice leaves at once. */
    remove: (place: OwnPlace): Promise<void> =>
      Promise.all(place.ids.map((id) => awaitWriteOperation(actions.remove({ collection: 'occasionPlaces', id }), () => undefined))).then(() => undefined),
  };
}
