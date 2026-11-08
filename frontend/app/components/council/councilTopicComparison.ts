import { COUNCIL_ASSEMBLY, councilAssemblyRow } from '@/data-engine/councilAssemblyAction';
import { COUNCIL_TOPIC_KIND, councilTopicKindRow } from '@/data-engine/councilTopicKindAction';
import { COUNCIL_TOPIC_TITLE, councilTopicTitleRow } from '@/data-engine/councilTopicTitleAction';
import { equalValues } from '@/data-engine/fieldValues';
import { existingRowField, replaceExistingRowField } from '@/data-engine/rowFieldAction';

import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { RowFieldTarget, RowValue } from '@/data-engine/rowFieldAction';
import type { SessionCheckpoint } from '@/data-engine/session';

function compareTopicField<Value extends RowValue>(checkpoint: SessionCheckpoint, id: string, target: RowFieldTarget<Value>,
  title: string, display: (value: Value) => string): TextComparison | undefined {
  const { confirmed, draft, remoteCandidate } = checkpoint;
  if (!draft || !confirmed.value || !remoteCandidate?.value) return undefined;
  const before = existingRowField(confirmed.value.topics, id, target);
  const mine = existingRowField(draft.topics, id, target);
  const stored = existingRowField(remoteCandidate.value.topics, id, target);
  if (before === undefined || mine === undefined || stored === undefined || equalValues(mine, stored)) return undefined;
  const { updatedAt: _local, ...local } = draft;
  const { updatedAt: _base, ...base } = confirmed.value;
  if (!equalValues({ ...local, topics: replaceExistingRowField(local.topics, id, before, target) },
    { ...base, topics: replaceExistingRowField(base.topics, id, before, target) })) return undefined;
  return { title, valueKind: 'field', mine: display(mine), stored: display(stored), scopedChoice: true,
    identity: JSON.stringify([checkpoint.editGeneration, remoteCandidate.metadata?.generation, remoteCandidate.metadata?.revision, id, target.leaf, mine, stored]) };
}

export function councilTopicComparison(checkpoint: SessionCheckpoint | undefined, t: (key: string) => string): TextComparison | undefined {
  if (!checkpoint || checkpoint.conflicts.length !== 1 || Object.keys(checkpoint.pending).length !== 1) return undefined;
  const path = checkpoint.conflicts[0].path;
  const title = councilTopicTitleRow(path);
  if (title) return compareTopicField(checkpoint, title, COUNCIL_TOPIC_TITLE, t('council.detail.newTopicPlaceholder'),
    value => value || t('council.topicTitleHistory.untitled'));
  const kind = councilTopicKindRow(path);
  if (kind) return compareTopicField(checkpoint, kind, COUNCIL_TOPIC_KIND, t('council.topic.kind'),
    value => t(value === 'info' ? 'council.topic.kindInfo' : 'council.topic.kindDecision'));
  const assembly = councilAssemblyRow(path);
  if (assembly) return compareTopicField(checkpoint, assembly, COUNCIL_ASSEMBLY, t('council.topic.forAssembly'),
    value => t(value ? 'council.assemblyHistory.marked' : 'council.assemblyHistory.unmarked'));
}
