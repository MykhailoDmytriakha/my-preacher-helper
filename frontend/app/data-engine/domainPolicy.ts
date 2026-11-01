import { deriveSeriesItemsFromSermonIds } from '@/utils/seriesItems';
import { isServiceOrderCatalogKey, serviceOrderSeedCycle } from '@/utils/serviceOrderSeedIdentity';
import { preservesStudyAnalysisSource } from '@/utils/studyAnalysisSource';

import { ANALYSIS_RESHAPE_FRAME, sameAnalysisFrame } from './analysisReshapeFields';
import { firstBookMarksIntent } from './bibleMarksCreation';
import { carriedCopy, validCouncilCarry } from './councilCarryContent';
import { materialNoteIds } from './documentReferences';
import { diffFields, equalValues, readField, validateCommand, MAX_RELATION_RESOURCES } from './protocol';

import type { CommandBase, DataCommand, DocumentData, FieldChange, ResourceRef, ResourceSnapshot } from './types';

export interface DomainPreparation {
  command: DataCommand;
  /** Only local fields carried by this command; unsent sibling edits stay outside this value. */
  submittedValue: DocumentData | null;
}
const REFERENCED_DOCUMENT_DELETED = 'referenced-document-deleted';
const PERMISSION_DENIED = 'permission-denied';
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const failure = (message: string, code = 'invalid-argument'): never => { throw Object.assign(new Error(message), { code }); };
const ids = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string')) return failure('Invalid membership identifiers');
  return value as string[];
};
const items = (value: DocumentData, legacy = true): DocumentData[] => {
  if (value.items === undefined && !legacy) return [];
  if (value.items === undefined || (legacy && Array.isArray(value.items) && value.items.length === 0 && ids(value.sermonIds).length > 0)) {
    return deriveSeriesItemsFromSermonIds(ids(value.sermonIds)) as unknown as DocumentData[];
  }
  if (!Array.isArray(value.items)) return failure('Invalid series items');
  return value.items as DocumentData[];
};
const project = (base: DocumentData, draft: DocumentData, fields: readonly string[]): DocumentData => {
  const value = copy(base);
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(draft, field)) value[field] = copy(draft[field]);
    else delete value[field];
  }
  return value;
};

const topics = (value: DocumentData | null | undefined): DocumentData[] => {
  if (!value || value.topics === undefined) return [];
  if (!Array.isArray(value.topics)) return failure('Invalid council topics');
  return value.topics as DocumentData[];
};

/** Where each section claims to have been carried: the only part a carry may introduce. */
const carriedTo = (value: DocumentData | null | undefined): Map<string, string> => {
  const marks = new Map<string, string>();
  for (const topic of topics(value)) {
    if (typeof topic.id === 'string' && typeof topic.carriedToCouncilId === 'string') marks.set(topic.id, topic.carriedToCouncilId);
  }
  return marks;
};

/** Destinations this save newly claims. Editing a section claims nothing and stays alone. */
function newCarryDestinations(confirmed: ResourceSnapshot, draft: DocumentData | null): string[] {
  if (confirmed.resource.collection !== 'councils' || !confirmed.value || !draft) return [];
  const before = carriedTo(confirmed.value);
  const destinations = new Set<string>();
  for (const [topicId, councilId] of carriedTo(draft)) {
    if (before.get(topicId) !== councilId) destinations.add(councilId);
  }
  return [...destinations];
}

/** Target generations are read inside the engine, never supplied by feature callers. */
export function requiredDomainTargets(confirmed: ResourceSnapshot, draft: DocumentData | null): ResourceRef[] {
  const carried = newCarryDestinations(confirmed, draft);
  if (carried.length) return carried.map(id => ({ collection: 'councils', id }));
  if (!confirmed.value || !draft || confirmed.resource.collection !== 'studyMaterials'
    || equalValues(confirmed.value.noteIds, draft.noteIds)) return [];
  return materialNoteIds(ids(confirmed.value.noteIds), ids(draft.noteIds)).map(id => ({ collection: 'studyNotes', id }));
}

/**
 * One save, two councils. The screen marks a section as carried; the destination, its generation
 * and the copy are the engine's business, so no screen can mark a source without the section
 * actually landing.
 */
