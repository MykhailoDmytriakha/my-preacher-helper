import { DOCUMENT_BOOKKEEPING_FIELDS } from '@/utils/documentBookkeeping';
import { sermonNoteConflictText } from '@/utils/sermonNoteText';

import { isAuthoredListComparison, isAuthoredStringList } from './authoredStringList';
import { COUNCIL_ASSEMBLY, councilAssemblyRow } from './councilAssemblyAction';
import { COUNCIL_OUTCOME, councilOutcomeRow } from './councilOutcomeAction';
import { COUNCIL_TOPIC_KIND, councilTopicKindRow } from './councilTopicKindAction';
import { COUNCIL_TOPIC_TITLE, councilTopicTitleRow } from './councilTopicTitleAction';
import { exegeticalPlan, exegeticalPointConflictId, readExegeticalPointChoice } from './exegeticalPointAction';
import { readUnreadableExegeticalChoice, UNREADABLE_EXEGETICAL_PROOF } from './exegeticalPointCapture';
import { equalValues, object } from './fieldValues';
import { preachDateReviewConflicts } from './preachDateChoice';
import { readPreachDateFieldVersions } from './preachDateFieldAction';
import { existingRowField, replaceExistingRowField, rowConflictValue } from './rowFieldAction';
import { readSermonConflictField, readSermonPreparationConfirmation } from './sermonFieldChoice';
import { readPlanCellText } from './sermonPlanCellSession';
import { readPreparationTextComparison } from './sermonPreparationRecovery';
import { isPlanCellPath } from './sermonTextOpenings';
import { SERVICE_ORDER_FLAG_TARGET, SERVICE_ORDER_STEP_SCRIPTURE_LIST, serviceOrderStepField } from './serviceOrderStepAction';
import { readServiceStepTextChoice } from './serviceOrderStepChoice';
import { readThoughtLockConflict, thoughtLockConflictId } from './thoughtLockAction';
import { readThoughtPlacementChoice } from './thoughtPlacementAction';
import { readThoughtTagChoice } from './thoughtTagAction';

import type { RowFieldTarget, RowValue } from './rowFieldAction';
import type { SessionCheckpoint } from './session';
import type { DocumentData } from './types';

export { readGroupFlowFieldConflict } from './groupTextReview';

function compareTopicField<Value extends RowValue>(checkpoint: SessionCheckpoint, id: string, target: RowFieldTarget<Value>, includeOutcomeHistory = false) {
  const { confirmed, draft, remoteCandidate } = checkpoint;
  if (!draft || !confirmed.value || !remoteCandidate?.value) return undefined;
  const before = existingRowField(confirmed.value.topics, id, target);
  const mine = existingRowField(draft.topics, id, target);
  const stored = existingRowField(remoteCandidate.value.topics, id, target);
  if (before === undefined || mine === undefined || stored === undefined || equalValues(mine, stored)) return undefined;
  const { updatedAt: _local, ...local } = draft;
  const { updatedAt: _base, ...base } = confirmed.value;
  const withoutComparedFields = (topics: DocumentData['topics']) => {
    const rows = replaceExistingRowField(topics, id, before, target);
    if (!includeOutcomeHistory || !Array.isArray(rows)) return rows;
    return rows.map(row => {
      if (!object(row) || row.id !== id) return row;
      const { changes: _changes, ...rest } = row;
      return rest;
    });
  };
  if (!checkpoint.unreadableRowProofs?.length
    && !equalValues({ ...local, topics: withoutComparedFields(local.topics) }, { ...base, topics: withoutComparedFields(base.topics) })) return undefined;
  return { mine, stored,
    identity: JSON.stringify([checkpoint.editGeneration, remoteCandidate.metadata?.generation, remoteCandidate.metadata?.revision, id, target.leaf, mine, stored]) };
}

export function readCouncilTopicConflict(checkpoint: SessionCheckpoint) {
  if (checkpoint.conflicts.length !== 1
    || Object.keys(checkpoint.pending).length !== (checkpoint.unreadableRowProofs?.length ? 0 : 1)) return undefined;
  const path = checkpoint.conflicts[0].path;
  const outcome = councilOutcomeRow(path);
  if (outcome) {
    const comparison = compareTopicField(checkpoint, outcome, COUNCIL_OUTCOME, true);
    return comparison && { field: 'outcome' as const, rowId: outcome, ...comparison };
  }
  const title = councilTopicTitleRow(path);
  if (title) {
    const comparison = compareTopicField(checkpoint, title, COUNCIL_TOPIC_TITLE);
    return comparison && { field: 'title' as const, ...comparison };
  }
  const kind = councilTopicKindRow(path);
  if (kind) {
    const comparison = compareTopicField(checkpoint, kind, COUNCIL_TOPIC_KIND);
    return comparison && { field: 'kind' as const, ...comparison };
  }
  const assembly = councilAssemblyRow(path);
  if (assembly) {
    const comparison = compareTopicField(checkpoint, assembly, COUNCIL_ASSEMBLY);
    return comparison && { field: 'forAssembly' as const, ...comparison };
  }
}

