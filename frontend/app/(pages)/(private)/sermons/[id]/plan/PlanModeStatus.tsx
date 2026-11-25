import { planModeComparison } from '@/components/sermon/planModeComparison';
import { sermonConflictComparison } from '@/components/sermon/sermonConflictComparison';
import { DocumentFieldHistory } from '@/components/ui/DocumentFieldHistory';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { isSermonPlanMode, sermonPlacedSketchDraft, useDataEngine, useRecoveryDiscovery } from '@/data-engine/react.client';
import { liveNodeIds } from '@/utils/planText';
import { useTranslation } from '@locales/useTranslation';

import { usePlanWriter } from './planWriter';

import type { PlanOrphanCell } from './planDraftTypes';
import type { useDataDocument } from '@/data-engine/react.client';
import type { Sermon } from '@/models/models';

type SermonDocument = ReturnType<typeof useDataDocument>;

export function usePlanRecovery(document: SermonDocument, outline: Sermon['outline']) {
  const live = liveNodeIds(outline);
  const phase = document.status?.phase;
  const canRecover = !document.readOnly && Boolean(document.state?.durable && phase === 'saved');
  const recovery = useRecoveryDiscovery({
    identity: document.recoveryIdentity,
    enabled: Boolean(document.recoveryIdentity) && !document.loading,
    version: JSON.stringify([document.confirmed?.metadata?.generation, document.confirmed?.metadata?.revision, canRecover]),
    list: async () => (await document.listRecoverable()).filter(source =>
      source.record.checkpoint.planCellDrafts || sermonPlacedSketchDraft(source.record) !== undefined),
    recover: document.recover,
  });
  const orphaned: PlanOrphanCell[] = [];
  const offers = recovery.choices.flatMap(source => {
    const cells = Object.entries(source.record.checkpoint.planCellDrafts ?? {});
    const [first] = cells;
    if (!first) return [];
    const [nodeId, cell] = first;
    const discard = async () => {
      try { await document.discardRecovery(source); }
      finally { await recovery.refresh(); }
    };
    if (source.record.planCellAlternative && cells.length === 1 && !live.has(nodeId)) {
      orphaned.push({ id: nodeId, text: cell.text, copyKey: JSON.stringify([source.id, source.record.recoveryVersion]),
        discard });
      return [];
    }
    const version = source.record.recoveryVersion;
    return [{ id: JSON.stringify([source.id, version]),
      cells: Object.fromEntries(cells.map(([id, copy]) => [id, copy.text])),
      restore: async () => {
        await document.recover(source.id, source.discardRecord ?? source.record);
        await recovery.refresh();
      },
      discard }];
  });
  const retainOrphan = async (nodeId: string, text: string) => {
    if (!await document.retainPlanCellAlternative(nodeId, text)) return false;
    await recovery.refresh();
    return true;
  };
  return { ...recovery, canRecover, offers, orphaned, retainOrphan };
}

export type PlanRecovery = ReturnType<typeof usePlanRecovery>;

export function PlanModeStatus({ document, recovery }: { document: SermonDocument; recovery: PlanRecovery }) {
  const { t, language } = useTranslation();
  const checkpoint = document.state?.checkpoint;
  if (document.readOnly) return null;
  const comparison = checkpoint && (sermonConflictComparison(checkpoint, t, language, (side, titles) =>
    side === 'local' ? document.keepLocal(checkpoint, titles) : document.acceptRemote(checkpoint, titles)) ?? planModeComparison(checkpoint, t));
  const keepLocal = async () => {
    const cells = checkpoint?.conflicts.flatMap(({ path }) =>
      path[0] === 'planText' && path.length === 2 && checkpoint.planCellDrafts?.[path[1]] ? [path[1]] : []);
    await document.keepLocal(comparison ? checkpoint : undefined);
    if (cells?.length) await document.savePlanCells(cells);
  };
  return <div className="px-4 pt-4 empty:hidden"><DataSyncStatus subject={document.recoveryIdentity}
    status={document.status} error={document.error} errorWords={document.errorWords} onRetry={document.retry}
    comparison={comparison} onKeepLocal={keepLocal}
    onAcceptRemote={() => document.acceptRemote(comparison ? checkpoint : undefined)}
    recoveryChoices={recovery.canRecover ? recovery.choices.flatMap(source => {
      const preview = sermonPlacedSketchDraft(source.record);
      return preview === undefined ? [] : [{ id: source.id, title: t('scratch.card.label'), preview,
        discard: () => document.discardRecovery(source) }];
    }) : []}
    onRecover={id => {
      const source = recovery.choices.find(choice => choice.id === id);
      return source && document.recover(id, source.discardRecord ?? source.record);
    }}
    onDiscardRecovery={recovery.discard}
    recoveryLoading={recovery.loading} recoveryError={recovery.canRecover ? recovery.error : null} /></div>;
}

export function PlanModeHistory({ document, sermonId }: { document: SermonDocument; sermonId: string }) {
  const { owner } = useDataEngine();
  const writer = usePlanWriter();
  const generation = document.confirmed?.metadata?.generation;
  if (document.readOnly || !owner || !generation) return null;
  const current = document.data?.planMode;
  return <DocumentFieldHistory key={generation} current={isSermonPlanMode(current) ? current : null}
    disabled={Boolean(document.status?.canKeepLocal)}
    session={{ owner, sermonId, generation, field: 'plan-mode', restore: mode => {
      if (!isSermonPlanMode(mode)) throw new Error('Invalid plan mode');
      return writer.savePlanMode(sermonId, mode);
    } }} />;
}