function prepareCarry(base: CommandBase, confirmed: ResourceSnapshot & { value: DocumentData }, draft: DocumentData,
  destinations: string[], targets: readonly ResourceSnapshot[]): DomainPreparation {
  if (destinations.length !== 1) return failure('Carry one section at a time');
  const [destination] = destinations;
  if (destination === confirmed.resource.id) return failure('A section cannot be carried to its own council');
  const target = targets.find(candidate => candidate.resource.collection === 'councils' && candidate.resource.id === destination);
  if (!target) return failure('A confirmed destination snapshot is required', 'missing-target-generation');
  if (!target.value || target.metadata?.deleted) return failure('The destination council was deleted', REFERENCED_DOCUMENT_DELETED);
  if (target.value.userId !== base.owner) return failure('The destination council belongs to another owner', PERMISSION_DENIED);

  const before = carriedTo(confirmed.value);
  const moved = topics(draft).filter(topic => typeof topic.id === 'string'
    && topic.carriedToCouncilId === destination && before.get(topic.id as string) !== destination);
  if (moved.length !== 1) return failure('Carry one section at a time');

  return {
    command: { ...base, kind: 'relation', relation: 'council-carry', edits: [
      { resource: copy(confirmed.resource), generation: base.generation, beforeTopics: copy(topics(confirmed.value)), afterTopics: copy(topics(draft)) },
      { resource: copy(target.resource), generation: target.metadata?.generation ?? null,
        beforeTopics: copy(topics(target.value)), afterTopics: [...copy(topics(target.value)), carriedCopy(moved[0], base.operationId)] },
    ] },
    submittedValue: project(confirmed.value, draft, ['topics']),
  };
}

function materialTargets(owner: string, required: ResourceRef[], targets: readonly ResourceSnapshot[]) {
  return required.map(resource => {
    const target = targets.find(candidate => candidate.resource.collection === resource.collection && candidate.resource.id === resource.id);
    if (!target) return failure('A confirmed target snapshot is required', 'missing-target-generation');
    if (!target.value || target.metadata?.deleted) return failure('The referenced note was deleted', REFERENCED_DOCUMENT_DELETED);
    if (target.value.userId !== owner) return failure('Referenced note belongs to another owner', PERMISSION_DENIED);
    return { id: resource.id, generation: target.metadata?.generation ?? null };
  });
}

function prepareUpdate(base: CommandBase, confirmed: ResourceSnapshot & { value: DocumentData }, draft: DocumentData, targets: readonly ResourceSnapshot[]): DomainPreparation {
  const changes = diffFields(confirmed.value, draft);
  const collection = confirmed.resource.collection;
  if (collection === 'studyNotes' && !preservesStudyAnalysisSource(confirmed.value, draft)) return failure('An analysis must keep its original word source', 'invalid-document');
  const carried = newCarryDestinations(confirmed, draft);
  if (carried.length) return prepareCarry(base, confirmed, draft, carried, targets);
  const forbidden = collection === 'studyNotes' ? ['materialIds'] : ['sermons', 'groups'].includes(collection) ? ['seriesId', 'seriesPosition'] : [];
  if (changes.some(change => forbidden.includes(change.path[0]))) return failure('Edit membership through its material or series', 'relation-owner-required');
  if (collection === 'studyMaterials' && changes.some(change => change.path[0] === 'noteIds')) {
    return {
      command: { ...base, kind: 'relation', relation: 'material-notes', beforeNoteIds: ids(confirmed.value.noteIds), afterNoteIds: ids(draft.noteIds), targets: materialTargets(base.owner, requiredDomainTargets(confirmed, draft), targets) },
      submittedValue: project(confirmed.value, draft, ['noteIds']),
    };
  }
  if (collection === 'series' && changes.some(change => change.path[0] === 'items')) {
    return {
      command: { ...base, kind: 'relation', relation: 'series-membership', edits: [{ resource: copy(confirmed.resource), generation: base.generation, beforeItems: copy(items(confirmed.value)), afterItems: copy(items(draft, false)) }] },
      submittedValue: project(confirmed.value, draft, ['items', 'sermonIds', 'seriesKind']),
    };
  }
  if (collection === 'series' && changes.some(change => ['sermonIds', 'seriesKind'].includes(change.path[0]))) return failure('Series mirrors are derived from items', 'derived-field');
  const writable = collection === 'studyNotes' ? changes.filter(change => change.path[0] !== 'isDraft') : changes;
  if (!writable.length) return failure('Only a server-derived field changed', 'derived-field');
  // Unchanged roots prove which passage the positions were authored against. A delayed
  // command must not borrow those roots from a newer server snapshot.
  const positional = collection === 'studyNotes' && (confirmed.value.type === 'analysis' || draft.type === 'analysis')
    && writable.some(change => ANALYSIS_RESHAPE_FRAME.some(field => change.path[0] === field));
  const guarded = positional ? [...writable.filter(change => !ANALYSIS_RESHAPE_FRAME.some(field => change.path[0] === field)),
    ...ANALYSIS_RESHAPE_FRAME.map(field => ({ path: [field], before: readField(confirmed.value, [field]), after: readField(draft, [field]) }))] : writable;
  return { command: { ...base, kind: 'update', changes: guarded }, submittedValue: copy(draft) };
}

