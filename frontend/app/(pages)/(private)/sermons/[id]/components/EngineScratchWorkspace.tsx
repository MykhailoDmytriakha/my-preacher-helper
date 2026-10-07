'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EngineOutlineModal } from '@/components/sermon/EngineOutlineModal';
import ScratchPanel from '@/components/sermon/ScratchPanel';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataEngine, useRecoveryDiscovery } from '@/data-engine/react.client';

import { useScratchDataDocument } from '../hooks/useScratchDataDocument';

import type { ResourceSnapshot } from '@/data-engine/types';

interface EngineScratchWorkspaceProps {
  sermonId: string;
  isReadOnly?: boolean;
  onConfirmed?: (snapshot: ResourceSnapshot) => void;
}

/** Bind scratch interactions to the shared document lifecycle without another cache or baseline. */
export function EngineScratchWorkspace({ sermonId, isReadOnly = false, onConfirmed }: EngineScratchWorkspaceProps) {
  const { t } = useTranslation();
  const { owner } = useDataEngine();
  const scratch = useScratchDataDocument(sermonId);
  const [proposalOpen, setProposalOpen] = useState(false);
  const latest = useRef(scratch); latest.current = scratch;
  const identity = useMemo(() => ({ owner, sermonId }), [owner, sermonId]);
  const scope = useRef(identity); scope.current = identity;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const isCurrent = useCallback(() => mounted.current && scope.current === identity && Boolean(identity.owner), [identity]);
  const fallbackTitle = t('freshness.entitySermon');
  const recovery = useRecoveryDiscovery({ identity: scratch.recoveryIdentity,
    enabled: Boolean(owner) && !scratch.loading && scratch.status !== null,
    version: JSON.stringify([scratch.status?.phase, scratch.confirmed?.metadata?.revision]),
    list: async () => (await latest.current.listRecoverable()).map(({ id, record }) => {
      const draft = record.checkpoint.draft;
      const title = draft?.title ?? record.checkpoint.confirmed.value?.title;
      const notes = Array.isArray(draft?.scratch) ? draft.scratch : [];
      const preview = notes.flatMap(note => note && typeof note === 'object' && !Array.isArray(note) && typeof note.text === 'string' ? [note.text] : []).join('\n').slice(0, 500);
      return { id, title: typeof title === 'string' && title.trim() ? title : fallbackTitle, ...(preview ? { preview } : {}) };
    }),
    recover: id => latest.current.recover(id) });
  const emitted = useRef<{ identity: object; fingerprint: string } | null>(null);
  const confirmed = scratch.confirmed;
  const fingerprint = JSON.stringify(confirmed);
  useEffect(() => {
    if (!isCurrent() || !confirmed || !onConfirmed || confirmed.resource.collection !== 'sermons' || confirmed.resource.id !== sermonId) return;
    if (emitted.current?.identity === identity && emitted.current.fingerprint === fingerprint) return;
    emitted.current = { identity, fingerprint };
    onConfirmed(confirmed);
  }, [identity, isCurrent, confirmed, fingerprint, onConfirmed, sermonId]);
  const deleted = Boolean(confirmed?.metadata?.deleted || (confirmed && confirmed.value === null)
    || (scratch.remote && scratch.remote.value === null) || scratch.remote?.metadata?.deleted);

  return <section className="space-y-4" data-testid="engine-scratch-workspace">
    {/* ONE CONFLICT, ONE QUESTION (BUG-20261006-sermon-conflict-choice-shown-twice). On the sermon page
        this workspace holds the page's own document — its provider hands every hook one editor — and the
        header, on screen in both modes, already speaks for that document's delivery: its state, its
        failure, the choice in a conflict. This block offers only what is the workspace's own — drafts
        of notes left unfinished. */}
    <DataSyncStatus subject={scratch.recoveryIdentity} status={null} error={null}
      recoveryChoices={recovery.choices} onRecover={recovery.recover}
      recoveryLoading={recovery.loading} recoveryError={recovery.error} />
    {scratch.loading ? <p role="status">{t('common.loading')}</p> : !scratch.data ? <p>{t('common.noData')}</p> : <ScratchPanel
      sermonId={sermonId} notes={scratch.notes} outline={scratch.outline}
      addScratchNote={scratch.addScratchNote} restoreScratchNote={scratch.restoreScratchNote}
      updateScratchNote={scratch.updateScratchNote} deleteScratchNote={scratch.deleteScratchNote} moveScratchNote={scratch.moveScratchNote}
      isScratchWritePending={scratch.isWritePending} scratchRevision={scratch.scratchRevision}
      onEditPlan={() => setProposalOpen(true)}
      isReadOnly={isReadOnly || deleted || !owner} />}
    {proposalOpen && !isReadOnly && !deleted && owner && <EngineOutlineModal key={`${owner}:${sermonId}`} sermonId={sermonId}
      withScratch onClose={() => setProposalOpen(false)} />}
  </section>;
}
