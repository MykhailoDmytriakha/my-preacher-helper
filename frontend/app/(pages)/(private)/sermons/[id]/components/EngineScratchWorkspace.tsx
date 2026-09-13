'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ScratchPanel from '@/components/sermon/ScratchPanel';
import { DataSyncStatus, type RecoveryChoice } from '@/data-engine/DataSyncStatus';
import { useDataEngine } from '@/data-engine/react.client';

import { useScratchDataDocument } from '../hooks/useScratchDataDocument';

import type { ResourceSnapshot } from '@/data-engine/types';

interface EngineScratchWorkspaceProps {
  sermonId: string;
  isReadOnly?: boolean;
  onConfirmed?: (snapshot: ResourceSnapshot) => void;
}
interface RecoveryState { identity: object; choices: RecoveryChoice[]; loading: boolean; error: string | null }

/** Bind scratch interactions to the shared document lifecycle without another cache or baseline. */
export function EngineScratchWorkspace({ sermonId, isReadOnly = false, onConfirmed }: EngineScratchWorkspaceProps) {
  const { t } = useTranslation();
  const { owner } = useDataEngine();
  const scratch = useScratchDataDocument(sermonId);
  const latest = useRef(scratch); latest.current = scratch;
  const identity = useMemo(() => ({ owner, sermonId }), [owner, sermonId]);
  const scope = useRef(identity); scope.current = identity;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const isCurrent = useCallback(() => mounted.current && scope.current === identity && Boolean(identity.owner), [identity]);
  const [recovery, setRecovery] = useState<RecoveryState | null>(null);
  const request = useRef(0);
  const activeRecovery = recovery?.identity === identity ? recovery : null;
  const recoverChoices = activeRecovery?.choices ?? [];
  const fallbackError = t('dataSync.actionFailed');
  const fallbackTitle = t('freshness.entitySermon');
  const listRecovery = useCallback(async () => {
    if (!isCurrent()) return;
    const version = ++request.current;
    setRecovery({ identity, choices: [], loading: true, error: null });
    try {
      const records = await latest.current.listRecoverable();
      if (!isCurrent() || version !== request.current) return;
      const choices = records.map(({ id, record }) => {
        const draft = record.checkpoint.draft;
        const title = draft?.title ?? record.checkpoint.confirmed.value?.title;
        const notes = Array.isArray(draft?.scratch) ? draft.scratch : [];
        const preview = notes.flatMap(note => note && typeof note === 'object' && !Array.isArray(note) && typeof note.text === 'string' ? [note.text] : []).join('\n').slice(0, 500);
        return { id, title: typeof title === 'string' && title.trim() ? title : fallbackTitle, ...(preview ? { preview } : {}) };
      });
      setRecovery({ identity, choices, loading: false, error: null });
    } catch (error) {
      if (isCurrent() && version === request.current) setRecovery({ identity, choices: [], loading: false, error: error instanceof Error ? error.message : fallbackError });
    }
  }, [identity, isCurrent, fallbackError, fallbackTitle]);
  const recover = useCallback(async (sourceId: string) => {
    if (!isCurrent()) return;
    const version = ++request.current;
    setRecovery(previous => ({ identity, choices: previous?.identity === identity ? previous.choices : [], loading: true, error: null }));
    try {
      await latest.current.recover(sourceId);
      if (isCurrent() && version === request.current) setRecovery({ identity, choices: [], loading: false, error: null });
    } catch (error) {
      if (isCurrent() && version === request.current) setRecovery(previous => ({ identity, choices: previous?.identity === identity ? previous.choices : [], loading: false, error: error instanceof Error ? error.message : fallbackError }));
    }
  }, [identity, isCurrent, fallbackError]);
  const keepLocal = useCallback(async () => { if (isCurrent()) await latest.current.keepLocal(); }, [isCurrent]);
  const acceptRemote = useCallback(async () => { if (isCurrent()) await latest.current.acceptRemote(); }, [isCurrent]);
  const retry = useCallback(async () => { if (isCurrent()) await latest.current.retry(); }, [isCurrent]);
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
    <DataSyncStatus status={scratch.status} error={scratch.error} onKeepLocal={keepLocal} onAcceptRemote={acceptRemote} onRetry={retry}
      recoveryChoices={recoverChoices} onListRecovery={listRecovery} onRecover={recover}
      recoveryLoading={activeRecovery?.loading} recoveryError={activeRecovery?.error} />
    {scratch.loading ? <p role="status">{t('common.loading')}</p> : !scratch.data ? <p>{t('common.noData')}</p> : <ScratchPanel
      sermonId={sermonId} notes={scratch.notes} outline={scratch.outline}
      addScratchNote={scratch.addScratchNote} restoreScratchNote={scratch.restoreScratchNote}
      updateScratchNote={scratch.updateScratchNote} deleteScratchNote={scratch.deleteScratchNote} moveScratchNote={scratch.moveScratchNote}
      isScratchWritePending={scratch.isWritePending} scratchRevision={scratch.scratchRevision}
      onApplyOutline={scratch.applyOutlineAndConsume} onOutlineChange={async outline => { await scratch.onOutlineChange(outline); }}
      isReadOnly={isReadOnly || deleted || !owner} />}
  </section>;
}
