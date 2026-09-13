import { deriveSeriesItemsFromSermonIds } from '@/utils/seriesItems';

import { diffFields, equalValues, validateCommand } from './protocol';

import type { CommandBase, DataCommand, DocumentData, Json, ResourceRef, ResourceSnapshot } from './types';

export interface DomainPreparation {
  command: DataCommand;
  /** Only local fields carried by this command; unsent sibling edits stay outside this value. */
  submittedValue: DocumentData | null;
}
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
  return [...new Set([...ids(confirmed.value.noteIds), ...ids(draft.noteIds)])].map(id => ({ collection: 'studyNotes', id }));
}

/**
 * The copy that lands in the next council, addressed by the operation rather than by chance.
 * A lost acknowledgement makes the client send the same immutable command again; a random id
 * would then add a second copy of the same section beside the first.
 */
function carriedCopy(topic: DocumentData, operationId: string): DocumentData {
  const derive = (suffix: string) => `${operationId}-${suffix}`;
  const list = (value: unknown, kind: string): DocumentData[] => Array.isArray(value)
    ? value.map((entry, index) => ({ ...(entry as DocumentData), id: derive(`${kind}-${index}`) })) : [];
  return {
    id: derive('topic'),
    ...(topic.kind !== undefined ? { kind: topic.kind } : {}),
    title: topic.title,
    ...(topic.summary !== undefined ? { summary: topic.summary } : {}),
    questions: list(topic.questions, 'q') as unknown as Json[],
    options: list(topic.options, 'o') as unknown as Json[],
    ...(topic.forAssembly ? { forAssembly: true } : {}),
  };
}

/**
 * One save, two councils. The screen marks a section as carried; the destination, its generation
 * and the copy are the engine's business, so no screen can mark a source without the section
 * actually landing.
 */
function prepareCarry(base: CommandBase, confirmed: ResourceSnapshot & { value: DocumentData }, draft: DocumentData,
  destinations: string[], targets: readonly ResourceSnapshot[]): DomainPreparation {
  if (destinations.length !== 1) return failure('Carry one section at a time', 'invalid-argument');
  const [destination] = destinations;
  if (destination === confirmed.resource.id) return failure('A section cannot be carried to its own council', 'invalid-argument');
  const target = targets.find(candidate => candidate.resource.collection === 'councils' && candidate.resource.id === destination);
  if (!target) return failure('A confirmed destination snapshot is required', 'missing-target-generation');
  if (!target.value || target.metadata?.deleted) return failure('The destination council was deleted', 'referenced-document-deleted');
  if (target.value.userId !== base.owner) return failure('The destination council belongs to another owner', 'permission-denied');

  const before = carriedTo(confirmed.value);
  const moved = topics(draft).filter(topic => typeof topic.id === 'string'
    && topic.carriedToCouncilId === destination && before.get(topic.id as string) !== destination);
  if (moved.length !== 1) return failure('Carry one section at a time', 'invalid-argument');

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
    if (!target.value || target.metadata?.deleted) return failure('The referenced note was deleted', 'referenced-document-deleted');
    if (target.value.userId !== owner) return failure('Referenced note belongs to another owner', 'permission-denied');
    return { id: resource.id, generation: target.metadata?.generation ?? null };
  });
}

function prepareUpdate(base: CommandBase, confirmed: ResourceSnapshot & { value: DocumentData }, draft: DocumentData, targets: readonly ResourceSnapshot[]): DomainPreparation {
  const changes = diffFields(confirmed.value, draft);
  const collection = confirmed.resource.collection;
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
  return { command: { ...base, kind: 'update', changes: writable }, submittedValue: copy(draft) };
}

/** One command per ACK boundary. This never uses a refreshed primary value as the user's baseline. */
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
    prepared = { command: { ...base, kind: 'create', value: copy(draft) }, submittedValue: copy(draft) };
  } else prepared = prepareUpdate(base, { ...confirmed, value: confirmed.value }, draft, targets);
  return { ...prepared, command: copy(validateCommand(prepared.command)) };
}