function readExactTextConflict(checkpoint: SessionCheckpoint, collection: string, field: 'name' | 'color' | 'title') {
  const { confirmed, draft, remoteCandidate, conflicts, pending } = checkpoint;
  const path = conflicts[0]?.path;
  const mine = draft?.[field], stored = remoteCandidate?.value?.[field];
  if (confirmed.resource.collection !== collection || !confirmed.value || !draft
    || conflicts.length !== 1 || path?.length !== 1 || path[0] !== field || Object.keys(pending).length !== 1
    || typeof mine !== 'string' || typeof stored !== 'string' || mine === stored
    || remoteCandidate?.metadata?.generation !== confirmed.metadata?.generation) return undefined;
  const otherFields = (value: DocumentData) =>
    Object.fromEntries(Object.entries(value).filter(([key]) => key !== field && !DOCUMENT_BOOKKEEPING_FIELDS.has(key)));
  return equalValues(otherFields(confirmed.value), otherFields(draft)) ? { mine, stored } : undefined;
}

export function readPlanTemplateNameConflict(checkpoint: SessionCheckpoint) {
  return readExactTextConflict(checkpoint, 'planTemplates', 'name');
}

export function readTagColorConflict(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate } = checkpoint;
  if (!remoteCandidate?.metadata || remoteCandidate.metadata.deleted
    || [confirmed.value, draft, remoteCandidate.value].some(value => value?.required !== false)) return undefined;
  return readExactTextConflict(checkpoint, 'tags', 'color');
}

export function readServiceOrderTitleConflict(checkpoint: SessionCheckpoint) {
  return readExactTextConflict(checkpoint, 'serviceOrders', 'title');
}

export function readServiceStepConflict(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate, conflicts, pending } = checkpoint;
  const target = serviceOrderStepField(conflicts[0]?.path);
  if (!target || !draft || !confirmed.value || !remoteCandidate?.value || conflicts.length !== 1 || Object.keys(pending).length !== 1) return undefined;
  const { id, field } = target;
  if (field === 'body' || field === 'title') {
    const comparison = readServiceStepTextChoice(checkpoint);
    return comparison && { field, mine: comparison.mine, stored: comparison.stored };
  }
  if (field === 'scriptureRefs') {
    const conflict = conflicts[0];
    const mine = isAuthoredListComparison(conflict.code) && isAuthoredStringList(conflict.mine.value)
      ? conflict.mine.value : existingRowField(draft.steps, id, SERVICE_ORDER_STEP_SCRIPTURE_LIST);
    const stored = existingRowField(remoteCandidate.value.steps, id, SERVICE_ORDER_STEP_SCRIPTURE_LIST);
    if (!mine || !stored || equalValues(mine, stored)) return undefined;
    return { field, mine, stored };
  }
  const compared = (value: DocumentData) => ({
    ...Object.fromEntries(Object.entries(value).filter(([key]) => !DOCUMENT_BOOKKEEPING_FIELDS.has(key))),
    steps: Array.isArray(value.steps) ? value.steps.map(step => object(step)
      ? { ...step, scriptureRefs: step.scriptureRefs ?? [], flagged: step.id === id ? false : Boolean(step.flagged) } : step) : value.steps,
  });
  if (!equalValues(compared(confirmed.value), compared(draft))) return undefined;
  const mine = existingRowField(draft.steps, id, SERVICE_ORDER_FLAG_TARGET);
  const stored = existingRowField(remoteCandidate.value.steps, id, SERVICE_ORDER_FLAG_TARGET);
  if (mine === undefined || stored === undefined || mine === stored) return undefined;
  const step = Array.isArray(draft.steps) ? draft.steps.find(item => object(item) && item.id === id) : undefined;
  const title = object(step) && typeof step.title === 'string' && step.title.trim() ? step.title : undefined;
  return { field, mine, stored, title };
}


