import { readThoughtTagComparison, useOpenDocumentAnswerScopes } from '@/data-engine/react.client';
import { useTranslation } from '@locales/useTranslation';

import type { TextComparison } from '@/data-engine/DataSyncStatus';

export function useThoughtTagComparison(checkpoint: Parameters<typeof readThoughtTagComparison>[0] | undefined,
  owner: string | null, sermonId: string): TextComparison | undefined {
  const { t } = useTranslation();
  const answers = useOpenDocumentAnswerScopes();
  if (!checkpoint || !owner) return undefined;
  const [operationId] = Object.keys(checkpoint.pending);
  const owned = answers.filter(answer => answer.owner === owner && answer.resource.collection === 'sermons'
    && answer.resource.id === sermonId && answer.operationIds.includes(operationId));
  if (!owned.length || owned.some(answer => answer.operationIds.length !== 1 || answer.laterSaves?.length)) return undefined;
  const comparison = readThoughtTagComparison(checkpoint);
  if (!comparison) return undefined;
  const [first] = comparison.tags;
  const oneThought = comparison.tags.every(tag => tag.rowId === first.rowId);
  const snippet = (text: string) => text.length > 100 ? text.slice(0, 100).trimEnd() + '…' : text;
  const label = t('thought.tagHistory.comparison');
  const show = (side: 'mine' | 'stored') => comparison.tags.map(tag => [
    ...(oneThought ? [] : [snippet(tag.text)]),
    tag.tag + ' · ' + t(tag[side] ? 'thought.tagHistory.added' : 'thought.tagHistory.removed'),
  ].join('\n')).join('\n\n');
  return { identity: comparison.identity, title: oneThought ? label + ' · ' + snippet(first.text) : label,
    valueKind: 'field', scopedChoice: true, mine: show('mine'), stored: show('stored') };
}
