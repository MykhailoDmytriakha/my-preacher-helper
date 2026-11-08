import { COUNCIL_TOPIC_TITLE, councilTopicTitleRow } from '@/data-engine/councilTopicTitleAction';
import { equalValues } from '@/data-engine/fieldValues';
import { existingRowField, replaceExistingRowField } from '@/data-engine/rowFieldAction';

import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { SessionCheckpoint } from '@/data-engine/session';

export function councilTopicTitleComparison(checkpoint: SessionCheckpoint | undefined, t: (key: string) => string): TextComparison | undefined {
  if (!checkpoint || checkpoint.conflicts.length !== 1 || Object.keys(checkpoint.pending).length !== 1) return undefined;
  const { confirmed, draft, remoteCandidate, conflicts } = checkpoint;
  const id = councilTopicTitleRow(conflicts[0].path);
  if (!id || !draft || !confirmed.value || !remoteCandidate?.value) return undefined;
  const before = existingRowField(confirmed.value.topics, id, COUNCIL_TOPIC_TITLE);
  const mine = existingRowField(draft.topics, id, COUNCIL_TOPIC_TITLE);
  const stored = existingRowField(remoteCandidate.value.topics, id, COUNCIL_TOPIC_TITLE);
  if (before === undefined || mine === undefined || stored === undefined || mine === stored) return undefined;
  const { updatedAt: _local, ...local } = draft;
  const { updatedAt: _base, ...base } = confirmed.value;
  if (!equalValues({ ...local, topics: replaceExistingRowField(local.topics, id, before, COUNCIL_TOPIC_TITLE) }, base)) return undefined;
  const blank = t('council.topicTitleHistory.untitled');
  return { title: t('council.detail.newTopicPlaceholder'), valueKind: 'field', mine: mine || blank, stored: stored || blank, scopedChoice: true,
    identity: JSON.stringify([checkpoint.editGeneration, remoteCandidate.metadata?.generation, remoteCandidate.metadata?.revision, id, mine, stored]) };
}
