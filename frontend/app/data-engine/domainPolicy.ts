import { deriveSeriesItemsFromSermonIds } from '@/utils/seriesItems';

import { diffFields, equalValues, validateCommand } from './protocol';

import type { CommandBase, DataCommand, DocumentData, ResourceRef, ResourceSnapshot } from './types';

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

/** Target generations are read inside the engine, never supplied by feature callers. */
export function requiredDomainTargets(confirmed: ResourceSnapshot, draft: DocumentData | null): ResourceRef[] {
  if (!confirmed.value || !draft || confirmed.resource.collection !== 'studyMaterials'
    || equalValues(confirmed.value.noteIds, draft.noteIds)) return [];
  return [...new Set([...ids(confirmed.value.noteIds), ...ids(draft.noteIds)])].map(id => ({ collection: 'studyNotes', id }));
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
