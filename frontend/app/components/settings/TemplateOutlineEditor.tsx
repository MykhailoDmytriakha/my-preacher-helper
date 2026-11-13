'use client';

import { forwardRef, useImperativeHandle, useRef } from 'react';

import OutlineBoard from '@/components/plan-editor/OutlineBoard';
import { OutlinePointPlacementHistory } from '@/components/plan-editor/OutlinePointPlacementHistory';
import { outlinePointConflictComparison, outlinePointPlacementWords } from '@/components/plan-editor/outlinePointPlacementWords';
import { outlineTitleComparison } from '@/components/plan-editor/outlineTitleComparison';
import { OutlineTitleDraftNotices } from '@/components/plan-editor/OutlineTitleDrafts';
import { OutlineTitleHistory } from '@/components/plan-editor/OutlineTitleHistory';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { captureOutlinePointPlacement, captureOutlineSubpointMove, projectResourceOutlinePoint, useDataDocument, useDocumentActions, useRecoveryDiscovery } from '@/data-engine/react.client';
import { outlinePointText } from '@/utils/outlineDnd';
import { outlinePointGridClass } from '@/utils/structureBoardLayout';
import { NEUTRAL_CAPTION } from '@/utils/themeColors';
import { useTranslation } from '@locales/useTranslation';

import type { SermonOutline } from '@/models/models';

export interface TemplateOutlineEditorHandle {
  capture: () => Promise<void>;
  remove: () => Promise<void>;
  snapshot: () => string;
}

/** The document owns points and their lifetime; the surrounding list owns only selection. */
const TemplateOutlineEditor = forwardRef<TemplateOutlineEditorHandle, { templateId: string; disabled: boolean }>(
  function TemplateOutlineEditor({ templateId, disabled }, ref) {
    const { t } = useTranslation();
    const actions = useDocumentActions();
    const document = useDataDocument({ collection: 'planTemplates', id: templateId },
      { slot: 'template-structure', autoSaveDelayMs: 400, readOnlyCopy: true });
    const latest = useRef(document);
    latest.current = document;
    const identity = document.recoveryIdentity;
    useImperativeHandle(ref, () => {
      const current = () => {
        if (latest.current.recoveryIdentity !== identity) throw new Error('The template editor changed');
        return latest.current;
      };
      return {
        // save() captures locally. Delivery and any later refusal remain engine-owned.
        capture: async () => { const document = current(); if (document.state) await document.save(); },
        remove: async () => { await current().remove(); },
        snapshot: () => JSON.stringify([templateId, current().data?.structure]),
      };
    }, [templateId, identity]);
    const recovery = useRecoveryDiscovery({ identity: document.recoveryIdentity,
      enabled: !document.loading && document.status !== null,
      version: JSON.stringify([document.status?.phase, document.confirmed?.metadata?.revision]),
      list: async () => (await document.listRecoverable()).map(source => {
        const { checkpoint, retainedManualChoice } = source.record;
        const name = String(checkpoint.draft?.name ?? checkpoint.confirmed.value?.name ?? t('settings.planTemplates'));
        const outline = checkpoint.draft?.structure as unknown as SermonOutline | undefined;
        const move = retainedManualChoice?.outlinePointPlacement?.placement;
        const title = move && outline
          ? [t('planEditor.pointPlacement.position'), outlinePointText(outline, move.pointId),
            outlinePointPlacementWords(move.destination, outline, t)].filter(Boolean).join(' · ')
          : retainedManualChoice?.templateFieldsGeneration !== undefined ? name + ' · ' + t('structure.content') : name;
        return { id: source.id, title, discard: () => document.discardRecovery(source) };
      }),
      recover: document.recover });
    const checkpoint = document.state?.checkpoint;
    const comparison = checkpoint && (outlinePointConflictComparison(checkpoint, t, (side, titles) =>
    side === 'local' ? document.keepLocal(checkpoint, titles) : document.acceptRemote(checkpoint, titles)) ?? outlineTitleComparison(checkpoint, t));
    const compared = comparison ? checkpoint : undefined;
    const generation = document.confirmed?.metadata?.generation;
    const owner = document.confirmed?.value?.userId;
    const outline = document.data?.structure as unknown as SermonOutline | undefined;
    const movePoint = (after: SermonOutline, pointId: string) => {
      const before = document.data?.structure as unknown as SermonOutline | undefined;
      if (!before) return;
      const move = captureOutlinePointPlacement(before, after, pointId, document.confirmed?.metadata?.generation ?? null,
        document.confirmed?.metadata?.revision ?? 0, actions.captureActionTime() ?? null);
      if (!move) return;
      return document.commit(current => {
        const next = projectResourceOutlinePoint('planTemplates', current, move, true);
        if (!next) throw Object.assign(new Error('The shown template outline changed'), { code: 'decision-changed' });
        return next;
      }, { kind: 'outline-point-placement', move });
    };
    const moveSubpoint = (structure: SermonOutline, subPointId: string) => {
      const revision = document.confirmed?.metadata?.revision;
      const move = revision !== undefined && captureOutlineSubpointMove(outline, structure, subPointId,
        revision, actions.captureActionTime() ?? null);
      const update = (current: typeof document.data) => {
        if (!current || current.structure === undefined) throw new Error('The shown template outline changed');
        return { ...current, structure: structure as never };
      };
      return move ? document.commit(update, { kind: 'outline-subpoint-placement', move }) : document.update(update);
    };
    return <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <DataSyncStatus subject={document.recoveryIdentity} status={document.status} error={document.error} errorWords={document.errorWords}
        comparison={comparison} onRetry={document.retry}
        onKeepLocal={async () => { await document.keepLocal(compared); await document.save(); }}
        onAcceptRemote={() => document.acceptRemote(compared)} recoveryChoices={recovery.choices}
        recoveryLoading={recovery.loading} recoveryError={recovery.error} onRecover={recovery.recover}
        onDiscardRecovery={recovery.discard} />
      <OutlineTitleDraftNotices />
      {generation && typeof owner === 'string' && outline && <OutlinePointPlacementHistory owner={owner} id={templateId}
        collection="planTemplates" generation={generation} outline={outline} disabled={disabled || document.readOnly || Boolean(comparison)}
        restore={async (next, pointId, subpoint) => subpoint ? moveSubpoint(next, pointId) : movePoint(next, pointId)} />}
      {generation && typeof owner === 'string' && outline && <OutlineTitleHistory key={generation}
        owner={owner} collection="planTemplates" id={templateId} generation={generation} outline={outline}
        disabled={disabled || document.readOnly || Boolean(comparison)}
        restore={(opening, title) => document.captureTemplateTitle(opening)(title)} />}
      {document.loading && !document.data ? <p className={`text-sm ${NEUTRAL_CAPTION}`}>{t('settings.loading')}</p>
        : document.data && <OutlineBoard value={document.data.structure as unknown as SermonOutline}
          isReadOnly={disabled || document.readOnly} onPointMove={(next, id) => { void movePoint(next, id)?.catch(() => undefined); }}
          onSubPointPlacement={(next, id) => { void moveSubpoint(next, id).catch(() => undefined); }} captureTitleEdit={document.captureTemplateTitle} className={`${outlinePointGridClass} gap-3`}
          onChange={structure => { void document.update(current => current ? { ...current, structure: structure as never } : current).catch(() => undefined); }} />}
    </fieldset>;
  }
);

export default TemplateOutlineEditor;
