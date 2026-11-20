import { seriesTextChoiceFields } from '@/data-engine/documentTextChoice';

import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { DocumentData } from '@/data-engine/types';

export function seriesTextComparison(paths: readonly (readonly string[])[], mine: DocumentData | null,
  stored: DocumentData | null, identity: string, labels: { title: string; description: string }, empty: string): TextComparison | undefined {
  const field = seriesTextChoiceFields(paths, mine, stored)?.[0];
  if (field !== 'title' && field !== 'description') return;
  const localText = mine?.[field];
  const storedText = stored?.[field];
  if (localText === storedText || (localText !== undefined && typeof localText !== 'string')
    || (storedText !== undefined && typeof storedText !== 'string')) return;
  return { identity, title: labels[field], mine: localText || empty, stored: storedText || empty, valueKind: 'field', scopedChoice: true };
}
