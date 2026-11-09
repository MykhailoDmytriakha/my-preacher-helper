type TopicOutcomeFields = Partial<Record<'discussed' | 'acceptedOptionId' | 'decision' | 'resolution', unknown>>;

export function recordedCouncilTopicOutcome(topic: TopicOutcomeFields) {
  return [topic.discussed === true, topic.acceptedOptionId || '', topic.decision || '', topic.resolution || ''];
}

export function hasRecordedCouncilTopicOutcome(topic: TopicOutcomeFields): boolean {
  return recordedCouncilTopicOutcome(topic).some(Boolean);
}

export function councilDecisionText(topic: TopicOutcomeFields & { options?: unknown }): string {
  const chosen = Array.isArray(topic.options) ? topic.options.find(option => option?.id === topic.acceptedOptionId) : undefined;
  const accepted = typeof chosen?.text === 'string' ? chosen.text : undefined;
  const decision = typeof topic.decision === 'string' ? topic.decision.trim() : undefined;
  if (accepted && decision) return `${accepted} — ${decision}`;
  return accepted ?? decision ?? '';
}

export function councilOutcomeLogText(topic: TopicOutcomeFields & { kind?: unknown; options?: unknown }): string {
  return councilDecisionText(topic) || (typeof topic.resolution === 'string' ? topic.resolution : '')
    || (topic.kind === 'info' && topic.discussed ? 'told' : '');
}
