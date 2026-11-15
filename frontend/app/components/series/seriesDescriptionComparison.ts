import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { DocumentData } from '@/data-engine/types';

export function seriesDescriptionComparison(paths: readonly (readonly string[])[], mine: DocumentData | null,
  stored: DocumentData | null, identity: string, label: string, empty: string): TextComparison | undefined {
  if (paths.length !== 1 || paths[0].length !== 1 || paths[0][0] !== 'description' || !mine || !stored) return;
  const localText = mine.description;
  const storedText = stored.description;
  if (localText === storedText || (localText !== undefined && typeof localText !== 'string')
    || (storedText !== undefined && typeof storedText !== 'string')) return;
  return { identity, title: label, mine: localText || empty, stored: storedText || empty, valueKind: 'field', scopedChoice: true };
}
