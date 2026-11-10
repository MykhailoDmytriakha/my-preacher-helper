'use client';

import { useMemo } from 'react';

import { isLiveCollectionDocument, useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { useAuth } from '@/providers/AuthProvider';
import { isBibleId, type BibleId } from '@/utils/bibles';
import { newClientId } from '@/utils/clientId';

import type { WriteOperation } from '@/utils/recoverableWrite';
import type { ScriptureRefShape } from '@/utils/scriptureReference';

/** A place as the pastor wrote it: in the Bible he wrote it in, chapter required. */
export type OwnPlaceRef = ScriptureRefShape & { bible: BibleId; chapter: number };
export type OwnPlace = { id: string; ref: OwnPlaceRef; createdAt: string };

const isOwnPlaceRef = (value: unknown): value is OwnPlaceRef => {
  const ref = value as Partial<OwnPlaceRef> | null;
  return Boolean(ref) && isBibleId(ref?.bible) && typeof ref?.book === 'string' && Number.isInteger(ref?.chapter);
};

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
 * network allows, the same list on every device.
 */
export function useOccasionPlaces(occasionId: string | null) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const collection = useDataCollection(uid ? 'occasionPlaces' : null);
  const actions = useDocumentActions();

  const places = useMemo<OwnPlace[]>(() => (collection.state?.documents ?? [])
    .filter(isLiveCollectionDocument)
    .flatMap((row) => {
      const value = row.value as { occasionId?: unknown; ref?: unknown; createdAt?: unknown } | null;
      if (!value || value.occasionId !== occasionId || !isOwnPlaceRef(value.ref)) return [];
      return [{ id: row.resource.id, ref: value.ref, createdAt: typeof value.createdAt === 'string' ? value.createdAt : '' }];
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [collection.state?.documents, occasionId]);

  return {
    places,
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
    remove: (id: string): WriteOperation => actions.remove({ collection: 'occasionPlaces', id }),
  };
}
