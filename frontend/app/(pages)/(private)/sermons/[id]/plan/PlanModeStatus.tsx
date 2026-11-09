import { planModeComparison } from '@/components/sermon/planModeComparison';
import { DocumentFieldHistory } from '@/components/ui/DocumentFieldHistory';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { isSermonPlanMode, useDataEngine } from '@/data-engine/react.client';
import { useTranslation } from '@locales/useTranslation';

import { usePlanWriter } from './planWriter';

import type { useDataDocument } from '@/data-engine/react.client';

type SermonDocument = ReturnType<typeof useDataDocument>;

export function PlanModeStatus({ document }: { document: SermonDocument }) {
  const { t } = useTranslation();
  if (document.readOnly) return null;
  const checkpoint = document.state?.checkpoint;
  const comparison = checkpoint && planModeComparison(checkpoint, t);
  return <div className="px-4 pt-4 empty:hidden"><DataSyncStatus subject={document.recoveryIdentity}
    status={document.status} error={document.error} errorWords={document.errorWords} onRetry={document.retry}
    comparison={comparison} onKeepLocal={() => document.keepLocal(comparison ? checkpoint : undefined)}
    onAcceptRemote={() => document.acceptRemote(comparison ? checkpoint : undefined)} /></div>;
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
