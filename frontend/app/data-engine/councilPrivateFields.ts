import { councilLifecycleValue, withCouncilLifecycle } from './councilFieldAction';
import { COUNCIL_OUTCOME, COUNCIL_OUTCOME_FIELDS, councilOutcomeRow, incompatibleCouncilOutcome, type CouncilOutcome } from './councilOutcomeAction';
import { COUNCIL_TOPIC_KIND } from './councilTopicKindAction';
import { COUNCIL_TOPIC_SUMMARY_POLICY, COUNCIL_TOPIC_TITLE, councilTopicTitleRow } from './councilTopicTitleAction';
import { equalValues, object, readField, writeField } from './fieldValues';
import { readPrivateFieldReview } from './privateFieldReview';
import { existingRowField, replaceExistingRowField } from './rowFieldAction';

import type { FieldSelection } from './privateFieldReview';
import type { SessionCheckpoint } from './session';
import type { DocumentData, FieldValue } from './types';

type CouncilPrivateField = { path: string[] } & (
  { field: 'title' | 'date' | 'heldAt'; mine: string | null; stored: string | null }
  | { field: 'summary'; birth: string; mine: string | null; stored: string | null }
  | { field: 'topic-title'; birth: string; mine: string; stored: string }
  | { field: 'outcome'; birth: string; mine: CouncilOutcome; stored: CouncilOutcome; localAvailable?: false }
);
function words(value: FieldValue | undefined) {
  return !value ? undefined : !value.exists ? null : typeof value.value === 'string' ? value.value : undefined;
}

export function readCouncilOutcomeVersions(id: string, opening: DocumentData, draft: DocumentData, saved: DocumentData) {
  const kind = existingRowField(opening.topics, id, COUNCIL_TOPIC_KIND);
  if (!kind || kind !== existingRowField(draft.topics, id, COUNCIL_TOPIC_KIND)
    || kind !== existingRowField(saved.topics, id, COUNCIL_TOPIC_KIND)) return undefined;
  const mine = existingRowField(draft.topics, id, COUNCIL_OUTCOME);
  const stored = existingRowField(saved.topics, id, COUNCIL_OUTCOME);
  return mine && stored && !incompatibleCouncilOutcome(mine) && !incompatibleCouncilOutcome(stored) ? { mine, stored } : undefined;
}

export function councilOutcomeOptionAvailable(topics: unknown, id: string, outcome: CouncilOutcome): boolean {
  if (!outcome.acceptedOptionId) return true;
  const topic = Array.isArray(topics) ? topics.find(row => object(row) && row.id === id) : undefined;
  const options = object(topic) && topic.options;
  return Array.isArray(options) && options.some(option => object(option) && option.id === outcome.acceptedOptionId);
}

function readCouncilField(checkpoint: SessionCheckpoint, path: string[]): CouncilPrivateField | undefined {
  const { confirmed, draft, remoteCandidate } = checkpoint;
  const saved = remoteCandidate?.value;
  if (!confirmed.value || !draft || !saved) return undefined;
  const outcome = councilOutcomeRow(path);
  if (outcome) {
    const versions = readCouncilOutcomeVersions(outcome, confirmed.value, draft, saved);
    return versions && { field: 'outcome', path, birth: outcome, ...versions };
  }
  if (path.length === 3 && path[0] === 'topics' && path[1].startsWith('id:') && path[2] === 'summary') {
    const birth = path[1].slice(3), target = COUNCIL_TOPIC_SUMMARY_POLICY.target('summary');
    const opening = existingRowField(confirmed.value.topics, birth, target);
    const mine = existingRowField(draft.topics, birth, target), stored = existingRowField(saved.topics, birth, target);
    return opening !== undefined && mine !== undefined && stored !== undefined
      ? { field: 'summary', path, birth, mine, stored } : undefined;
  }
  const topic = councilTopicTitleRow(path);
  if (topic) {
    const opening = existingRowField(confirmed.value.topics, topic, COUNCIL_TOPIC_TITLE);
    const mine = existingRowField(draft.topics, topic, COUNCIL_TOPIC_TITLE);
    const stored = existingRowField(saved.topics, topic, COUNCIL_TOPIC_TITLE);
    return opening !== undefined && mine !== undefined && stored !== undefined
      ? { field: 'topic-title', path, birth: topic, mine, stored } : undefined;
  }
  const [field] = path;
  if (path.length !== 1 || (field !== 'title' && field !== 'date' && field !== 'heldAt')) return undefined;
  const read = (value: DocumentData) => words(field === 'heldAt' ? councilLifecycleValue(value) : readField(value, path));
  const mine = read(draft), stored = read(saved);
  return mine !== undefined && stored !== undefined && read(confirmed.value) !== undefined
    ? { field, path, mine, stored } : undefined;
}

