import { COUNCIL_OUTCOME_FIELDS, isCouncilOutcome, readCouncilOutcome, type CouncilOutcome } from '@/utils/councilTopicOutcome';

import { COUNCIL_TOPIC_ID } from './councilTopicTitleAction';
import { equalValues, object } from './fieldValues';

import type { RowDetailHistoryEntry, RowDetailObservation, RowDetailPolicy } from './rowDetailAction';
import type { RowFieldTarget, RowValue } from './rowFieldAction';
import type { DocumentData } from './types';

export { COUNCIL_OUTCOME_FIELDS, isCouncilOutcome, readCouncilOutcome };
export type { CouncilOutcome };

export type CouncilOutcomeWire = Omit<RowDetailObservation<CouncilOutcome>, 'before' | 'after'>;

export function incompatibleCouncilOutcome(value: CouncilOutcome): boolean {
  return Boolean(value.resolution && (value.discussed || value.acceptedOptionId || value.decision));
}

export function writeCouncilOutcome(topic: DocumentData, value: CouncilOutcome): DocumentData {
  const next = { ...topic };
  for (const field of COUNCIL_OUTCOME_FIELDS) {
    if (value[field]) next[field] = value[field];
    else delete next[field];
  }
  return next;
}

export const COUNCIL_OUTCOME: RowFieldTarget<CouncilOutcome> = {
  field: 'topics', leaf: 'outcome', accepts: isCouncilOutcome,
  projection: { read: readCouncilOutcome, write: writeCouncilOutcome },
};

function topicKinds(rows: unknown): ReadonlyMap<string, RowValue | undefined> {
  const scopes = new Map<string, RowValue | undefined>();
  if (!Array.isArray(rows)) return scopes;
  for (const topic of rows) {
    if (!object(topic) || typeof topic.id !== 'string') continue;
    scopes.set(topic.id, scopes.has(topic.id) ? undefined : topic.kind === 'info' ? 'info' : 'decision');
  }
  return scopes;
}

export function mergeIndependentOutcomes(before: CouncilOutcome, mine: CouncilOutcome, stored: CouncilOutcome): CouncilOutcome | undefined {
  if (before.resolution || mine.resolution || stored.resolution) return undefined;
  const fields = ['acceptedOptionId', 'decision'] as const;
  const mineEdited = fields.filter(field => mine[field] !== before[field]);
  const storedEdited = fields.filter(field => stored[field] !== before[field]);
  if (!mineEdited.length || !storedEdited.length || mineEdited.some(field => storedEdited.includes(field))) return undefined;
  // A selected option and independently written words are compatible.
  const acceptedOptionId = mineEdited.includes('acceptedOptionId') ? mine.acceptedOptionId : stored.acceptedOptionId;
  const decision = mineEdited.includes('decision') ? mine.decision : stored.decision;
  return { acceptedOptionId, decision, discussed: Boolean(acceptedOptionId || decision), resolution: null };
}

/** Compare each part with the opening. Chronology breaks ties only when both copies changed that part. */
function mergeOrderedOutcomes(before: CouncilOutcome, mine: CouncilOutcome, stored: CouncilOutcome, incomingWins: boolean): CouncilOutcome | undefined {
  if (before.resolution || mine.resolution || stored.resolution) return undefined;
  function merge<Field extends keyof Omit<CouncilOutcome, 'resolution'>>(field: Field): CouncilOutcome[Field] {
    if (mine[field] === before[field]) return stored[field];
    if (stored[field] === before[field]) return mine[field];
    return (incomingWins ? mine : stored)[field];
  }
  return { acceptedOptionId: merge('acceptedOptionId'), decision: merge('decision'), discussed: merge('discussed'), resolution: null };
}

export function councilOutcomeRow(path: readonly string[] | undefined): string | undefined {
  if (path?.length === 3 && path[0] === COUNCIL_OUTCOME.field && path[1].startsWith('id:') && path[2] === COUNCIL_OUTCOME.leaf) {
    return path[1].slice(3);
  }
}

export const COUNCIL_OUTCOME_POLICY: RowDetailPolicy<'outcome', CouncilOutcome> = {
  collection: 'councils', fields: ['outcome'], birth: COUNCIL_TOPIC_ID, target: () => COUNCIL_OUTCOME,
  proofs: 'councilOutcomeProofs', actions: 'councilOutcomeActions', history: '_topicOutcomeHistory',
  repeatedFields: ['outcome'], allowUnclocked: true, atomicChoice: true, scopes: topicKinds,
  mergeIndependently: mergeIndependentOutcomes, mergeOrdered: mergeOrderedOutcomes,
  validAfter: (_, value) => !incompatibleCouncilOutcome(value),
  needsChoice: (_, before, after, stored) => Boolean(after.decision && stored.decision
    && after.decision !== before.decision && stored.decision !== before.decision && !equalValues(after, stored)),
};

export type CouncilOutcomeHistoryPage = {
  owner: string; councilId: string; generation: string; nextCursor: string | null;
  entries: Array<{ id: string; acceptedAt: string; fields: RowDetailHistoryEntry<'outcome', CouncilOutcome>[] }>;
};
