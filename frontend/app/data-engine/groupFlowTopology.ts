import { equalValues, readField } from './fieldValues';
import { placementSteps } from './serviceOrderStepPlacement';

import type { ConflictDetail, DocumentData, FieldChange, FieldValue } from './types';

export const GROUP_FLOW_COPY_CONTENT_MISSING = 'group-flow-copy-content-missing';
export const groupPlanFields = ['flow', 'templates'] as const;

type GroupStep = DocumentData & { id: string; templateId: string; order: number };
type GroupPlan = Record<typeof groupPlanFields[number], FieldValue>;
type Merge = (base: FieldValue, mine: FieldValue, theirs: FieldValue, path: string[]) => {
  value: FieldValue; conflicts: ConflictDetail[];
};

const field = (value: FieldValue['value']): FieldValue => value === undefined ? { exists: false } : { exists: true, value };

export function groupPlacementSteps(value: unknown): GroupStep[] | undefined {
  const steps = placementSteps(value);
  if (!steps?.every((step): step is GroupStep => typeof step.templateId === 'string' && step.templateId.length > 0
    && typeof step.order === 'number' && Number.isFinite(step.order))) return undefined;
  return [...steps].sort((first, second) => first.order - second.order);
}

export const groupPlan = (value: DocumentData): GroupPlan => ({
  flow: readField(value, ['flow']), templates: readField(value, ['templates']),
});

function newSharedTemplateIds(before: unknown, after: unknown): Set<string> {
  const opening = groupPlacementSteps(before), draft = groupPlacementSteps(after);
  if (!opening || !draft) return new Set();
  const ids = new Set(opening.map(row => row.id));
  const templates = new Set(opening.map(row => row.templateId));
  return new Set(draft.filter(row => !ids.has(row.id) && templates.has(row.templateId)).map(row => row.templateId));
}

/** Keep only the shown templates referenced by newly copied steps. */
export function groupFlowCopySources(before: DocumentData, after: DocumentData): DocumentData[] {
  const copied = newSharedTemplateIds(before.flow, after.flow);
  return placementSteps(before.templates)?.filter(template =>
    copied.has(template.id) && typeof template.createdAt === 'string') ?? [];
}

export function matchingGroupFlowCopySources(changes: FieldChange[], value: unknown) {
  const flow = changes.find(change => change.path[0] === 'flow');
  const before = groupPlacementSteps(flow?.before.value), after = groupPlacementSteps(flow?.after.value);
  const copies = placementSteps(value);
  if (!before || !after || !copies) return [];
  const oldRows = new Set(before.map(row => row.id));
  const addedRefs = new Set(after.filter(row => !oldRows.has(row.id)).map(row => row.templateId));
  const oldRefs = new Set(before.map(row => row.templateId));
  const templates = changes.find(change => change.path[0] === 'templates');
  const oldTemplates = placementSteps(templates?.before.value);
  const newTemplates = placementSteps(templates?.after.value);
  return copies.filter(template => addedRefs.has(template.id) && (oldRefs.has(template.id)
    || (oldTemplates && !oldTemplates.some(old => old.id === template.id)
      && newTemplates?.some(next => equalValues(next, template)))));
}

export function groupFlowRetirementSources(before: DocumentData, after: DocumentData) {
  const opening = groupPlacementSteps(before.flow), draft = groupPlacementSteps(after.flow);
  const remaining = placementSteps(after.templates);
  if (!opening || !draft || !remaining) return [];
  const nextRows = new Set(draft.map(row => row.id));
  const removedRefs = new Set(opening.filter(row => !nextRows.has(row.id)).map(row => row.templateId));
  const nextTemplates = new Map(remaining.map(template => [template.id, template]));
  return placementSteps(before.templates)?.filter(template => {
    const next = nextTemplates.get(template.id);
    return removedRefs.has(template.id) && (!next || equalValues(next, template));
  }) ?? [];
}

export function matchingGroupFlowRetirements(changes: FieldChange[], value: unknown) {
  const flow = changes.find(change => change.path[0] === 'flow');
  const before = groupPlacementSteps(flow?.before.value), after = groupPlacementSteps(flow?.after.value);
  const templates = placementSteps(value);
  if (!before || !after || !templates) return [];
  const afterIds = new Set(after.map(row => row.id));
  const removedRefs = new Set(before.filter(row => !afterIds.has(row.id)).map(row => row.templateId));
  return templates.filter(template => removedRefs.has(template.id));
}

