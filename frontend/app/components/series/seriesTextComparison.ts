import { seriesTextChoiceFields } from '@/data-engine/react.client';
import { storedFieldValue } from '@/utils/storedFieldValue';

import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { DocumentData } from '@/data-engine/types';

export function seriesTextComparison(paths: readonly (readonly string[])[], mine: DocumentData | null,
  stored: DocumentData | null, identity: string, t: (key: string) => string): TextComparison | undefined {
  const field = seriesTextChoiceFields(paths, mine, stored)?.[0];
  if (!field) return;
  const text = (value: unknown) => typeof value === 'string' && value
    ? String(storedFieldValue(t, 'series', field, value)) : t('dataSync.emptyField');
  return { identity, title: t('workspaces.series.form.' + field),
    mine: text(mine?.[field]), stored: text(stored?.[field]), valueKind: 'field', scopedChoice: true };
}
