'use client';

import { useMemo } from 'react';

import { useDataCollection } from '@/data-engine/react.client';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { findScriptureUsage } from '@/utils/scriptureUsage';

import type { StudyNote } from '@/models/models';
import type { AppLocale } from '@/utils/appLocale';
import type { ScriptureRefShape } from '@/utils/scriptureReference';

const ownedRows = (state: ReturnType<typeof useDataCollection>['state'], uid: string | null | undefined) => (state?.documents ?? [])
  .flatMap(row => row.value && row.value.userId === uid ? [{ ...row.value, id: row.resource.id }] : []);

/** Personal notes for the first reader panel; the broader material overview is a separate step. */
export function useScriptureUsage(reference: ScriptureRefShape, currentNoteId: string, locale: AppLocale) {
  const { uid, isAuthLoading } = useResolvedUid();
  const notes = useDataCollection(uid ? 'studyNotes' : null);
  const online = useOnlineStatus();
  const results = useMemo(() => {
    return findScriptureUsage(reference, { currentNoteId, locale,
      notes: ownedRows(notes.state, uid) as unknown as StudyNote[], sermons: [], groups: [] });
  }, [reference, currentNoteId, locale, uid, notes.state]);
  const collections = [notes];
  return {
    results,
    loading: isAuthLoading || collections.some(collection => collection.loading),
    complete: online && collections.every(collection => collection.state?.complete && collection.state.freshness === 'server' && !collection.error),
    error: collections.some(collection => Boolean(collection.error)),
    retry: () => Promise.allSettled(collections.map(collection => collection.refresh())),
  };
}
