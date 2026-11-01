import { deriveSeriesItemsFromSermonIds } from '@/utils/seriesItems';

import { diffFields, equalValues } from './protocol';

import type { CommitRequest } from './commits';
import type { DataCommand, DocumentData, ResourceRef } from './types';

const object = (value: unknown): value is DocumentData => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
const key = (resource: ResourceRef) => JSON.stringify([resource.collection, resource.id]);
const notes = (values: readonly string[]): ResourceRef[] => values.map(id => ({ collection: 'studyNotes', id }));

/** The reverse-link transaction touches both removed and added material members. */
export const materialNoteIds = (before: unknown, after: unknown): string[] => [...new Set([...ids(before), ...ids(after)])];

/** Input validation stays with the command/schema owner; these are its live target addresses. */
export function seriesMemberResources(items: readonly DocumentData[]): ResourceRef[] {
  return items.flatMap(item => typeof item.refId === 'string' && item.refId && ['sermon', 'group'].includes(String(item.type))
    ? [{ collection: item.type === 'sermon' ? 'sermons' : 'groups', id: item.refId }] : []);
}

function scratchSources(value: DocumentData | null): Map<string, string> {
  const sources = new Map<string, string>();
  if (Array.isArray(value?.scratch)) for (const item of value.scratch) {
    if (object(item) && typeof item.id === 'string' && object(item.source) && typeof item.source.noteId === 'string') sources.set(item.id, item.source.noteId);
  }
  return sources;
}

/** Historical provenance survives a missing source; only newly assigned provenance needs it live. */
export function sermonSourceReferences(before: DocumentData | null, after: DocumentData, changed: readonly string[]): {
  noteIds: string[]; invalidProvenance: boolean;
} {
  const added = new Set<string>(), accepted = ids(after.sourceNoteIds);
  if (changed.includes('sourceNoteIds')) {
    const original = Array.isArray(before?.sourceNoteIds) ? before.sourceNoteIds : [];
    for (const id of accepted) if (!original.includes(id)) added.add(id);
  }
  let invalidProvenance = false;
  if (changed.includes('scratch')) {
    const original = scratchSources(before);
    for (const [id, noteId] of scratchSources(after)) {
      if (original.get(id) === noteId) continue;
      if (!accepted.includes(noteId)) invalidProvenance = true;
      added.add(noteId);
    }
  }
  return { noteIds: [...added], invalidProvenance };
}

/** A captured document is intent, never proof that its referenced documents already exist. */
export function documentReferenceResources(resource: ResourceRef, before: DocumentData | null, after: DocumentData | null): ResourceRef[] {
  if (!after) return [];
  if (resource.collection === 'sermons') {
    const changed = before ? diffFields(before, after).map(change => change.path[0]) : ['sourceNoteIds', 'scratch'];
    return notes(sermonSourceReferences(before, after, changed).noteIds);
  }
  if (resource.collection === 'studyMaterials') {
    return before && equalValues(before.noteIds, after.noteIds) ? [] : notes(materialNoteIds(before?.noteIds, after.noteIds));
  }
  if (resource.collection === 'series' && (!before || !equalValues(before.items, after.items) || !equalValues(before.sermonIds, after.sermonIds))) {
    const items = after.items === undefined || Array.isArray(after.items) && !after.items.length && ids(after.sermonIds).length
      ? deriveSeriesItemsFromSermonIds(ids(after.sermonIds)) as unknown as DocumentData[]
      : Array.isArray(after.items) ? after.items.filter(object) : [];
    return seriesMemberResources(items);
  }
  return [];
}

/** Persisted commands may predate readiness checks. Read their immutable payload, not a later editor. */
export function commandReferenceResources(command: DataCommand): ResourceRef[] {
  if (command.kind === 'delete') return [];
  if (command.kind === 'create') return documentReferenceResources(command.resource, null, command.value);
  if (command.kind === 'update') {
    const before: DocumentData = {}, after: DocumentData = {};
    for (const change of command.changes) {
      if (change.before.exists) before[change.path[0]] = change.before.value!;
      if (change.after.exists) after[change.path[0]] = change.after.value!;
    }
    return documentReferenceResources(command.resource, before, after);
  }
  switch (command.relation) {
    case 'material-notes': return notes(materialNoteIds(command.beforeNoteIds, command.afterNoteIds));
    case 'series-membership': return command.edits.flatMap(edit => [edit.resource, ...seriesMemberResources(edit.afterItems as unknown as DocumentData[])]);
    case 'series-member-create': return [command.edit.resource, ...documentReferenceResources(command.resource, null, command.value),
      ...seriesMemberResources(command.edit.afterItems as unknown as DocumentData[])];
    case 'council-carry':
    case 'analysis-reshape': return command.edits.filter(edit => edit.create === undefined).map(edit => edit.resource);
    default: return [];
  }
}

/** Only an outstanding creation delays a dependent save. This index is ephemeral, not another queue. */
export function referenceReadiness(owner: string, records: readonly CommitRequest[]): (resources: readonly ResourceRef[], operationId: string) => boolean {
  const pending = new Map<string, Set<string>>();
  for (const record of records) {
    if (record.owner !== owner || !['queued', 'prepared'].includes(record.state) || record.predecessor !== null || record.value === null
      || record.baseline.value !== null || record.baseline.metadata !== null || record.working.value !== null || record.working.metadata !== null) continue;
    const resource = key(record.baseline.resource), operations = pending.get(resource) ?? new Set<string>();
    operations.add(record.atomic?.id ?? record.id); pending.set(resource, operations);
  }
  // Co-written atomic participants cannot wait for their own operation to be acknowledged.
  return (resources, operationId) => !resources.some(resource => [...(pending.get(key(resource)) ?? [])].some(id => id !== operationId));
}
