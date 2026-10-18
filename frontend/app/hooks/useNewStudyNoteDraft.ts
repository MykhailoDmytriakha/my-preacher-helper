'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useRouteId } from '@/hooks/useRouteId';
import { newClientId } from '@/utils/clientId';
import { canResumeNewNoteDraft, newNoteDraftId, representedNewNoteId, reserveNewNoteCreation, retireConfirmedNewNoteDrafts, validNewNoteDraftId } from '@/utils/newNoteDrafts';

import type { StudyNote } from '@/models/models';

/** The opening's local backup and eventual resource remain separate identities. */
export function useNewStudyNoteDraft({ uid, routeId, createdNoteId, openingDraftId, notes, confirmedCreationIds }: {
  uid: string | undefined;
  routeId: string;
  createdNoteId: string | null;
  openingDraftId: string;
  notes: ReadonlyArray<Pick<StudyNote, 'id'>>;
  confirmedCreationIds?: ReadonlySet<string>;
}) {
  const creationId = useMemo(() => reserveNewNoteCreation(uid, openingDraftId), [uid, openingDraftId]);
  useEffect(() => {
    if (uid && confirmedCreationIds) retireConfirmedNewNoteDrafts(uid, confirmedCreationIds);
  }, [uid, confirmedCreationIds]);
  // A stale resume link can already name a locally captured or accepted row.
  const representedId = representedNewNoteId(routeId, creationId, notes);
  const noteId = createdNoteId || representedId || routeId;
  const isNew = noteId === 'new';
  return { creationId, creationTargetId: isNew ? creationId : undefined, noteId, isNew, draftDocId: isNew ? openingDraftId : noteId };
}

/** Own the opening, including native URL adoption before Next changes its route tree. */
export function useNewNoteOpening() {
  const routeId = useRouteId();
  const searchParams = useSearchParams();
  const { uid } = useResolvedUid();
  const selected = routeId === 'new' ? validNewNoteDraftId(searchParams.get('draft')) : null;
  const linkOwner = searchParams.get('draftOwner');
  const isNewPath = typeof window === 'undefined' || window.location.pathname.endsWith('/studies/new');
  const reserve = () => ({ uid, routeId, selected,
    draftDocId: canResumeNewNoteDraft(uid, selected, linkOwner) && selected ? selected : newNoteDraftId(newClientId()) });
  const [opening, setOpening] = useState(reserve);
  // replaceState adopts the real URL without updating useParams' route tree.
  // Its cleared query must not become an independent blank editor mid-create.
  const adopted = opening.uid === uid && opening.routeId === routeId && routeId === 'new' && !isNewPath;
  if (opening.uid !== uid || opening.routeId !== routeId || (!adopted && opening.selected !== selected)) {
    const reflected = opening.uid === uid && opening.routeId === routeId && selected === opening.draftDocId && linkOwner === uid;
    setOpening(reflected ? { ...opening, selected } : reserve());
  }
  useEffect(() => {
    if (routeId !== 'new' || !uid || !isNewPath) return;
    if (selected === opening.draftDocId && linkOwner === uid) return;
    const query = new URLSearchParams(searchParams.toString());
    query.set('draft', opening.draftDocId);
    query.set('draftOwner', uid);
    window.history.replaceState(null, '', `/studies/new?${query.toString()}`);
  }, [routeId, uid, isNewPath, selected, linkOwner, opening.draftDocId, searchParams]);
  return { draftDocId: opening.draftDocId, key: `${uid ?? ''}:${routeId === 'new' ? opening.draftDocId : routeId}` };
}
