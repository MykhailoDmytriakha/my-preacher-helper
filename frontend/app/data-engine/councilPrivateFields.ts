import { councilLifecycleValue, withCouncilLifecycle } from './councilFieldAction';
import { COUNCIL_TOPIC_TITLE, councilTopicTitleRow } from './councilTopicTitleAction';
import { equalValues, readField, writeField } from './fieldValues';
import { readPrivateFieldReview } from './privateFieldReview';
import { existingRowField, replaceExistingRowField } from './rowFieldAction';

import type { PrivateFieldDecision } from './privateFieldReview';
import type { SessionCheckpoint } from './session';
import type { DocumentData, FieldValue } from './types';

type CouncilPrivateField = { path: string[]; mine: string | null; stored: string | null } & (
  { field: 'title' | 'date' | 'heldAt' } | { field: 'topic-title'; birth: string }
);
function words(value: FieldValue | undefined) {
  return !value ? undefined : !value.exists ? null : typeof value.value === 'string' ? value.value : undefined;
}

function readCouncilField(checkpoint: SessionCheckpoint, path: string[]): CouncilPrivateField | undefined {
  const { confirmed, draft, remoteCandidate } = checkpoint;
  const saved = remoteCandidate?.value;
  if (!confirmed.value || !draft || !saved) return undefined;
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
  return readPrivateFieldReview(checkpoint, readCouncilField, path =>
    path.length === 1 && path[0] === 'status' ? ['heldAt'] : path);
}

export function readPrivateCouncilComparison(checkpoint: SessionCheckpoint) {
  const next = readPrivateCouncilReview(checkpoint)?.remaining[0];
  if (!next) return undefined;
  return { ...next, identity: JSON.stringify([checkpoint.editGeneration, checkpoint.remoteCandidate?.metadata,
    checkpoint.privateFieldReview, next]) };
}

export function projectCouncilPrivateFields(review: NonNullable<ReturnType<typeof readPrivateCouncilReview>>,
  decisions: readonly PrivateFieldDecision[]): DocumentData | undefined {
  if (!review.merged.value.exists) return undefined;
  let value = review.merged.value.value as DocumentData;
  for (const field of review.fields) {
    const decision = decisions.find(item => equalValues(item.path, field.path));
    if (!decision) return undefined;
    const selected = decision.side === 'local' ? field.mine : field.stored;
    if (field.field === 'topic-title') {
      const topics = selected === null ? undefined : replaceExistingRowField(value.topics, field.birth, selected, COUNCIL_TOPIC_TITLE);
      if (!topics) return undefined;
      value = { ...value, topics };
    } else {
      const entry: FieldValue = selected === null ? { exists: false } : { exists: true, value: selected };
      value = field.field === 'heldAt' ? withCouncilLifecycle(value, entry) : writeField(value, field.path, entry);
    }
  }
  return value;
}
