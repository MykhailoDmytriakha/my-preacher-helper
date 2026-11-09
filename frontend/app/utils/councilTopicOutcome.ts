type TopicOutcomeFields = Partial<Record<'discussed' | 'acceptedOptionId' | 'decision' | 'resolution', unknown>>;

export type CouncilOutcome = {
  discussed: boolean;
  acceptedOptionId: string | null;
  decision: string | null;
  resolution: 'postponed' | 'dropped' | null;
};

export const COUNCIL_OUTCOME_FIELDS = ['discussed', 'acceptedOptionId', 'decision', 'resolution'] as const;
const textOrEmpty = (value: unknown): value is string | null => value === null || (typeof value === 'string' && value.length > 0);
const resolution = (value: unknown): value is CouncilOutcome['resolution'] => value === null || value === 'postponed' || value === 'dropped';

export function isCouncilOutcome(value: unknown): value is CouncilOutcome {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const outcome = value as Record<string, unknown>;
  return Object.keys(outcome).length === COUNCIL_OUTCOME_FIELDS.length
    && typeof outcome.discussed === 'boolean' && textOrEmpty(outcome.acceptedOptionId) && textOrEmpty(outcome.decision) && resolution(outcome.resolution);
}

export function readCouncilOutcome(topic: TopicOutcomeFields): CouncilOutcome | undefined {
  const value = { discussed: topic.discussed === true, acceptedOptionId: topic.acceptedOptionId || null,
    decision: topic.decision || null, resolution: topic.resolution ?? null };
  return isCouncilOutcome(value) ? value : undefined;
}

export function sameCouncilOutcome(first: CouncilOutcome, second: CouncilOutcome): boolean {
  return COUNCIL_OUTCOME_FIELDS.every(field => first[field] === second[field]);
}

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