export function readPrivateCouncilReview(checkpoint: SessionCheckpoint) {
  if (checkpoint.confirmed.resource.collection !== 'councils') return undefined;
  const review = readPrivateFieldReview(checkpoint, readCouncilField, (path, conflict) => {
    if (conflict?.code === 'council-option-gone' && path.length === 2 && path[0] === 'topics') return [...path, 'outcome'];
    if (path.length === 1 && path[0] === 'status') return ['heldAt'];
    if (path[0] === 'topics' && path.length === 3 && COUNCIL_OUTCOME_FIELDS.some(field => path[2] === field)) {
      return [path[0], path[1], 'outcome'];
    }
    return path;
  });
  if (!review) return undefined;
  const topics = review.merged.value.exists && object(review.merged.value.value) && review.merged.value.value.topics;
  const fields = review.fields.map((field): CouncilPrivateField => {
    return field.field !== 'outcome' || councilOutcomeOptionAvailable(topics, field.birth, field.mine)
      ? field : { ...field, localAvailable: false };
  });
  const decisions = review.decisions.filter(decision => decision.side === 'remote' || !fields.some(field =>
    field.field === 'outcome' && field.localAvailable === false && equalValues(field.path, decision.path)));
  const remaining = fields.filter(field => !decisions.some(decision => equalValues(decision.path, field.path)));
  return { ...review, fields, decisions, remaining };
}

export function readPrivateCouncilComparison(checkpoint: SessionCheckpoint) {
  const next = readPrivateCouncilReview(checkpoint)?.remaining[0];
  if (!next) return undefined;
  return { ...next, identity: JSON.stringify([checkpoint.editGeneration, checkpoint.remoteCandidate?.metadata,
    checkpoint.privateFieldReview, next]) };
}

export function projectCouncilPrivateFields(review: NonNullable<ReturnType<typeof readPrivateCouncilReview>>,
  decisions: readonly FieldSelection[]): DocumentData | undefined {
  if (!review.merged.value.exists) return undefined;
  let value = review.merged.value.value as DocumentData;
  for (const field of review.fields) {
    const decision = decisions.find(item => equalValues(item.path, field.path));
    if (!decision || (field.field === 'outcome' && field.localAvailable === false && decision.side === 'local')) return undefined;
    const selected = decision.side === 'local' ? 'mine' : 'stored';
    if (field.field === 'topic-title' || field.field === 'outcome' || field.field === 'summary') {
      const topics = field.field === 'topic-title'
        ? replaceExistingRowField(value.topics, field.birth, field[selected], COUNCIL_TOPIC_TITLE)
        : field.field === 'summary' ? replaceExistingRowField(value.topics, field.birth, field[selected], COUNCIL_TOPIC_SUMMARY_POLICY.target('summary'))
          : replaceExistingRowField(value.topics, field.birth, field[selected], COUNCIL_OUTCOME);
      if (!topics) return undefined;
      value = { ...value, topics };
    } else {
      const words = field[selected];
      const entry: FieldValue = words === null ? { exists: false } : { exists: true, value: words };
      value = field.field === 'heldAt' ? withCouncilLifecycle(value, entry) : writeField(value, field.path, entry);
    }
  }
  return value;
}

export function readCouncilSummaryChoice(checkpoint: SessionCheckpoint, draft = checkpoint.draft) {
  const { confirmed, remoteCandidate, conflicts, pending } = checkpoint;
  if (confirmed.resource.collection !== 'councils' || !confirmed.metadata
    || confirmed.metadata.generation !== remoteCandidate?.metadata?.generation || !draft || !confirmed.value
    || conflicts.length !== 1 || Object.keys(pending).length !== 1) return undefined;
  const choice = readCouncilField({ ...checkpoint, draft }, conflicts[0].path);
  if (choice?.field !== 'summary' || choice.mine === choice.stored) return undefined;
  return { ...choice, before: existingRowField(confirmed.value.topics, choice.birth, COUNCIL_TOPIC_SUMMARY_POLICY.target('summary')) ?? null,
    identity: JSON.stringify([checkpoint.editGeneration, remoteCandidate.metadata, choice]) };
}

export function writeCouncilSummaryChoice(value: DocumentData | null,
  choice: NonNullable<ReturnType<typeof readCouncilSummaryChoice>>, side: 'before' | 'mine') {
  if (!value) return undefined;
  const topics = replaceExistingRowField(value.topics, choice.birth, choice[side], COUNCIL_TOPIC_SUMMARY_POLICY.target('summary'));
  return topics === undefined ? undefined : { ...value, topics };
}
