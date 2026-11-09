import { DOCUMENT_BOOKKEEPING_FIELDS } from '@/utils/documentBookkeeping';
import { preparationConfirmationField } from '@/utils/preparationFieldValues';

import { COUNCIL_ASSEMBLY, councilAssemblyRow } from './councilAssemblyAction';
import { COUNCIL_TOPIC_KIND, councilTopicKindRow } from './councilTopicKindAction';
import { COUNCIL_TOPIC_TITLE, councilTopicTitleRow } from './councilTopicTitleAction';
import { exegeticalPlan, exegeticalPointConflictId, readExegeticalPointChoice } from './exegeticalPointAction';
import { equalValues, object } from './fieldValues';
import { GROUP_BLOCK_STATUS_POLICY } from './groupBlockStatusAction';
import { GROUP_BLOCK_TITLE_POLICY, GROUP_STEP_TITLE_POLICY } from './groupFlowTitleAction';
import { GROUP_STEP_DURATION_POLICY } from './groupStepDurationAction';
import { existingRowField, replaceExistingRowField } from './rowFieldAction';
import { readSermonConflictField } from './sermonFieldChoice';
import { SERVICE_ORDER_FLAG_TARGET, SERVICE_ORDER_STEP_TITLE_TARGET, serviceOrderStepField } from './serviceOrderStepAction';
import { readThoughtLockConflict, thoughtLockConflictId } from './thoughtLockAction';
import { readThoughtPlacementChoice } from './thoughtPlacementAction';
import { readThoughtTagChoice } from './thoughtTagAction';

import type { RowFieldTarget, RowValue } from './rowFieldAction';
import type { SessionCheckpoint } from './session';
import type { DocumentData } from './types';

function compareTopicField<Value extends RowValue>(checkpoint: SessionCheckpoint, id: string, target: RowFieldTarget<Value>) {
  const { confirmed, draft, remoteCandidate } = checkpoint;
  if (!draft || !confirmed.value || !remoteCandidate?.value) return undefined;
  const before = existingRowField(confirmed.value.topics, id, target);
  const mine = existingRowField(draft.topics, id, target);
  const stored = existingRowField(remoteCandidate.value.topics, id, target);
  if (before === undefined || mine === undefined || stored === undefined || equalValues(mine, stored)) return undefined;
  const { updatedAt: _local, ...local } = draft;
  const { updatedAt: _base, ...base } = confirmed.value;
  if (!equalValues({ ...local, topics: replaceExistingRowField(local.topics, id, before, target) },
    { ...base, topics: replaceExistingRowField(base.topics, id, before, target) })) return undefined;
  return { mine, stored,
    identity: JSON.stringify([checkpoint.editGeneration, remoteCandidate.metadata?.generation, remoteCandidate.metadata?.revision, id, target.leaf, mine, stored]) };
}

export function readCouncilTopicConflict(checkpoint: SessionCheckpoint) {
  if (checkpoint.conflicts.length !== 1 || Object.keys(checkpoint.pending).length !== 1) return undefined;
  const path = checkpoint.conflicts[0].path;
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

function readExactTextConflict(checkpoint: SessionCheckpoint, collection: string, field: 'name' | 'color') {
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
  return readExactTextConflict(checkpoint, 'tags', 'color');
}

export function readGroupFlowFieldConflict(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, conflicts, remoteCandidate, pending } = checkpoint;
  if (confirmed.resource.collection !== 'groups' || !confirmed.value || !draft
    || conflicts.length !== 1 || Object.keys(pending).length !== 1
    || !remoteCandidate?.value || remoteCandidate.metadata?.generation !== confirmed.metadata?.generation) return undefined;
  const { path } = conflicts[0];
  const isBlock = path[0] === 'templates';
  const field: 'block' | 'step' | 'status' | 'duration' = isBlock ? (path[2] === 'status' ? 'status' : 'block')
    : (path[2] === 'durationMin' ? 'duration' : 'step');
  const targets = {
    block: { birth: GROUP_BLOCK_TITLE_POLICY.birth, target: GROUP_BLOCK_TITLE_POLICY.target('title') },
    step: { birth: GROUP_STEP_TITLE_POLICY.birth, target: GROUP_STEP_TITLE_POLICY.target('title') },
    status: { birth: GROUP_BLOCK_STATUS_POLICY.birth, target: GROUP_BLOCK_STATUS_POLICY.target('status') },
    duration: { birth: GROUP_STEP_DURATION_POLICY.birth, target: GROUP_STEP_DURATION_POLICY.target('durationMin') },
  };
  const { birth: birthTarget, target }: { birth: RowFieldTarget<string>; target: RowFieldTarget<string | number | null> } = targets[field];
  if (path.length !== 3 || path[0] !== target.field || !path[1].startsWith('id:') || path[2] !== target.leaf) return undefined;
  const id = path[1].slice(3);
  const birth = existingRowField(confirmed.value[target.field], id, birthTarget);
  const before = existingRowField(confirmed.value[target.field], id, target);
  const mine = existingRowField(draft[target.field], id, target);
  const stored = existingRowField(remoteCandidate.value[target.field], id, target);
  if (birth === undefined || before === undefined || mine === undefined || stored === undefined || mine === stored
    || existingRowField(draft[target.field], id, birthTarget) !== birth
    || existingRowField(remoteCandidate.value[target.field], id, birthTarget) !== birth) return undefined;
  const compared = (value: DocumentData) => {
    const rows = replaceExistingRowField(value[target.field], id, before, target);
    const normalized = isBlock && Array.isArray(rows) ? rows.map(row => object(row) && row.id === id
      ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'updatedAt')) : row) : rows;
    return { ...Object.fromEntries(Object.entries(value).filter(([key]) => !DOCUMENT_BOOKKEEPING_FIELDS.has(key))),
      [target.field]: normalized };
  };
  if (!equalValues(compared(confirmed.value), compared(draft))) return undefined;
  return { field, mine, stored,
    identity: JSON.stringify([checkpoint.editGeneration, remoteCandidate.metadata?.generation, remoteCandidate.metadata?.revision, path, mine, stored]) };
}

