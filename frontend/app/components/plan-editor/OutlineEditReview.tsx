'use client';

import { createContext, useContext, type ContextType, type PropsWithChildren } from 'react';

import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { readOutlineNoteConflict, readOutlineTitleComparison, readSermonOutlineReview, readSermonPointMoveRecovery, useRecoveryDiscovery } from '@/data-engine/react.client';
import { SECTION_KEYS } from '@/utils/outlineDnd';
import { getSectionLabel } from '@lib/sections';
import { useTranslation } from '@locales/useTranslation';

import { outlineTitleComparison } from './outlineTitleComparison';

import type { useDataDocument } from '@/data-engine/react.client';
import type { SermonOutline } from '@/models/models';
import type { TFunction } from 'i18next';

type OutlineDocument = Pick<ReturnType<typeof useDataDocument>, 'state' | 'status' | 'confirmed' | 'recoveryIdentity' | 'outlineReviewVersion'
  | 'listRecoverable' | 'recover' | 'discardRecovery' | 'keepLocal' | 'acceptRemote' | 'readLiveSermonOutline'>;

const hasUnsettledSave = (document: OutlineDocument) => Boolean(Object.keys(document.state?.checkpoint.pending ?? {}).length);

function useSavedOutlineChoices(document: OutlineDocument, enabled: boolean) {
  const { t } = useTranslation();
  return useRecoveryDiscovery({
    identity: document.recoveryIdentity,
    enabled: enabled && Boolean(document.state?.durable && (document.status?.phase === 'saved' || hasUnsettledSave(document))),
    version: JSON.stringify([document.confirmed?.metadata, document.outlineReviewVersion, document.status?.phase === 'saved']),
    list: async () => (await document.listRecoverable()).flatMap(source => {
      const title = readOutlineTitleComparison(source.record.checkpoint);
      const note = readOutlineNoteConflict(source.record.checkpoint);
      const outline = readSermonOutlineReview(source.record.checkpoint);
      const move = readSermonPointMoveRecovery(source.record.checkpoint);
      if (!title && !note && !outline && !move) return [];
      return [{ id: source.id, title: t(title ? 'legacyRecovery.field.title' : note ? 'planEditor.note.label'
        : move ? 'planEditor.recoveredPointPosition' : 'planEditor.title'),
        preview: title?.mine ?? note?.mine ?? outlineWords(outline?.mine ?? move?.mine ?? null, t), wholeOutline: Boolean(outline || move),
        discard: () => document.discardRecovery(source) }];
    }),
    recover: document.recover,
  });
}

function outlineWords(outline: SermonOutline | null, t: TFunction): string {
  const empty = t('dataSync.emptyField');
  return (outline && SECTION_KEYS.flatMap(section => {
    const points = outline[section] ?? [];
    return points.length ? [getSectionLabel(t, section), ...points.flatMap((point, index) =>
      [`${index + 1}. ${point.text || empty}`, ...(point.note ? ['  ' + point.note] : []),
        ...(point.subPoints ?? []).map(sub => '  ↳ ' + (sub.text || empty) + (sub.note ? '\n     ' + sub.note : ''))]), ''] : [];
  }).join('\n').trimEnd()) || t('plan.draftRecoveryEmpty');
}

const ReviewContext = createContext<{ document: OutlineDocument; enabled: boolean;
  saved: ReturnType<typeof useSavedOutlineChoices> } | null>(null);

export function OutlineEditReviewProvider({ document, enabled, showActiveOutline, children }: PropsWithChildren<{
  document: OutlineDocument;
  enabled: boolean;
  showActiveOutline: boolean;
}>) {
  const saved = useSavedOutlineChoices(document, enabled);
  return <ReviewContext.Provider value={{ document, enabled, saved }}>
    <OutlineEditReview includeActiveOutline={showActiveOutline} className="mx-3 mt-3" />
    {children}
  </ReviewContext.Provider>;
}

function waitsToReview(context: NonNullable<ContextType<typeof ReviewContext>>) {
  return hasUnsettledSave(context.document) && context.saved.choices.some(choice => choice.wholeOutline);
}

