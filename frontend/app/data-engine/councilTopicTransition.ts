import { hasRecordedCouncilTopicOutcome, recordedCouncilTopicOutcome } from '@/utils/councilTopicOutcome';

import { COUNCIL_OUTCOME, COUNCIL_OUTCOME_FIELDS, councilOutcomeRow, incompatibleCouncilOutcome, readCouncilOutcome } from './councilOutcomeAction';
import { equalValues, object } from './fieldValues';

import type { CommandResult, ConflictDetail, DocumentData, FieldValue, Json } from './types';

function topicsById(value: unknown) {
  const rows = Array.isArray(value) ? value : [];
  return new Map(rows.flatMap(row => object(row) && typeof row.id === 'string' ? [[row.id, row] as const] : []));
}
const kind = (topic: { kind?: unknown }) => topic.kind === 'info' ? 'info' : 'decision';

function mixedOutcome(topic: DocumentData): boolean {
  const outcome = readCouncilOutcome(topic);
  return Boolean(outcome && incompatibleCouncilOutcome(outcome));
}

export function councilTopicTransitionRefusal(beforeRows: unknown, afterRows: unknown, previous: unknown, candidate: unknown): string | undefined {
  const opening = topicsById(beforeRows);
  const authored = topicsById(afterRows);
  const saved = topicsById(previous);
  for (const [id, next] of topicsById(candidate)) {
    const stored = saved.get(id);
    const code = stored && councilTopicRowRefusal(opening.get(id), authored.get(id), stored, next);
    if (code) return code;
  }
}

const includesOption = (topic: DocumentData, id: string) => Array.isArray(topic.options)
  && topic.options.some(option => object(option) && option.id === id);

function councilTopicRowRefusal(before: DocumentData | undefined, after: DocumentData | undefined, stored: DocumentData, next: DocumentData) {
  if (kind(stored) !== kind(next) && hasRecordedCouncilTopicOutcome(stored)) return 'council-topic-outcome-first';
  const option = next.acceptedOptionId;
  if (typeof option === 'string' && option && !includesOption(next, option)
    && (option !== stored.acceptedOptionId || includesOption(stored, option))) return 'council-option-gone';
  if (equalValues(recordedCouncilTopicOutcome(stored), recordedCouncilTopicOutcome(next))) return undefined;
  // A manual choice may rebase the authored fields onto the new type. Validate that result too.
  const decision = Boolean(next.decision || next.acceptedOptionId);
  if (kind(next) === 'info' ? decision : next.discussed === true && !decision) return 'council-topic-kind-changed';
  if (before && after && kind(stored) !== kind(before)
    && !equalValues(recordedCouncilTopicOutcome(before), recordedCouncilTopicOutcome(after))) return 'council-topic-kind-changed';
  if (mixedOutcome(next)) return 'invalid-council-topic-outcome';
}

const frameFields = ['kind', ...COUNCIL_OUTCOME_FIELDS] as const;
const frame = (topic: DocumentData): DocumentData => Object.fromEntries(frameFields.flatMap(field => field in topic ? [[field, topic[field]]] : []));

/** Preserve one complete outcome while independently changed topic fields still merge. */
export function retainCouncilTopicFrame(base: DocumentData, mine: DocumentData, theirs: DocumentData,
  value: DocumentData, path: string[], conflicts: readonly ConflictDetail[]): ConflictDetail | undefined {
  if (path.length !== 2 || path[0] !== 'topics' || !path[1].startsWith('id:')
    || !Array.isArray(base.questions) || !Array.isArray(base.options)) return undefined;
  const opening = readCouncilOutcome(base), local = readCouncilOutcome(mine), stored = readCouncilOutcome(theirs);
  const competing = opening && local && stored && kind(base) === kind(mine) && kind(base) === kind(theirs)
    && !equalValues(opening, local) && !equalValues(opening, stored) && !equalValues(local, stored);
  if (competing) retainFields(value, mine, COUNCIL_OUTCOME_FIELDS);
  const code = councilTopicRowRefusal(base, mine, theirs, value);
  if (code && code !== 'invalid-council-topic-outcome') {
    retainFields(value, mine, frameFields);
    return { path, code, base: { exists: true, value: frame(base) }, mine: { exists: true, value: frame(mine) },
      theirs: { exists: true, value: frame(theirs) } };
  }
  if (!opening || !local || !stored || incompatibleCouncilOutcome(local) || incompatibleCouncilOutcome(stored)) return undefined;
  if (kind(base) !== kind(mine) || kind(base) !== kind(theirs)
    || (!competing && code !== 'invalid-council-topic-outcome' && !conflicts.some(conflict => isCouncilOutcomePart(conflict.path, path)))) return undefined;
  retainFields(value, mine, COUNCIL_OUTCOME_FIELDS);
  return { path: [...path, COUNCIL_OUTCOME.leaf as string], base: { exists: true, value: opening },
    mine: { exists: true, value: local }, theirs: { exists: true, value: stored } };
}

function retainFields(target: DocumentData, source: DocumentData, fields: readonly string[]): void {
  for (const field of fields) {
    if (field in source) target[field] = source[field];
    else delete target[field];
  }
}

function isCouncilOutcomePart(path: readonly string[], topic: readonly string[]): boolean {
  return path.length === 3 && path[0] === topic[0] && path[1] === topic[1] && COUNCIL_OUTCOME_FIELDS.some(field => path[2] === field);
}

export function replaceCouncilOutcomeConflicts(conflicts: ConflictDetail[], result: ConflictDetail): ConflictDetail[] {
  return [...(councilOutcomeRow(result.path) ? conflicts.filter(conflict => !isCouncilOutcomePart(conflict.path, result.path)) : conflicts), result];
}

/** The held-council form adds a log item to the copy it opened. Preserve both append-only tails. */
export function mergeCouncilTopicHistory(base: DocumentData, mine: DocumentData, theirs: DocumentData,
  path: readonly string[]): FieldValue | undefined {
  if (path.length !== 2 || path[0] !== 'topics' || !path[1].startsWith('id:')
    || !Array.isArray(base.questions) || !Array.isArray(base.options) || !Array.isArray(mine.changes) || !Array.isArray(theirs.changes)) return undefined;
  const opening = base.changes ?? [];
  if (!Array.isArray(opening)) return undefined;
  const preservesOpening = (changes: Json[]) => opening.every((entry, index) => equalValues(entry, changes[index]));
  if (!preservesOpening(mine.changes) || !preservesOpening(theirs.changes)) return undefined;
  const saved = theirs.changes;
  const appended = mine.changes.slice(opening.length).filter(entry => !saved.some(item => equalValues(item, entry)));
  return { exists: true, value: [...saved, ...appended] };
}

const isCouncilTopicRefusal = (code: string | undefined) =>
  code === 'council-topic-kind-changed' || code === 'council-topic-outcome-first' || code === 'council-option-gone';

export function councilTopicConflictCode(conflicts: readonly ConflictDetail[]): string | undefined {
  return conflicts.find(conflict => isCouncilTopicRefusal(conflict.code))?.code;
}

export function councilTopicRefusalCode(result: CommandResult | null | undefined): string | undefined {
  return result?.kind === 'refused' && isCouncilTopicRefusal(result.code)
    ? result.code : undefined;
}

export function assertCouncilTopicChoice(result: CommandResult | null | undefined): void {
  rejectCouncilTopicChoice(councilTopicRefusalCode(result));
}

export function rejectCouncilTopicChoice(code: string | undefined): void {
  if (code) throw Object.assign(new Error('The original section type and outcome must be reviewed separately'), { code });
}