export function readServiceStepConflict(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate, conflicts, pending } = checkpoint;
  const target = serviceOrderStepField(conflicts[0]?.path);
  if (!target || !draft || !confirmed.value || !remoteCandidate?.value || conflicts.length !== 1 || Object.keys(pending).length !== 1) return undefined;
  const { id, field } = target;
  const compared = (value: DocumentData) => ({
    ...Object.fromEntries(Object.entries(value).filter(([key]) => !DOCUMENT_BOOKKEEPING_FIELDS.has(key))),
    steps: Array.isArray(value.steps) ? value.steps.map(step => object(step)
      ? { ...step, scriptureRefs: step.scriptureRefs ?? [], flagged: step.id === id && field === 'flagged' ? false : Boolean(step.flagged),
        ...(step.id === id && field === 'title' && { title: '' }) } : step) : value.steps,
  });
  if (!equalValues(compared(confirmed.value), compared(draft))) return undefined;
  if (field === 'title') {
    const mine = existingRowField(draft.steps, id, SERVICE_ORDER_STEP_TITLE_TARGET);
    const stored = existingRowField(remoteCandidate.value.steps, id, SERVICE_ORDER_STEP_TITLE_TARGET);
    if (mine === undefined || stored === undefined || mine === stored) return undefined;
    return { field, mine, stored };
  }
  const mine = existingRowField(draft.steps, id, SERVICE_ORDER_FLAG_TARGET);
  const stored = existingRowField(remoteCandidate.value.steps, id, SERVICE_ORDER_FLAG_TARGET);
  if (mine === undefined || stored === undefined || mine === stored) return undefined;
  const step = Array.isArray(draft.steps) ? draft.steps.find(item => object(item) && item.id === id) : undefined;
  const title = object(step) && typeof step.title === 'string' && step.title.trim() ? step.title : undefined;
  return { field, mine, stored, title };
}


export function readSermonConflict(checkpoint: SessionCheckpoint) {
  const { conflicts, draft, remoteCandidate } = checkpoint;
  if (!conflicts.length || !draft || !remoteCandidate?.value) return undefined;
  const pointConflict = conflicts.find(({ path }) => exegeticalPointConflictId(path));
  const pointId = pointConflict && exegeticalPointConflictId(pointConflict.path);
  if (pointId) {
    const opening = exegeticalPlan(checkpoint.confirmed.value?.preparation);
    const local = exegeticalPlan(draft.preparation), saved = exegeticalPlan(remoteCandidate.value.preparation);
    if (!opening || !local || !saved || checkpoint.confirmed.metadata?.generation !== remoteCandidate.metadata?.generation) return undefined;
    const choice = readExegeticalPointChoice(opening, local, saved, pointId);
    if (!choice) return undefined;
    const mine = choice.mine?.point.title as string | undefined;
    const stored = choice.saved?.point.title as string | undefined;
    const identity = JSON.stringify([pointConflict!.path, mine, stored, remoteCandidate.metadata, checkpoint.editGeneration]);
    return { kind: 'exegetical-point' as const, identity, mine: mine ?? null, stored: stored ?? null, scoped: conflicts.length === 1 };
  }
  if (conflicts.length !== 1) return undefined;
  const { path, base } = conflicts[0];
  const mine = readSermonConflictField(draft, path);
  const stored = readSermonConflictField(remoteCandidate.value, path);
  const identity = JSON.stringify([path, mine, stored, remoteCandidate.metadata, checkpoint.editGeneration]);
  if (JSON.stringify(mine) === JSON.stringify(stored)) return undefined;
  const [field, rowId, property] = path;
  if (path.length === 1 && field === 'verse' && typeof mine.value === 'string' && typeof stored.value === 'string') {
    return { kind: 'verse' as const, identity, mine: mine.value, stored: stored.value };
  }
  const confirmation = preparationConfirmationField(path);
  if (confirmation && (!mine.exists || typeof mine.value === 'boolean') && (!stored.exists || typeof stored.value === 'boolean')) {
    return { kind: 'preparation-confirmation' as const, identity, field: confirmation, mine: mine.value === true, stored: stored.value === true };
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