/** One command per ACK boundary. Authored baselines stay pinned; first marks use a logical empty book. */
export function prepareDomainCommand(owner: string, operationId: string, confirmed: ResourceSnapshot, draft: DocumentData | null, targets: readonly ResourceSnapshot[] = []): DomainPreparation {
  const base: CommandBase = { protocol: 1, owner, operationId, resource: copy(confirmed.resource), generation: confirmed.metadata?.generation ?? null, dependsOn: [] };
  let prepared: DomainPreparation;
  if (draft === null) prepared = { command: { ...base, kind: 'delete', baseline: copy(confirmed.value ?? {}) }, submittedValue: null };
  else if (confirmed.value === null) {
    if (confirmed.metadata?.deleted) return failure('Deleted documents require a new copy', 'use-new-copy');
    if ((confirmed.resource.collection === 'studyNotes' && ids(draft.materialIds).length)
      || (['sermons', 'groups'].includes(confirmed.resource.collection) && (draft.seriesId != null || draft.seriesPosition != null))) {
      return failure('Edit membership through its material or series', 'relation-owner-required');
    }
    const target = targets.find(candidate => candidate.resource.collection === confirmed.resource.collection && candidate.resource.id === confirmed.resource.id);
    const marks = target && firstBookMarksIntent(confirmed, draft, target);
    const seed = confirmed.resource.collection === 'serviceOrders' && isServiceOrderCatalogKey(draft.catalogKey)
      && serviceOrderSeedCycle(owner, draft.catalogKey, confirmed.resource.id) !== null;
    prepared = { command: marks ? { ...base, kind: 'update', generation: target!.metadata?.generation ?? null, changes: [
      { path: ['verses'], before: { exists: true, value: marks.baseline.verses }, after: { exists: true, value: marks.value.verses } },
      ...diffFields(target!.value!, marks.value).filter(change => change.path[0] === 'updatedAt'),
    ] } : seed ? { ...base, kind: 'relation', relation: 'service-order-seed', value: copy(draft) }
      : { ...base, kind: 'create', value: copy(draft) }, submittedValue: copy(draft) };
  } else prepared = prepareUpdate(base, { ...confirmed, value: confirmed.value }, draft, targets);
  return { ...prepared, command: copy(validateCommand(prepared.command)) };
}

/** A move owns membership fields; creating a member also owns its absent document. */
export function prepareAtomicSeriesCommand(owner: string, operationId: string, participants: readonly { confirmed: ResourceSnapshot; draft: DocumentData | null }[]): DataCommand {
  if (participants.length < 2 || participants.length > MAX_RELATION_RESOURCES) return failure('A series move requires a bounded participant group');
  const creation = participants[0].confirmed.resource.collection !== 'series' ? participants[0] : null;
  if (creation && (participants.length !== 2 || !['sermons', 'groups'].includes(creation.confirmed.resource.collection)
    || creation.confirmed.value || creation.confirmed.metadata || !creation.draft || creation.draft.userId !== owner)) return failure('A new owned member is required');
  const edits = (creation ? participants.slice(1) : participants).map(({ confirmed, draft }) => {
    if (confirmed.resource.collection !== 'series' || !confirmed.value || confirmed.metadata?.deleted || !draft) return failure('Live series participants are required', REFERENCED_DOCUMENT_DELETED);
    if (confirmed.value.userId !== owner || draft.userId !== owner) return failure('Series belongs to another owner', PERMISSION_DENIED);
    if (diffFields(confirmed.value, draft).some(change => !['items', 'sermonIds', 'seriesKind'].includes(change.path[0]))) return failure('Save ordinary fields separately from a series move', 'atomic-membership-only');
    return { resource: copy(confirmed.resource), generation: confirmed.metadata?.generation ?? null,
      beforeItems: copy(items(confirmed.value)), afterItems: copy(items(draft, false)) };
  });
  if (creation) return validateCommand({ protocol: 1, owner, operationId, resource: copy(creation.confirmed.resource), generation: null,
    dependsOn: [], kind: 'relation', relation: 'series-member-create', value: copy(creation.draft!), edit: edits[0] });
  return validateCommand({ protocol: 1, owner, operationId, resource: edits[0].resource, generation: edits[0].generation,
    dependsOn: [], kind: 'relation', relation: 'series-membership', edits });
}


