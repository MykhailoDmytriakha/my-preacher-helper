import { readOutlineTitleComparison } from '@/data-engine/react.client';

import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { SessionCheckpoint } from '@/data-engine/session';

export function outlineTitleComparison(checkpoint: SessionCheckpoint, t: (key: string) => string): TextComparison | undefined {
  const title = readOutlineTitleComparison(checkpoint);
  if (!title) return undefined;
  return { identity: title.identity, title: t('legacyRecovery.field.title'), valueKind: 'field', scopedChoice: true,
    mine: title.mine, stored: title.stored ?? t('dataSync.exegeticalPointRemoved'), keepMineDisabled: title.removed };
}
