import { readSermonPlanModeComparison } from '@/data-engine/react.client';
import { storedFieldValue } from '@/utils/storedFieldValue';

import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { SessionCheckpoint } from '@/data-engine/session';
import type { FieldValue } from '@/data-engine/types';

export function planModeComparison(checkpoint: SessionCheckpoint, t: (key: string) => string): TextComparison | undefined {
  const compared = readSermonPlanModeComparison(checkpoint);
  if (!compared) return undefined;
  const name = (value: FieldValue) => value.exists
    ? String(storedFieldValue(t, 'sermons', 'planMode', value.value))
    : t('legacyRecovery.absent');
  return { identity: compared.identity, title: t('plan.modeLabel'), valueKind: 'field', scopedChoice: true,
    mine: name(compared.mine), stored: name(compared.stored) };
}