export function readOutlineNoteConflict(checkpoint: SessionCheckpoint) {
  const comparison = readSermonConflict(checkpoint);
  return comparison?.kind === 'note-text' && !comparison.scratch ? comparison : undefined;
}

export function readSermonConflict(checkpoint: SessionCheckpoint) {
  const { draft, remoteCandidate } = checkpoint;
  const conflicts = preachDateReviewConflicts(checkpoint.confirmed.value, draft, remoteCandidate?.value ?? null, checkpoint.conflicts);
  if (!conflicts.length || !draft || !remoteCandidate?.value) return undefined;
  const points = conflicts.flatMap(({ path, code }) => {
    const id = exegeticalPointConflictId(path);
    return id ? [{ id, unreadable: code === UNREADABLE_EXEGETICAL_PROOF }] : [];
  });
  if (points.length) {
    const opening = exegeticalPlan(checkpoint.confirmed.value?.preparation);
    const local = exegeticalPlan(draft.preparation), saved = exegeticalPlan(remoteCandidate.value.preparation);
    if (!opening || !local || !saved || checkpoint.confirmed.metadata?.generation !== remoteCandidate.metadata?.generation) return undefined;
    const versions = points.flatMap(({ id, unreadable }) => {
      if (unreadable) {
        const choice = readUnreadableExegeticalChoice(checkpoint, id);
        if (!choice) return [];
        const { mine, theirs } = choice.conflict;
        const title = (value: typeof mine) => (value.value as DocumentData | undefined)?.title as string | undefined;
        return [{ mine: title(mine) ?? null, stored: title(theirs) ?? null, localAvailable: choice.localAvailable,
          pendingAddition: choice.pendingAddition, descendantTitles: choice.descendantTitles }];
      }
      const choice = readExegeticalPointChoice(opening, local, saved, id);
      if (!choice) return [];
      return [{ mine: (choice.mine?.point.title as string | undefined) ?? null,
        stored: (choice.saved?.point.title as string | undefined) ?? null, localAvailable: true, pendingAddition: false, descendantTitles: [] }];
    });
    if (versions.length !== points.length) return undefined;
    const identity = JSON.stringify([points, versions, remoteCandidate.metadata, checkpoint.editGeneration]);
    const localAvailable = versions.every(version => version.localAvailable)
      && !conflicts.some(conflict => conflict.code === UNREADABLE_EXEGETICAL_PROOF && !exegeticalPointConflictId(conflict.path));
    return { kind: 'exegetical-point' as const, identity, versions, localAvailable, scoped: conflicts.length === 1 };
  }
  if (checkpoint.confirmed.metadata?.generation === remoteCandidate.metadata?.generation) {
    const versions = conflicts.flatMap(({ path, mine, theirs }) => {
      const row = readPreachDateFieldVersions(path, draft, remoteCandidate.value!);
      if (!row || equalValues(row.mine, row.stored) || !equalValues(rowConflictValue(row.mine), mine)
        || !equalValues(rowConflictValue(row.stored), theirs)) return [];
      return [row];
    });
    if (versions.length === conflicts.length && (versions.length > 1 || versions[0].field !== 'date')) {
      return { kind: 'preach-date-detail' as const, versions,
        identity: JSON.stringify([conflicts, remoteCandidate.metadata, checkpoint.editGeneration]) };
    }
  }
  if (conflicts.length !== 1) return undefined;
  const { path, base } = conflicts[0];
  const note = sermonNoteConflictText(path, draft, remoteCandidate.value);
  if (note && checkpoint.confirmed.metadata?.generation === remoteCandidate.metadata?.generation
    && note.mine === conflicts[0].mine.value && note.stored === conflicts[0].theirs.value) {
    return { kind: 'note-text' as const, scratch: note.target.kind === 'scratch', mine: note.mine, stored: note.stored,
      identity: JSON.stringify([path, note, remoteCandidate.metadata, checkpoint.editGeneration]) };
  }
  const [field, rowId, property] = path;
  if (isPlanCellPath(path) && checkpoint.confirmed.metadata?.generation === remoteCandidate.metadata?.generation) {
    const mine = readPlanCellText(draft, rowId);
    const stored = readPlanCellText(remoteCandidate.value, rowId);
    if (mine === stored || mine !== (conflicts[0].mine.value ?? '') || stored !== (conflicts[0].theirs.value ?? '')) return undefined;
    return { kind: 'plan-cell' as const, unverified: checkpoint.planCellDrafts?.[rowId]?.unverified === true,
      identity: JSON.stringify([path, mine, stored, remoteCandidate.metadata, checkpoint.editGeneration]),
      mine: mine || undefined, stored: stored || undefined };
  }
  const preparation = readPreparationTextComparison(checkpoint);
  if (preparation) return { kind: 'preparation-text' as const, ...preparation };
  const mine = readSermonConflictField(draft, path);
  const stored = readSermonConflictField(remoteCandidate.value, path);
  const identity = JSON.stringify([path, mine, stored, remoteCandidate.metadata, checkpoint.editGeneration]);
  if (JSON.stringify(mine) === JSON.stringify(stored)) return undefined;
  if (path.length === 1 && field === 'verse' && typeof mine.value === 'string' && typeof stored.value === 'string') {
    return { kind: 'verse' as const, identity, mine: mine.value, stored: stored.value };
  }
  const confirmation = readSermonPreparationConfirmation(checkpoint);
  if (confirmation) {
    return { kind: 'preparation-confirmation' as const, identity: confirmation.identity, field: confirmation.field,
      mine: confirmation.mine.value === true, stored: confirmation.stored.value === true };
  }
  if (field !== 'preachDates' || !rowId?.startsWith('id:')) return undefined;
  if (path.length === 3 && property === 'date' && readSermonConflictField(remoteCandidate.value, path.slice(0, 2)).exists) {
    return { kind: 'date' as const, identity, mine: mine.value, stored: stored.value };
  }
  if (path.length === 2 && !stored.exists && object(mine.value) && typeof mine.value.notes === 'string'
    && (!object(base.value) || mine.value.notes !== base.value.notes)) {
    return { kind: 'removedDate' as const, identity, date: mine.value.date, notes: mine.value.notes };
  }
}

