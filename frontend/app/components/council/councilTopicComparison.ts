import { readCouncilTopicConflict } from '@/data-engine/react.client';

import { councilOutcomeWords } from './councilOutcomeWords';

import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { SessionCheckpoint } from '@/data-engine/session';
import type { CouncilTopic } from '@/models/models';

export function councilTopicComparison(checkpoint: SessionCheckpoint | undefined, t: (key: string) => string, topics?: readonly CouncilTopic[]): TextComparison | undefined {
  const comparison = checkpoint && readCouncilTopicConflict(checkpoint);
  if (!comparison) return undefined;
  const { field, mine, stored, identity } = comparison;
  const scope = { identity, valueKind: 'field' as const, scopedChoice: true as const };
  if (field === 'outcome') {
    const topic = topics?.find(item => item.id === comparison.rowId);
    return { ...scope, title: t('council.topic.atCouncil'), mine: councilOutcomeWords(mine, topic, t), stored: councilOutcomeWords(stored, topic, t) };
  }
  if (field === 'title') {
    const untitled = t('council.topicTitleHistory.untitled');
    return { ...scope, title: t('council.detail.newTopicPlaceholder'), mine: mine || untitled, stored: stored || untitled };
  }
  if (field === 'kind') {
    const label = (value: typeof mine) => t(value === 'info' ? 'council.topic.kindInfo' : 'council.topic.kindDecision');
    return { ...scope, title: t('council.topic.kind'), mine: label(mine), stored: label(stored) };
  }
  const label = (value: boolean) => t(value ? 'council.assemblyHistory.marked' : 'council.assemblyHistory.unmarked');
  return { ...scope, title: t('council.topic.forAssembly'), mine: label(mine), stored: label(stored) };
}
