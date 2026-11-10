import { createHash } from 'node:crypto';

import { COUNCIL_OUTCOME, COUNCIL_OUTCOME_POLICY } from './councilOutcomeAction';
import { COUNCIL_TOPIC_KIND } from './councilTopicKindAction';
import { equalValues, object } from './fieldValues';
import { matchesRowDetailBirth } from './rowDetailAction';
import { continuousRowDetailFrame, followsQueuedRowDetail, orderRowDetails, readRowDetailProof } from './rowDetailOrder.server';
import { existingRowFields, rowConflictPath, rowConflictValue } from './rowFieldAction';
import { readRowObservation } from './rowFieldOrder.server';

import type { CouncilOutcome } from './councilOutcomeAction';
import type { CouncilTopicKind } from './councilTopicKindAction';
import type { RowFieldTarget, RowValue } from './rowFieldAction';
import type { ConflictDetail, DataCommand, FieldChange, ResourceSnapshot } from './types';

type Update = Extract<DataCommand, { kind: 'update' }>;
type TopicFrame = { kind: CouncilTopicKind; outcome: CouncilOutcome; born: string };
type TopicBasis = { rowId: string; rowCreatedAt: string; observedRevision: number; predecessorOperationId?: unknown };

function topicQueueDigest(command: DataCommand): string | undefined {
  if (command.resource.collection !== 'councils' || (command.kind !== 'create' && command.kind !== 'update')) return;
  const value = command.councilTopicQueue;
  if (typeof value === 'string' && /^[a-z0-9-]{16,128}$/i.test(value)) return createHash('sha256').update(value).digest('base64url');
}

function outcomeActions(command: Update, change: FieldChange) {
  if (!Array.isArray(command.councilOutcomeActions)) return [];
  const opening = existingRowFields(change.before.value, COUNCIL_OUTCOME);
  const written = existingRowFields(change.after.value, COUNCIL_OUTCOME);
  return command.councilOutcomeActions.flatMap(proof => {
    if (!object(proof) || typeof proof.rowId !== 'string') return [];
    const before = opening.get(proof.rowId), after = written.get(proof.rowId);
    return before && after ? [{ ...proof, before, after, time: null }] : [];
  });
}

function readTopicBasis<Value extends RowValue>(command: Update, raw: unknown, target: RowFieldTarget<Value>,
  serverMs: number, revision: number): TopicBasis | undefined {
  const evidence = readRowObservation(command, raw, target, serverMs, {
    allowUnclocked: true, allowUnchanged: () => target.leaf === COUNCIL_OUTCOME.leaf,
  });
  const birth = COUNCIL_OUTCOME_POLICY.birth;
  if (!evidence || evidence.observedRevision > revision || !object(raw) || !birth.accepts(raw.rowCreatedAt)) return;
  const basis = { ...evidence, rowCreatedAt: raw.rowCreatedAt, predecessorOperationId: raw.predecessorOperationId };
  if (matchesRowDetailBirth(command.changes, basis, birth)) return basis;
}

function topicFrames(rows: unknown): Map<string, TopicFrame> {
  const outcomes = existingRowFields(rows, COUNCIL_OUTCOME);
  const births = existingRowFields(rows, COUNCIL_OUTCOME_POLICY.birth);
  return new Map([...existingRowFields(rows, COUNCIL_TOPIC_KIND)].flatMap(([id, kind]) => {
    const outcome = outcomes.get(id), born = births.get(id);
    return kind && outcome && born ? [[id, { kind, outcome, born }] as const] : [];
  }));
}

function canUseTopicOpening(bases: TopicBasis[], opening: TopicFrame, saved: TopicFrame, rowId: string,
  raw: unknown, revision: number, queueDigest?: string): boolean {
  if (!equalValues(opening.outcome, saved.outcome)) return false;
  const proof = readRowDetailProof(raw, COUNCIL_OUTCOME_POLICY, 'outcome', rowId, saved.born, saved.outcome, saved.kind, revision);
  if (!bases.length) return opening.kind === saved.kind && (revision === 1 || continuousRowDetailFrame(proof));
  const observed = Math.min(...bases.map(basis => basis.observedRevision));
  const latest = proof?.valueRevision ?? proof?.revision ?? revision;
  return latest <= observed || Boolean(proof && bases.some(basis => followsQueuedRowDetail(proof, basis.predecessorOperationId, queueDigest)));
}

/** A kind edit also depends on the reviewed result. An old request needs a continuous opening frame. */
function outcomeBasisConflicts(command: Update, change: FieldChange, current: ResourceSnapshot,
  raw: unknown, serverMs: number, queueDigest?: string): ConflictDetail[] {
  const { metadata } = current;
  if (!metadata || metadata.deleted || command.generation !== metadata.generation) return [];
  const revision = metadata.revision;
  const kind = readTopicBasis(command, command.councilTopicKindActions?.kind, COUNCIL_TOPIC_KIND, serverMs, revision);
  const outcomes = new Map<string, TopicBasis | undefined>();
  for (const action of outcomeActions(command, change)) {
    const basis = readTopicBasis(command, action, COUNCIL_OUTCOME, serverMs, revision);
    outcomes.set(action.rowId, outcomes.has(action.rowId) ? undefined : basis);
  }
  const opening = topicFrames(change.before.value), proposed = topicFrames(change.after.value), stored = topicFrames(current.value?.topics);
  return [...opening].flatMap(([rowId, before]) => {
    const after = proposed.get(rowId), saved = stored.get(rowId);
    if (!after || !saved || before.born !== after.born || before.born !== saved.born
      || equalValues(before, after) || equalValues(saved, after)) return [];
    const changesType = before.kind !== after.kind;
    const outcome = outcomes.get(rowId);
    // The normal outcome path already verifies a stamped write within the same type.
    if (!changesType && outcome?.rowCreatedAt === saved.born) return [];
    const bases = [outcome, changesType ? kind : undefined]
      .filter((basis): basis is TopicBasis => basis?.rowId === rowId && basis.rowCreatedAt === saved.born);
    if (canUseTopicOpening(bases, before, saved, rowId, raw, revision, queueDigest)) return [];
    return changesType ? [{
      path: rowConflictPath(rowId, COUNCIL_TOPIC_KIND),
      base: rowConflictValue(before.kind), mine: rowConflictValue(after.kind), theirs: rowConflictValue(saved.kind),
    }] : [{
      path: rowConflictPath(rowId, COUNCIL_OUTCOME),
      base: rowConflictValue(before.outcome), mine: rowConflictValue(after.outcome), theirs: rowConflictValue(saved.outcome),
    }];
  });
}

const topicChange = (command: Update) => command.changes.find(change => change.path.length === 1 && change.path[0] === 'topics');

export function orderCouncilOutcome(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number,
  original: DataCommand = command) {
  const queueDigest = topicQueueDigest(original);
  const change = command.kind === 'update' && command.resource.collection === 'councils' ? topicChange(command) : undefined;
  const stamped = command.kind === 'update' && change ? { ...command, councilOutcomeActions: outcomeActions(command, change) } : command;
  const ordered = orderRowDetails(stamped, current, raw, serverMs, COUNCIL_OUTCOME_POLICY, queueDigest);
  const originalChange = original.kind === 'update' && change ? topicChange(original) : undefined;
  const basisConflicts = original.kind === 'update' && originalChange
    ? outcomeBasisConflicts(original, originalChange, current, raw, serverMs, queueDigest) : [];
  return { ...ordered, uncertain: [...ordered.uncertain, ...basisConflicts], queueDigest };
}
