import { DOCUMENT_BOOKKEEPING_FIELDS } from '@/utils/documentBookkeeping';

import { COUNCIL_ASSEMBLY, councilAssemblyRow } from './councilAssemblyAction';
import { COUNCIL_TOPIC_KIND, councilTopicKindRow } from './councilTopicKindAction';
import { COUNCIL_TOPIC_TITLE, councilTopicTitleRow } from './councilTopicTitleAction';
import { equalValues, object } from './fieldValues';
import { existingRowField, replaceExistingRowField } from './rowFieldAction';
import { readSermonConflictField } from './sermonFieldChoice';
import { SERVICE_ORDER_FLAG_TARGET, SERVICE_ORDER_STEP_TITLE_TARGET, serviceOrderStepField } from './serviceOrderStepAction';

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
  if (conflicts.length !== 1 || !draft || !remoteCandidate?.value) return undefined;
  const { path, base } = conflicts[0];
  const mine = readSermonConflictField(draft, path);
  const stored = readSermonConflictField(remoteCandidate.value, path);
  const identity = JSON.stringify([path, mine, stored, remoteCandidate.metadata, checkpoint.editGeneration]);
  if (JSON.stringify(mine) === JSON.stringify(stored)) return undefined;
  const [field, rowId, property] = path;
  if (path.length === 1 && field === 'verse' && typeof mine.value === 'string' && typeof stored.value === 'string') {
    return { kind: 'verse' as const, identity, mine: mine.value, stored: stored.value };
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
