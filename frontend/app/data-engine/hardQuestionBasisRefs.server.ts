import { isAuthoredStringList } from './authoredStringList';
import { equalValues, object } from './fieldValues';
import { BASIS_FIELD_REVIEW, BASIS_REFERENCE_PROJECTION, HARD_QUESTION_BASIS_POLICY, hardQuestionBasisActionsForField, readHardQuestionBasisField } from './hardQuestionBasisFields';
import { hardQuestionListItemChanges } from './hardQuestionFieldAction';
import { compatibleQuestionConfirmations, hasUnseenQuestionListItems, nextHardQuestionListMemberships, planHardQuestionList, readCarriedQuestionItems } from './hardQuestionListOrder.server';
import { hasBasisScripture } from './hardQuestionThemeLists';
import { matchesRowDetailBirth } from './rowDetailAction';
import { readRowDetailProof } from './rowDetailOrder.server';
import { existingRowFields, proofRevision, replaceExistingRowField } from './rowFieldAction';
import { readRowObservation } from './rowFieldOrder.server';

import type { ActionTime } from './actionClock';
import type { MembershipConfirmation } from './hardQuestionListOrder.server';
import type { ConflictDetail, DataCommand, DocumentData, FieldValue, ResourceSnapshot } from './types';

const PROOFS = 'hardQuestionBasisReferenceProofs';
const MAX_ROWS = 24;
const refs = HARD_QUESTION_BASIS_POLICY.target('scriptureRefs');
const field = (value: string[]): FieldValue => ({ exists: true, value });

type ReferenceWrite = { rowId: string; time: ActionTime | null; reaffirmed: MembershipConfirmation[]; carried?: MembershipConfirmation[] };

function storedProofs(raw: unknown) {
  return object(raw) && Array.isArray(raw[PROOFS]) ? raw[PROOFS].slice(0, MAX_ROWS).filter(object) : [];
}

