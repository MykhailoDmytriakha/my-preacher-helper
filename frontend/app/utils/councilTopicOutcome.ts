type TopicOutcomeFields = Partial<Record<'discussed' | 'acceptedOptionId' | 'decision' | 'resolution', unknown>>;

export function recordedCouncilTopicOutcome(topic: TopicOutcomeFields) {
  return [topic.discussed === true, topic.acceptedOptionId || '', topic.decision || '', topic.resolution || ''];
}

export function hasRecordedCouncilTopicOutcome(topic: TopicOutcomeFields): boolean {
  return recordedCouncilTopicOutcome(topic).some(Boolean);
}