export function readThoughtLockComparison(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate, conflicts, pending } = checkpoint;
  const base = confirmed.value, stored = remoteCandidate?.value;
  if (confirmed.resource.collection !== 'sermons' || !base || !draft || !stored || !conflicts.length
    || confirmed.metadata?.generation !== remoteCandidate?.metadata?.generation || Object.keys(pending).length !== 1) return undefined;
  const locks = conflicts.flatMap(({ path }) => {
    const id = thoughtLockConflictId(path);
    if (!id) return [];
    const lock = readThoughtLockConflict(id, base, draft, stored);
    const row = Array.isArray(draft.thoughts) && draft.thoughts.find(value => object(value) && value.id === id);
    return lock && object(row) && typeof row.text === 'string' ? [{ text: row.text, ...lock }] : [];
  });
  if (locks.length !== conflicts.length) return undefined;
  return { locks, identity: JSON.stringify([checkpoint.editGeneration, remoteCandidate?.metadata?.revision, locks]) };
}


export function readThoughtPlacementComparison(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate, conflicts, pending } = checkpoint;
  const base = confirmed.value, stored = remoteCandidate?.value;
  if (confirmed.resource.collection !== 'sermons' || !base || !draft || !stored || !conflicts.length
    || confirmed.metadata?.generation !== remoteCandidate?.metadata?.generation || Object.keys(pending).length !== 1) return;
  const locations = conflicts.flatMap(conflict => {
    const placement = readThoughtPlacementChoice(conflict, base, draft, stored);
    const row = placement && Array.isArray(draft.thoughts) && draft.thoughts.find(value => object(value) && value.id === placement.id);
    return placement && object(row) && typeof row.text === 'string' ? [{ text: row.text, ...placement }] : [];
  });
  if (locations.length !== conflicts.length) return;
  return { locations, identity: JSON.stringify([checkpoint.editGeneration, remoteCandidate?.metadata?.revision, locations]) };
}


export function readThoughtTagComparison(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate, conflicts, pending } = checkpoint;
  const base = confirmed.value, stored = remoteCandidate?.value;
  if (confirmed.resource.collection !== 'sermons' || !base || !draft || !stored || !conflicts.length
    || confirmed.metadata?.generation !== remoteCandidate?.metadata?.generation || Object.keys(pending).length !== 1) return undefined;
  const tags = conflicts.flatMap(conflict => readThoughtTagChoice(conflict, base, draft, stored) ?? []);
  if (tags.length !== conflicts.length) return undefined;
  return { tags, identity: JSON.stringify([checkpoint.editGeneration, remoteCandidate?.metadata?.revision, tags]) };
}