/** Keep the time of an individual removal or addition even when the same Save affected other places. */
export function orderBasisReferences(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number) {
  const uncertain: ConflictDetail[] = [], projections: ConflictDetail[] = [];
  const writes: ReferenceWrite[] = [];
  const resolvedReviews = new Set<string>();
  if (command.resource.collection !== HARD_QUESTION_BASIS_POLICY.collection || command.kind !== 'update'
    || !current.value || !current.metadata || current.metadata.deleted || command.generation !== current.metadata.generation) {
    return { command, uncertain, writes, resolvedReviews, projections };
  }
  const change = command.changes.find(item => item.path.length === 1 && item.path[0] === 'bases');
  if (!change || !Array.isArray(change.before.value) || !Array.isArray(change.after.value)) {
    return { command, uncertain, writes, resolvedReviews, projections };
  }
  const { revision } = current.metadata;
  const submitted = command;
  const actions = new Map(hardQuestionBasisActionsForField(submitted, 'scriptureRefs').flatMap(raw => {
    const stamp = readRowObservation(submitted, raw, refs, serverMs, { allowUnclocked: true, allowUnchanged: () => raw.reviewed === true });
    return stamp && stamp.observedRevision <= revision && matchesRowDetailBirth(submitted.changes, raw, HARD_QUESTION_BASIS_POLICY.birth)
      ? [[stamp.rowId, { raw, stamp }]] as const : [];
  }));
  let adjusted = change;
  const processed = new Set<string>();
  const before = existingRowFields(change.before.value, refs), after = existingRowFields(change.after.value, refs);
  const saved = existingRowFields(current.value.bases, refs);
  const proofs = storedProofs(raw);
  for (const [rowId, from] of before) {
    const to = after.get(rowId), live = saved.get(rowId);
    if (!Array.isArray(from) || !Array.isArray(to) || !Array.isArray(live) || !hasBasisScripture(to)) continue;
    const entry = actions.get(rowId);
    const rawAction = entry?.raw, stamp = entry?.stamp;
    const previous = proofs.find(item => item.id === rowId);
    const openings = { path: ['scriptureRefs'], before: field(from), after: field(to) };
    const review = stamp && rawAction?.reviewed === true;
    if (!review && equalValues(from, to)) continue;
    const confirmed = review ? rawAction.confirmedItems ?? [] : [];
    const carried = review ? readCarriedQuestionItems(rawAction.carriedItems, openings, revision, serverMs) : [];
    let fresh = false;
    if (review && stamp && equalValues(from, live)) {
      const fieldProof = readRowDetailProof(raw, HARD_QUESTION_BASIS_POLICY, 'scriptureRefs', rowId, rowId, live, undefined, revision);
      const affected = confirmed.length ? confirmed : [...hardQuestionListItemChanges(openings.before, openings.after).keys()];
      const unseen = hasUnseenQuestionListItems(affected, previous, stamp.observedRevision, revision);
      fresh = !unseen && (stamp.observedRevision === revision || Boolean(fieldProof && fieldProof.revision <= stamp.observedRevision));
      if (fresh && !confirmed.length) {
        writes.push({ rowId, time: stamp.time, reaffirmed: [] });
        continue;
      }
    }
    if (review && !confirmed.length) {
      const affected = [...hardQuestionListItemChanges(openings.before, openings.after).keys()];
      if (stamp && !equalValues(live, to) && hasUnseenQuestionListItems(affected, previous, stamp.observedRevision, revision)) {
        uncertain.push({ path: ['bases', 'id:' + rowId, 'scriptureRefs'], code: BASIS_FIELD_REVIEW,
          base: field(from), mine: field(to), theirs: field(live) });
      }
      continue;
    }
    // The list planner resolves membership first. The basis invariant is applied to the result.
    const observed = stamp && { ...stamp, ...openings, predecessorOperationId: rawAction?.predecessorOperationId };
    const result = planHardQuestionList(openings, field(live), previous, revision, observed,
      review ? { carried, confirmed, ...(fresh && { confirmedOpening: true }) } : undefined);
    if (result && 'review' in result) {
      const versions = result.versions;
      uncertain.push({ path: ['bases', 'id:' + rowId, 'scriptureRefs'], code: BASIS_FIELD_REVIEW,
        base: field(from), mine: field(to), theirs: field(live),
        ...(versions && hasBasisScripture(versions.local.value) && hasBasisScripture(versions.remote.value)
          && { hardQuestionListVersions: versions }) });
    } else if (result && stamp && isAuthoredStringList(result.value.value) && hasBasisScripture(result.value.value)) {
      const references = result.value.value;
      const reaffirmed = review ? compatibleQuestionConfirmations(confirmed, stamp, previous, revision) : [];
      writes.push({ rowId, time: stamp.time, carried,
        reaffirmed: [...new Map([...result.reaffirmed, ...reaffirmed].map(item => [item.item, item])).values()] });
      if (review) resolvedReviews.add(rowId);
      if (!equalValues(references, to)) {
        projections.push({ path: ['bases', 'id:' + rowId, 'scriptureRefs'], code: BASIS_REFERENCE_PROJECTION,
          base: field(to), mine: field(references), theirs: field(live) });
      }
      // An earlier independent item can be valid even when the complete array has a newer clock.
      if (!review && stamp.observedRevision === revision && equalValues(references, to) && equalValues(from, live)) continue;
      processed.add(rowId);
      adjusted = { ...adjusted,
        before: { ...adjusted.before, value: replaceExistingRowField(adjusted.before.value, rowId, live, refs) },
        after: { ...adjusted.after, value: replaceExistingRowField(adjusted.after.value, rowId, references, refs) },
      };
    } else if (review && confirmed.length) {
      uncertain.push({ path: ['bases', 'id:' + rowId, 'scriptureRefs'], code: BASIS_FIELD_REVIEW,
        base: field(from), mine: field(to), theirs: field(live) });
    }
  }
  if (processed.size) {
    const { scriptureRefs: single, ...singleFields } = command.hardQuestionBasisFieldActions ?? {};
    const { scriptureRefs: repeated, ...repeatedFields } = command.hardQuestionBasisRowActions ?? {};
    const remaining = Array.isArray(repeated) ? repeated.filter(item => !processed.has(item?.rowId)) : [];
    command = { ...command, changes: command.changes.map(item => item === change ? adjusted : item),
      ...(command.hardQuestionBasisFieldActions && { hardQuestionBasisFieldActions: {
        ...singleFields, ...(single && !processed.has(single.rowId) && { scriptureRefs: single }),
      } }),
      ...(command.hardQuestionBasisRowActions && { hardQuestionBasisRowActions: {
        ...repeatedFields, ...(remaining.length && { scriptureRefs: remaining }),
      } }),
    };
  }
  return { command, uncertain, writes, resolvedReviews, projections };
}

export function metadataAfterBasisReferences(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined,
  writes: ReadonlyMap<string, ReferenceWrite>) {
  const metadata = snapshot.metadata;
  if (snapshot.resource.collection !== HARD_QUESTION_BASIS_POLICY.collection || !metadata || !snapshot.value) return metadata;
  const previous = raw?._dataEngine;
  const old = object(previous) && previous.generation === metadata.generation && proofRevision(previous.revision) ? previous.revision : undefined;
  if (!raw || old === undefined) return metadata;
  const stored = storedProofs(previous);
  const rows = existingRowFields(snapshot.value.bases, refs);
  const live = [...rows].flatMap(([id, values]) => {
    const after = readHardQuestionBasisField(snapshot.value!, id, 'scriptureRefs');
    const before = readHardQuestionBasisField(raw as DocumentData, id, 'scriptureRefs');
    if (!Array.isArray(values) || !before.exists) return [];
    const prior = stored.find(item => item.id === id);
    const action = writes.get(id);
    if (!prior && !action && equalValues(before, after)) return [];
    const memberships = nextHardQuestionListMemberships(prior, before, after, metadata.revision, old, metadata.operationId,
      { time: action?.time ?? null, reaffirmed: action?.reaffirmed, carried: action?.carried });
    return memberships ? [{ id, memberships, changed: action || !equalValues(before, after) ? metadata.revision : Number(prior?.changed ?? old) }] : [];
  }).sort((a, b) => b.changed - a.changed).slice(0, MAX_ROWS);
  return live.length > 0 ? { ...metadata, [PROOFS]: live } : metadata;
}
