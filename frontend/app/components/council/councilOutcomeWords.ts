import type { CouncilOutcome } from '@/data-engine/councilOutcomeAction';
import type { CouncilTopic } from '@/models/models';

export function councilOutcomeWords(outcome: CouncilOutcome, topic: CouncilTopic | undefined, t: (key: string) => string): string {
  if (outcome.resolution) return t(outcome.resolution === 'postponed' ? 'council.topic.postponed' : 'council.topic.dropped');
  const option = outcome.acceptedOptionId
    ? topic?.options.find(item => item.id === outcome.acceptedOptionId)?.text || t('council.outcomeHistory.unavailableOption')
    : null;
  return [option, outcome.decision].filter(Boolean).join(' — ')
    || t(outcome.discussed ? 'council.topic.tell' : 'council.outcomeHistory.emptyOutcome');
}