export function captureGroupFlowCommandProofs(before: DocumentData, after: DocumentData, changes: FieldChange[]) {
  if (!changes.some(change => change.path[0] === 'flow')) return {};
  const sources = groupFlowCopySources(before, after);
  const remaining = new Set(placementSteps(after.templates)?.map(template => template.id));
  // Ordinary removal already carries its exact before/after template list.
  const retirements = groupFlowRetirementSources(before, after).filter(source => remaining.has(String(source.id)));
  return { ...(sources.length && { groupFlowCopySources: sources }), ...(retirements.length && { groupFlowRetirements: retirements }) };
}

/** An explicit choice may restore the visible words for its copy even without a server retirement proof. */
export function keepGroupFlowCopyContent(value: DocumentData | null, draft: DocumentData | null,
  conflicts: readonly ConflictDetail[], explicit = true) {
  const missing = conflicts.filter(conflict => conflict.code === GROUP_FLOW_COPY_CONTENT_MISSING);
  if (!missing.length || !value) return value;
  const rows = groupPlacementSteps(value.flow) ?? [];
  const templates = placementSteps(value.templates) ?? [];
  const local = placementSteps(draft?.templates) ?? [];
  const capturedRows = groupPlacementSteps(draft?.flow) ?? [];
  const retained = [...templates];
  for (const conflict of missing) {
    const id = conflict.path[1]?.slice(3);
    if (!rows.some(row => row.templateId === id) || retained.some(template => template.id === id)) continue;
    const shown = local.find(template => template.id === id);
    if (explicit && !shown) {
      throw Object.assign(new Error('The saved copy no longer has its original template'), { code: 'decision-changed' });
    }
    if (shown && (explicit || rows.some(row => row.templateId === id
      && capturedRows.some(captured => captured.id === row.id && captured.templateId === id)))) retained.push(shown);
  }
  return retained.length === templates.length ? value : { ...value, templates: retained };
}

function mergeFlow(base: FieldValue, mine: FieldValue, theirs: FieldValue, merge: Merge) {
  const before = groupPlacementSteps(base.value), draft = groupPlacementSteps(mine.value), saved = groupPlacementSteps(theirs.value);
  if (!before || !draft || !saved || equalValues(draft.map(row => row.id), saved.map(row => row.id))) {
    return merge(base, mine, theirs, ['flow']);
  }
  // The position of a row in this sequence is authored. Its numeric order is a projection.
  const frame = (rows: GroupStep[]) => field(rows.map(({ order: _order, ...row }) => row));
  const result = merge(frame(before), frame(draft), frame(saved), ['flow']);
  const rows = placementSteps(result.value.value);
  return rows ? { ...result, value: field(rows.map((row, index) => ({ ...row, order: index + 1 }))) } : result;
}

/** A last-reference deletion owns its step. It does not own a different step's surviving content. */
function conditionalTemplateRemoval(base: GroupPlan, mine: GroupPlan, mergedFlow: FieldValue) {
  const openingRows = groupPlacementSteps(base.flow.value), draftRows = groupPlacementSteps(mine.flow.value);
  const savedRows = groupPlacementSteps(mergedFlow.value);
  const before = placementSteps(base.templates.value), after = placementSteps(mine.templates.value);
  if (!openingRows || !draftRows || !savedRows || !before || !after) return mine.templates;
  const openingRefs = new Set(openingRows.map(row => row.templateId));
  const draftRefs = new Set(draftRows.map(row => row.templateId));
  const survivingRefs = new Set(savedRows.map(row => row.templateId));
  const positions = new Map(before.map((row, index) => [row.id, index]));
  const next = [...after];
  for (const [index, row] of before.entries()) {
    if (!openingRefs.has(row.id) || draftRefs.has(row.id) || !survivingRefs.has(row.id) || next.some(item => item.id === row.id)) continue;
    const following = next.findIndex(item => (positions.get(item.id) ?? -1) > index);
    next.splice(following === -1 ? next.length : following, 0, row);
  }
  return field(next);
}