export function useHasActiveOutlineEditReview() {
  const context = useContext(ReviewContext);
  const checkpoint = context?.document.state?.checkpoint;
  return Boolean(context?.enabled && checkpoint
    && (readSermonOutlineReview(checkpoint) || readSermonPointMoveRecovery(checkpoint) || readOutlineNoteConflict(checkpoint) || waitsToReview(context)));
}

/** The plan editor opens over the workspace and gives the same document's active question a place inside it. */
export function OutlineEditReview({ includeActive, includeActiveOutline = includeActive, className, onResolved }: {
  includeActive?: boolean;
  includeActiveOutline?: boolean;
  className?: string;
  onResolved?: (outline: SermonOutline) => void;
}) {
  const { t } = useTranslation();
  const context = useContext(ReviewContext);
  if (!context?.enabled) return null;
  const { document, saved } = context;
  const checkpoint = document.state?.checkpoint;
  const outline = includeActiveOutline && checkpoint ? readSermonOutlineReview(checkpoint) : undefined;
  const note = includeActive && checkpoint ? readOutlineNoteConflict(checkpoint) : undefined;
  const move = includeActiveOutline && checkpoint ? readSermonPointMoveRecovery(checkpoint) : undefined;
  const comparison = outline ? {
    identity: outline.identity, title: t('planEditor.title'), valueKind: 'field' as const, scopedChoice: true as const,
    description: outline.requiresWholeChoice ? t('planEditor.wholeStructureDescription') : undefined,
    mine: outlineWords(outline.mine, t), stored: outlineWords(outline.stored, t),
    keepMineDisabled: !outline.canKeep,
    ...(outline.requiresWholeChoice && { actions: { local: t('planEditor.useWholeLocalStructure'), stored: t('dataSync.useStoredVersion') } }),
  } : move ? {
    identity: move.identity, title: t('planEditor.recoveredPointPosition'), valueKind: 'field' as const, scopedChoice: true as const,
    description: t(move.canSave ? 'planEditor.pointMoveReady' : 'planEditor.pointMoveNeedsReview'),
    mine: outlineWords(move.mine, t), stored: outlineWords(move.stored, t),
    keepMineDisabled: !move.canSave,
    actions: { local: t('planEditor.savePointPosition'), stored: t('planEditor.keepStoredPointOrder') },
  } : note ? {
    identity: note.identity, title: t('planEditor.note.label'), valueKind: 'field' as const, scopedChoice: true as const,
    mine: note.mine ?? t('dataSync.emptyField'), stored: note.stored ?? t('dataSync.emptyField'),
  } : includeActive && checkpoint ? outlineTitleComparison(checkpoint, t) : undefined;
  const status = (outline || move) && document.status ? { ...document.status, phase: 'conflict' as const,
    canKeepLocal: outline ? true : Boolean(move?.canUseStored), canAcceptRemote: outline ? true : Boolean(move?.canUseStored) } : document.status;
  const choices = document.status?.phase === 'saved' ? saved.choices : [];
  if (!comparison && !choices.length && !saved.error) {
    if (includeActiveOutline && waitsToReview(context)) {
      return <p role="status" className={`text-sm text-gray-600 dark:text-gray-300 ${className ?? ''}`}>{t('planEditor.outlineReviewWaiting')}</p>;
    }
    return null;
  }
  const choose = async (side: 'local' | 'stored') => {
    if (side === 'local') await document.keepLocal(checkpoint);
    else await document.acceptRemote(checkpoint);
    const outline = document.readLiveSermonOutline();
    if (outline) onResolved?.(outline);
  };
  return <DataSyncStatus subject={document.recoveryIdentity} status={comparison ? status : null}
    className={className} comparison={comparison}
    onKeepLocal={comparison ? () => choose('local') : undefined} onAcceptRemote={comparison ? () => choose('stored') : undefined}
    recoveryChoices={choices} reviewRecoveryId={choices.length === 1 ? choices[0].id : undefined}
    recoveryError={saved.error} recoveryLoading={saved.loading} onRecover={saved.recover} onDiscardRecovery={saved.discard} />;
}