/** A click-only council carry uses the same durable participants as a series move. */
export function prepareAtomicDomainCommand(owner: string, operationId: string,
  participants: readonly { confirmed: ResourceSnapshot; draft: DocumentData | null }[]): DataCommand {
  if (participants[0]?.confirmed.resource.collection === 'studyNotes') {
    if (participants.length < 2 || participants.length > 3) return failure('An analysis reshape requires two or three participants');
    const [source] = participants;
    if (source.confirmed.resource.collection !== 'studyNotes' || !source.confirmed.value || source.confirmed.metadata?.deleted
      || !source.draft || source.confirmed.value.userId !== owner || source.draft.userId !== owner
      || source.confirmed.value.type !== 'analysis' || source.draft.type !== 'analysis'
      || !source.confirmed.value.analysis || !source.draft.analysis || sameAnalysisFrame(source.confirmed.value, source.draft)) {
      return failure('A live owned source analysis with a changed authored frame is required');
    }
    const seen = new Set<string>();
    const edits = participants.map(({ confirmed, draft }, index) => {
      if (confirmed.resource.collection !== 'studyNotes' || seen.has(confirmed.resource.id)) return failure('Analysis reshape participants must be distinct study notes');
      seen.add(confirmed.resource.id);
      if (!draft || draft.userId !== owner || draft.type !== 'analysis' || !draft.analysis) return failure('Analysis reshape notes must be owned analyses');
      if (confirmed.value === null) {
        if (index === 0 || confirmed.metadata) return failure('Only an absent recipient can be created', 'use-new-copy');
        if (!Array.isArray(draft.scriptureRefs) || typeof draft.content !== 'string') return failure('A complete analysis recipient is required');
        return { resource: copy(confirmed.resource), generation: null, changes: [], create: copy(draft) };
      }
      if (confirmed.metadata?.deleted) return failure('Deleted notes require a new copy', 'use-new-copy');
      if (confirmed.value.userId !== owner || confirmed.value.type !== 'analysis' || !confirmed.value.analysis
        || typeof confirmed.value.content !== 'string' || !Array.isArray(confirmed.value.scriptureRefs)
        || !preservesStudyAnalysisSource(confirmed.value, draft)) return failure('Analysis reshape requires a live owned analysis frame', 'invalid-document');
      const changes: FieldChange[] = ANALYSIS_RESHAPE_FRAME.map(field => ({ path: [field], before: readField(confirmed.value!, [field]), after: readField(draft, [field]) }));
      const title = diffFields(confirmed.value, draft).find(change => change.path[0] === 'title');
      if (title) changes.push(title);
      return { resource: copy(confirmed.resource), generation: confirmed.metadata?.generation ?? null, changes };
    });
    if (!edits[0] || 'create' in edits[0]) return failure('The source analysis cannot be a new recipient');
    return validateCommand({ protocol: 1, owner, operationId, resource: copy(source.confirmed.resource),
      generation: source.confirmed.metadata?.generation ?? null, dependsOn: [], kind: 'relation', relation: 'analysis-reshape', edits });
  }
  if (participants[0]?.confirmed.resource.collection !== 'councils') return prepareAtomicSeriesCommand(owner, operationId, participants);
  if (participants.length !== 2) return failure('A council carry requires two participants');
  const [source, target] = participants;
  if (!source.confirmed.value || source.confirmed.metadata?.deleted || !source.draft
    || source.confirmed.value.userId !== owner || source.draft.userId !== owner) return failure('A live owned source council is required');
  if (target.confirmed.resource.collection !== 'councils' || target.confirmed.metadata?.deleted || !target.draft
    || (target.confirmed.value && target.confirmed.value.userId !== owner) || target.draft.userId !== owner
    || target.draft.status !== 'preparing' || (!target.confirmed.value && target.confirmed.metadata)) return failure('An owned destination council is required');
  if (diffFields(source.confirmed.value, source.draft).some(change => change.path[0] !== 'topics')
    || (target.confirmed.value && diffFields(target.confirmed.value, target.draft).some(change => change.path[0] !== 'topics'))) return failure('Save ordinary council fields separately', 'atomic-carry-only');
  const destinations = newCarryDestinations(source.confirmed, source.draft);
  const beforeTopics = topics(target.confirmed.value), afterTopics = topics(target.draft);
  if (destinations.length !== 1 || destinations[0] !== target.confirmed.resource.id
    || source.confirmed.resource.id === target.confirmed.resource.id) return failure('Carry one section to another council');
  if (!validCouncilCarry(topics(source.confirmed.value), topics(source.draft), target.confirmed.resource.id,
    afterTopics, beforeTopics)) return failure('Invalid council carry content');
  return validateCommand({ protocol: 1, owner, operationId, resource: copy(source.confirmed.resource),
    generation: source.confirmed.metadata?.generation ?? null, dependsOn: [], kind: 'relation', relation: 'council-carry', edits: [
      { resource: copy(source.confirmed.resource), generation: source.confirmed.metadata?.generation ?? null,
        beforeTopics: copy(topics(source.confirmed.value)), afterTopics: copy(topics(source.draft)) },
      { resource: copy(target.confirmed.resource), generation: target.confirmed.metadata?.generation ?? null,
        beforeTopics: copy(beforeTopics), afterTopics: copy(afterTopics), ...(!target.confirmed.value ? { create: copy(target.draft) } : {}) },
    ] });
}