type TemplateMap = Map<string, DocumentData>;
type TemplateResolution = { rows: GroupStep[]; templates: TemplateMap; conflicts: ConflictDetail[] };

function applyConditionalRetirements(next: TemplateResolution, saved: TemplateMap, retirements: readonly DocumentData[]) {
  const refs = new Set(next.rows.map(row => row.templateId));
  for (const retirement of retirements) {
    const id = String(retirement.id);
    const stored = saved.get(id);
    const template = next.templates.get(id);
    if (!stored || !template || refs.has(id)) continue;
    if (equalValues(stored, retirement) && equalValues(template, stored)) {
      next.templates.delete(id);
    } else {
      next.conflicts.push({ path: ['templates', `id:${id}`], base: field(retirement), mine: field(undefined), theirs: field(stored) });
    }
  }
}

function readableTemplate(candidate: DocumentData | undefined, stored: DocumentData | undefined,
  shown: DocumentData | undefined, verify?: (source: DocumentData) => boolean) {
  if (!shown) return candidate;
  if (stored) return candidate?.createdAt === shown.createdAt ? candidate : undefined;
  return (!candidate || equalValues(candidate, shown)) && verify?.(shown) ? shown : undefined;
}

function reconcileCopyReferences(base: GroupPlan, mine: GroupPlan, theirs: GroupPlan, next: TemplateResolution,
  sources: readonly DocumentData[], verifySource?: (source: DocumentData) => boolean) {
  const savedRows = new Map(groupPlacementSteps(theirs.flow.value)?.map(row => [row.id, row]));
  const savedTemplates = new Map(placementSteps(theirs.templates.value)?.map(template => [template.id, template]));
  const copies = new Map(sources.map(source => [source.id, source]));
  const considered = new Set<string>();
  for (const row of next.rows) {
    const { templateId: id } = row;
    const priorRow = savedRows.get(row.id);
    const nextTemplate = next.templates.get(id);
    const shown = priorRow ? undefined : copies.get(id);
    const savedTemplate = savedTemplates.get(id);
    const alreadyMissing = priorRow?.templateId === id && !savedTemplate;
    if (considered.has(id) || (!nextTemplate && alreadyMissing)) continue;
    const readable = readableTemplate(nextTemplate, savedTemplate, shown, verifySource);
    if (readable) {
      if (!nextTemplate) next.templates.set(id, readable);
      continue;
    }
    considered.add(id);
    const version = (templates: FieldValue) => field(placementSteps(templates.value)?.find(template => template.id === id));
    next.conflicts.push({ path: ['templates', `id:${id}`], ...(!savedTemplate && { code: GROUP_FLOW_COPY_CONTENT_MISSING }),
      base: shown ? field(shown) : version(base.templates), mine: shown ? field(shown) : version(mine.templates), theirs: field(savedTemplate) });
  }
}

export function mergeGroupPlan(base: GroupPlan, mine: GroupPlan, theirs: GroupPlan, merge: Merge,
  sources: readonly DocumentData[] = [], verifySource?: (source: DocumentData) => boolean,
  retirements: readonly DocumentData[] = []) {
  const flow = mergeFlow(base.flow, mine.flow, theirs.flow, merge);
  const templates = merge(base.templates, conditionalTemplateRemoval(base, mine, flow.value), theirs.templates, ['templates']);
  const before = placementSteps(templates.value.value);
  const next: TemplateResolution = {
    rows: groupPlacementSteps(flow.value.value) ?? [],
    templates: new Map(before?.map(template => [template.id, template])),
    conflicts: [...flow.conflicts, ...templates.conflicts],
  };
  if (retirements.length) applyConditionalRetirements(next,
    new Map(placementSteps(theirs.templates.value)?.map(template => [template.id, template])), retirements);
  reconcileCopyReferences(base, mine, theirs, next, sources, verifySource);
  const resolved = [...next.templates.values()];
  const changed = resolved.length !== (before?.length ?? 0) || resolved.some((row, index) => row !== before?.[index]);
  return { flow: flow.value, templates: changed ? field(resolved) : templates.value, conflicts: next.conflicts };
}
