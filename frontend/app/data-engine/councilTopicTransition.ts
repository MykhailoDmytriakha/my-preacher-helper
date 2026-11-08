import { hasRecordedCouncilTopicOutcome, recordedCouncilTopicOutcome } from '@/utils/councilTopicOutcome';

import { equalValues, object } from './fieldValues';

import type { CommandResult, ConflictDetail, DocumentData } from './types';

function topicsById(value: unknown) {
  const rows = Array.isArray(value) ? value : [];
  return new Map(rows.flatMap(row => object(row) && typeof row.id === 'string' ? [[row.id, row] as const] : []));
}
const kind = (topic: { kind?: unknown }) => topic.kind === 'info' ? 'info' : 'decision';

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

function councilTopicRowRefusal(before: DocumentData | undefined, after: DocumentData | undefined, stored: DocumentData, next: DocumentData) {
  if (kind(stored) !== kind(next) && hasRecordedCouncilTopicOutcome(stored)) return 'council-topic-outcome-first';
  if (equalValues(recordedCouncilTopicOutcome(stored), recordedCouncilTopicOutcome(next))) return undefined;
  // A manual choice may rebase the authored fields onto the new type. Validate that result too.
  const decision = Boolean(next.decision || next.acceptedOptionId);
  if (kind(next) === 'info' ? decision : next.discussed === true && !decision) return 'council-topic-kind-changed';
  if (before && after && kind(stored) !== kind(before)
    && !equalValues(recordedCouncilTopicOutcome(before), recordedCouncilTopicOutcome(after))) return 'council-topic-kind-changed';
}

const frameFields = ['kind', 'discussed', 'acceptedOptionId', 'decision', 'resolution'] as const;
const frame = (topic: DocumentData): DocumentData => Object.fromEntries(frameFields.flatMap(field => field in topic ? [[field, topic[field]]] : []));

/** Preserve the exact local type/outcome while independently changed section fields can still merge. */
export function retainCouncilTopicFrame(base: DocumentData, mine: DocumentData, theirs: DocumentData,
  value: DocumentData, path: string[]): ConflictDetail | undefined {
  if (path.length !== 2 || path[0] !== 'topics' || !path[1].startsWith('id:')
    || !Array.isArray(base.questions) || !Array.isArray(base.options)) return undefined;
  const code = councilTopicRowRefusal(base, mine, theirs, value);
  if (!code) return undefined;
  for (const field of frameFields) {
    if (field in mine) value[field] = mine[field];
    else delete value[field];
  }
  return { path, code, base: { exists: true, value: frame(base) }, mine: { exists: true, value: frame(mine) },
    theirs: { exists: true, value: frame(theirs) } };
}

export function councilTopicConflictCode(conflicts: readonly ConflictDetail[]): string | undefined {
  return conflicts.find(conflict => conflict.code === 'council-topic-kind-changed' || conflict.code === 'council-topic-outcome-first')?.code;
}

export function councilTopicRefusalCode(result: CommandResult | null | undefined): string | undefined {
  return result?.kind === 'refused' && (result.code === 'council-topic-kind-changed' || result.code === 'council-topic-outcome-first')
    ? result.code : undefined;
}

export function assertCouncilTopicChoice(result: CommandResult | null | undefined): void {
  rejectCouncilTopicChoice(councilTopicRefusalCode(result));
}

export function rejectCouncilTopicChoice(code: string | undefined): void {
  if (code) throw Object.assign(new Error('The original section type and outcome must be reviewed separately'), { code });
}
