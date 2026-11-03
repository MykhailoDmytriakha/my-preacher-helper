import { useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';

import { useDataCollection, useShareCapabilityActions } from '@/data-engine/react.client';
import { useAppLocale } from '@/hooks/useAppLocale';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerUnavailableNotice } from '@/hooks/useServerUnavailableNotice';
import { useTranslation } from '@locales/useTranslation';

import type { StudyNoteShareLink } from '@/models/models';

const NO_SHARE_LINKS: StudyNoteShareLink[] = [];

/** Link lists and capability actions share the canonical engine; tokens are never editable drafts. */
export function useStudyNoteShareLinks() {
  const { t } = useTranslation();
  const { locale } = useAppLocale();
  const { uid, isAuthLoading } = useResolvedUid();
  const currentOwner = useRef(uid); currentOwner.current = uid;
  const links = useDataCollection(uid ? 'studyNoteShareLinks' : null);
  const { presence: notePresence } = useDataCollection(uid ? 'studyNotes' : null);
  const capability = useShareCapabilityActions();
  const serverNoticeShown = useServerUnavailableNotice();
  const running = useRef(new Set<string>());
  const said = useRef(new Set<string>());

  const shareLinks = useMemo(() => {
    if (!uid || !links.state) return NO_SHARE_LINKS;
    const rows = links.state.documents ?? links.state.snapshots.map(snapshot => ({ resource: snapshot.resource, value: snapshot.value }));
    return rows.flatMap(row => {
      const value = row.value;
      if (!value || value.ownerId !== uid || typeof value.noteId !== 'string' || typeof value.token !== 'string'
        || notePresence(value.noteId).snapshot?.metadata?.deleted) return [];
      return [{ ...value, id: row.resource.id } as unknown as StudyNoteShareLink];
    });
  }, [uid, links.state, notePresence]);

  // Recovery belongs to the durable action, across screen changes and reload. Ordinary delivery
  // stays silent; the shared engine policy decides when an unanswered send needs to be said.
  useEffect(() => {
    const next = new Set<string>();
    for (const action of capability.actions) {
      const trouble = action.state === 'refused' || action.state === 'conflict' || (action.state === 'unknown' && !serverNoticeShown);
      if (!trouble) continue;
      const id = `share-capability:${uid}:${action.id}`;
      next.add(id);
      const key = action.kind === 'create' ? 'studiesWorkspace.shareLinks.createUnconfirmed' : 'studiesWorkspace.shareLinks.revokeUnconfirmed';
      toast.error(t(key), { id, duration: Infinity, action: { label: t('dataSync.retry'), onClick: () => {
        void capability.retry(action.id).catch(() => { if (currentOwner.current === uid) toast.error(t(key), { id }); });
      } } });
    }
    for (const id of said.current) if (!next.has(id)) toast.dismiss(id);
    said.current = next;
  }, [capability, serverNoticeShown, uid, t]);
  useEffect(() => () => { for (const id of said.current) toast.dismiss(id); said.current.clear(); }, [uid]);

  const submit = async (kind: 'create' | 'revoke', targetId: string): Promise<void> => {
    const key = kind === 'create' ? 'studiesWorkspace.shareLinks.createUnconfirmed' : 'studiesWorkspace.shareLinks.revokeUnconfirmed';
    const address = JSON.stringify([uid, kind, targetId]);
    if (running.current.has(address) || capability.actions.some(action => action.kind === kind && action.targetId === targetId
      && !['refused', 'conflict'].includes(action.state))) return;
    if (!uid || !capability.ready) {
      const error = new Error('The capability engine is not ready');
      toast.error(t(key)); throw error;
    }
    running.current.add(address);
    try {
      const held = capability.actions.find(action => action.kind === kind && action.targetId === targetId
        && ['refused', 'conflict'].includes(action.state));
      if (held) await capability.retry(held.id);
      else if (kind === 'create') await capability.create(targetId, locale);
      else await capability.revoke(targetId);
    } catch (error) {
      if (currentOwner.current === uid) toast.error(t(key), { id: `share-capability-capture:${address}` });
      throw error;
    } finally { running.current.delete(address); }
  };

  return {
    uid, shareLinks, loading: isAuthLoading || links.loading,
    error: links.error ? new Error(links.error) : null,
    refetch: links.refresh,
    createShareLink: (noteId: string) => submit('create', noteId),
    deleteShareLink: (linkId: string) => submit('revoke', linkId),
  };
}
