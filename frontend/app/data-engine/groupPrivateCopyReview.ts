import { buildId } from '@/utils/groupFlow';

import { commandFingerprint, equalValues } from './fieldValues';
import { groupFlowCopySources, groupPlacementSteps } from './groupFlowTopology';
import { restoreGroupPlacementOrder } from './groupStepPlacement';
import { placementSteps } from './serviceOrderStepPlacement';

import type { FieldSelection, PrivateField } from './privateFieldReview';
import type { SessionCheckpoint } from './session';
import type { DocumentData } from './types';

type CopyStep = NonNullable<ReturnType<typeof groupPlacementSteps>>[number];
export type PrivateGroupCopy = PrivateField & {
  field: 'copiedSteps';
  mine: string;
  stored: null;
  birth: string;
  template: DocumentData & { id: string; title: string };
  storedTemplate?: DocumentData;
  storedStepIds: string[];
  blockWords: string;
  steps: CopyStep[];
};

export function hasHeldGroupCopies(checkpoint: SessionCheckpoint): boolean {
  const { confirmed, draft, privateFieldReview } = checkpoint;
  const held = privateFieldReview?.groupCopySources;
  if (!held?.length || confirmed.resource.collection !== 'groups' || !draft) return false;
  if (!confirmed.value || !placementSteps(confirmed.value.templates)
    || !groupPlacementSteps(confirmed.value.flow) || !groupPlacementSteps(draft.flow)) return true;
  return groupFlowCopySources(confirmed.value, draft).some(source => held.includes(source.id));
}

function groupCopySourcesForReview(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate, unreadableScalarProof, unreadableRowProofs, pending } = checkpoint;
  if (confirmed.resource.collection !== 'groups' || !confirmed.value || !draft || !remoteCandidate?.value
    || confirmed.metadata?.generation !== remoteCandidate.metadata?.generation || Object.keys(pending).length
    || !(unreadableScalarProof?.length || unreadableRowProofs?.length || checkpoint.privateFieldReview?.groupCopySources?.length)) return [];
  const stored = placementSteps(remoteCandidate.value.templates);
  const held = new Set(checkpoint.privateFieldReview?.groupCopySources);
  return groupFlowCopySources(confirmed.value, draft).filter(source => held.has(source.id)
    || !stored?.some(template => template.id === source.id && template.createdAt === source.createdAt));
}

export function groupCopySourceIdsForReview(checkpoint: SessionCheckpoint): string[] {
  return groupCopySourcesForReview(checkpoint).map(source => source.id);
}

export function hasUnreviewedGroupCopy(checkpoint: SessionCheckpoint): boolean {
  return hasHeldGroupCopies(checkpoint) || groupCopySourcesForReview(checkpoint).length > 0;
}

function authoredWords(values: unknown[]) {
  return values.flat().filter(value => typeof value === 'string' && value.trim()).join('\n');
}

/** An exact new step can keep the draft block's words without restoring its deleted identity. */
export function privateGroupCopyFields(checkpoint: SessionCheckpoint): PrivateGroupCopy[] | undefined {
  const sources = groupCopySourcesForReview(checkpoint);
  if (!sources.length) return [];
  const { confirmed, draft, remoteCandidate } = checkpoint;
  const opening = groupPlacementSteps(confirmed.value?.flow), local = groupPlacementSteps(draft?.flow);
  const stored = groupPlacementSteps(remoteCandidate?.value?.flow), templates = placementSteps(draft?.templates);
  const savedTemplates = placementSteps(remoteCandidate?.value?.templates);
  if (!opening || !local || !stored || !templates || !savedTemplates) return;
  const openingIds = new Set(opening.map(step => step.id));
  const result: PrivateGroupCopy[] = [];
  for (const source of sources) {
    const template = templates.find(row => row.id === source.id && row.createdAt === source.createdAt);
    const steps = local.filter(step => step.templateId === source.id && !openingIds.has(step.id));
    const storedTemplate = savedTemplates.find(row => row.id === source.id);
    const storedStepIds = stored.filter(step => step.templateId === source.id).map(step => step.id);
    if (!template || typeof template.title !== 'string' || typeof template.content !== 'string'
      || typeof source.createdAt !== 'string' || !steps.length || (!storedTemplate && storedStepIds.length)
      || stored.some(step => steps.some(copy => copy.id === step.id))) return;
    const blockWords = authoredWords([template.title, template.summary, template.content, template.questions, template.scriptureRefs]);
    result.push({ field: 'copiedSteps', path: ['templates', 'id:' + source.id, 'copiedSteps'], birth: source.createdAt,
      template: { ...template, title: template.title }, storedTemplate, storedStepIds, steps, blockWords,
      witness: commandFingerprint([template, steps, storedTemplate, storedStepIds]),
      mine: authoredWords([blockWords, ...steps.flatMap(step => [step.instanceTitle, step.instanceNotes])]), stored: null });
  }
  return result;
}

export function projectPrivateGroupCopies(value: DocumentData, copies: readonly PrivateGroupCopy[], decisions: readonly FieldSelection[]) {
  if (!copies.length) return value;
  const ordered = groupPlacementSteps(value.flow), currentTemplates = placementSteps(value.templates);
  if (!ordered || !currentTemplates) return;
  let flow = ordered;
  let templates = currentTemplates;
  for (const copy of copies) {
    const decision = decisions.find(item => equalValues(item.path, copy.path));
    const sourceId = copy.template.id;
    if (!decision) return;
    const steps = new Set(copy.steps.map(step => step.id)), stored = new Set(copy.storedStepIds);
    if (flow.filter(step => step.templateId === sourceId && steps.has(step.id)).length !== steps.size
      || flow.some(step => step.templateId === sourceId && !steps.has(step.id) && !stored.has(step.id))) return;
    const original = templates.find(template => template.id === sourceId);
    if (copy.storedTemplate?.createdAt === copy.birth) {
      // Ordinary block fields have already been merged or chosen on the returned original.
      if (original?.createdAt !== copy.birth) return;
    } else if (copy.storedTemplate && original) {
      const saved = copy.storedTemplate;
      templates = templates.map(template => template.id === sourceId ? { ...saved, id: sourceId } : template);
    } else {
      templates = templates.filter(template => template.id !== sourceId);
      if (copy.storedTemplate) templates.push({ ...copy.storedTemplate, id: sourceId });
    }
    if (decision.side === 'remote') {
      flow = flow.filter(step => !steps.has(step.id));
      continue;
    }
    const id = buildId('template'), now = new Date().toISOString();
    templates.push({ ...copy.template, id, createdAt: now, updatedAt: now });
    flow = flow.map(step => steps.has(step.id) ? { ...step, templateId: id } : step);
  }
  return restoreGroupPlacementOrder({ ...value, templates, flow }) ?? undefined;
}
