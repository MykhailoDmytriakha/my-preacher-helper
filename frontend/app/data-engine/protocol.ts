import { getUtf8ByteLength } from '@/utils/feedbackPayload';

import { validateResourceDocument } from './resourceSchemas';

import type {
  CommandResult, ConflictDetail, DataCommand, DocumentData, FieldChange,
  FieldValue, Json, ResourceSnapshot,
} from './types';

/**
 * Where a tombstone names its owner. Deliberately NOT the collection's legacy owner field: every
 * legacy reader — server repository, /api/owner-list, the SDK query inside a bundle already
 * shipped — asks `where(userId == uid)`, and a tombstone that answered it was drawn as a blank,
 * editable document. Shipped bundles cannot be taught to skip it, so it must not match at all.
 */
export const TOMBSTONE_OWNER_FIELD = '_dataEngineOwner';
/** Related effects, command participants and client ownership share this bound. */
export const MAX_RELATION_RESOURCES = 100;

const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value: unknown): value is DocumentData => value !== null
  && typeof value === 'object' && !Array.isArray(value);
const fail = (message: string): never => { throw Object.assign(new Error(message), { code: 'invalid-argument' }); };

const fields: Record<string, readonly string[]> = {
  _dataEngineHeads: [],
  studyNoteShareLinks: [],
  sermons: ['title', 'verse', 'date', 'thoughts', 'scratch', 'outline', 'thoughtsBySection', 'structure',
    'insights', 'draft', 'plan', 'planText', 'planMode', 'isPreached', 'preparation', 'seriesId',
    'seriesPosition', 'sourceNoteIds', 'church', 'preachDates', 'audioChunks', 'audioMetadata'],
  studyNotes: ['title', 'content', 'scriptureRefs', 'tags', 'isDraft', 'materialIds', 'type'],
  studyMaterials: ['title', 'description', 'type', 'noteIds', 'sections'],
  groups: ['title', 'description', 'status', 'templates', 'flow', 'meetingDates', 'seriesId', 'seriesPosition'],
  series: ['title', 'description', 'theme', 'bookOrTopic', 'sermonIds', 'items', 'seriesKind',
    'startDate', 'duration', 'color', 'status'],
  prayerRequests: ['title', 'description', 'categoryId', 'tags', 'status', 'updates', 'answeredAt', 'answerText'],
  prayerCategories: ['name', 'color'],
  serviceOrders: ['title', 'summary', 'steps', 'rank', 'catalogKey'],
  councils: ['title', 'date', 'status', 'heldAt', 'topics'],
  planTemplates: ['name', 'structure'],
  tags: ['name', 'color', 'required'],
  users: ['language', 'email', 'displayName', 'firstDayOfWeek', 'enablePrepMode', 'enableAudioGeneration',
    'enableStructurePreview', 'enableGroups', 'showAppVersion', 'preferredProviderId', 'preferredModelId',
    'preferredTranscription', 'preferredText', 'preferredTts'],
};

/** One registration determines which user data a command may mutate. */
export function getResourcePolicy(collection: string) {
  if (!own(fields, collection)) return fail('Unregistered DataEngine collection');
  return {
    allowed: true as const,
    allowWrite: collection !== '_dataEngineHeads' && collection !== 'studyNoteShareLinks',
    ownerField: collection === 'users' ? 'id' as const : collection === 'studyNoteShareLinks' ? 'ownerId' as const : 'userId' as const,
    writableFields: [...fields[collection], 'createdAt', 'updatedAt'],
    allowDelete: collection !== 'users' && collection !== '_dataEngineHeads' && collection !== 'studyNoteShareLinks',
  };
}

function validateJson(value: unknown, depth = 0): void {
  if (depth > 64) fail('Document nesting is too deep');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach(item => validateJson(item, depth + 1)); return; }
  if (!object(value)) fail('Commands must contain JSON values');
  for (const [key, child] of Object.entries(value as DocumentData)) {
    if (BAD_KEYS.has(key)) fail('Unsafe object key');
    validateJson(child, depth + 1);
  }
}

export function isValidIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1500
    && !value.includes('/') && value !== '.' && value !== '..' && !BAD_KEYS.has(value)
    && !/^__.*__$/.test(value) && getUtf8ByteLength(value) <= 1500;
}

export function validateCommand(input: unknown): DataCommand {
  validateJson(input);
  if (!object(input) || input.protocol !== 1 || !isValidIdentifier(input.operationId)
    || !isValidIdentifier(input.owner) || !object(input.resource)
    || !isValidIdentifier(input.resource.id) || !isValidIdentifier(input.resource.collection)
    || !(input.generation === null || isValidIdentifier(input.generation))
    || !Array.isArray(input.dependsOn) || input.dependsOn.length > 100
    || !input.dependsOn.every(isValidIdentifier) || input.dependsOn.includes(input.operationId)) {
    return fail('Invalid DataEngine command envelope');
  }
  const policy = getResourcePolicy(input.resource.collection);
  if (!policy.allowWrite) fail('The resource is read-only');
  const command = input as unknown as DataCommand;
  if (policy.ownerField === 'id' && command.resource.id !== command.owner) fail('Owner identity mismatch');
  validatePayload(command, policy);
  if (command.resource.collection === 'tags' && command.kind === 'create' && command.value.required !== false) {
    fail('Custom tags cannot be required');
  }
  if (command.resource.collection === 'tags' && command.kind === 'update'
    && command.changes.some(change => change.path[0] === 'required')) fail('Tag identity is immutable');
  if (command.kind === 'update' && command.changes.some(change => change.path[0] === 'createdAt'
    || (command.resource.collection === 'serviceOrders' && change.path[0] === 'catalogKey'))) fail('Creation identity is immutable');
  return command;
}

function validateCreate(command: Extract<DataCommand, { kind: 'create' }>, policy: ReturnType<typeof getResourcePolicy>): void {
    if (command.generation !== null || !object(command.value)) fail('Invalid create');
    for (const key of Object.keys(command.value)) {
      if (key === 'userId' && policy.ownerField === 'userId' && command.value[key] === command.owner) continue;
      if (!policy.writableFields.includes(key)) fail(`Field is not writable: ${key}`);
    }

}

function validateUpdate(command: Extract<DataCommand, { kind: 'update' }>, policy: ReturnType<typeof getResourcePolicy>): void {
    if (!Array.isArray(command.changes) || command.changes.length === 0 || command.changes.length > 1000) fail('Invalid changes');
    const paths: string[][] = [];
    for (const change of command.changes) {
      if (!object(change) || !Array.isArray(change.path) || change.path.length !== 1
        || !change.path.every(key => typeof key === 'string' && key.length > 0 && !BAD_KEYS.has(key))
        || !policy.writableFields.includes(change.path[0])
        || !validField(change.before) || !validField(change.after)) fail('Invalid field change');
      if (paths.some(path => prefix(path, change.path) || prefix(change.path, path))) fail('Overlapping field changes');
      paths.push(change.path);
    }

}

function validatePayload(command: DataCommand, policy: ReturnType<typeof getResourcePolicy>): void {
  switch (command.kind) {
    case 'create': validateCreate(command, policy); break;
    case 'update': validateUpdate(command, policy); break;
    case 'relation': validateRelation(command); break;
    case 'delete':
      if (!policy.allowDelete || !object(command.baseline)) fail('Invalid delete');
      break;
    default: fail('Unknown command kind');
  }
}

function validateRelation(command: Extract<DataCommand, { kind: 'relation' }>): void {
  const ids = (value: unknown) => Array.isArray(value) && value.length <= 100
    && value.every(isValidIdentifier) && new Set(value).size === value.length;
  const generation = (value: unknown) => value === null || isValidIdentifier(value);
  if (command.relation === 'material-notes') {
    if (command.resource.collection !== 'studyMaterials' || !ids(command.beforeNoteIds) || !ids(command.afterNoteIds)
      || !Array.isArray(command.targets) || command.targets.length > 100
      || command.targets.some(target => !object(target) || !isValidIdentifier(target.id) || !generation(target.generation))
      || new Set(command.targets.map(target => target.id)).size !== command.targets.length) fail('Invalid material membership');
    return;
  }
  if (command.relation === 'council-carry') {
    // Exactly two councils: the section leaves one and lands in the other. One edit would be an
    // ordinary change; three would be an operation nobody has described.
    if (command.resource.collection !== 'councils' || !Array.isArray(command.edits) || command.edits.length !== 2) fail('Invalid council carry');
    const named = new Set<string>();
    for (const edit of command.edits) {
      if (!object(edit) || !object(edit.resource) || edit.resource.collection !== 'councils'
        || !isValidIdentifier(edit.resource.id) || !generation(edit.generation)
        || named.has(edit.resource.id) || !Array.isArray(edit.beforeTopics) || !Array.isArray(edit.afterTopics)
        || !edit.beforeTopics.every(object) || !edit.afterTopics.every(object)) fail('Invalid council carry');
      named.add(edit.resource.id);
    }
    if (!equalValues(command.edits[0].resource, command.resource) || command.edits[0].generation !== command.generation) fail('Primary council identity mismatch');
    return;
  }
  if (command.relation !== 'series-membership' || command.resource.collection !== 'series'
    || !Array.isArray(command.edits) || command.edits.length < 1 || command.edits.length > MAX_RELATION_RESOURCES) fail('Invalid series membership');
  const seen = new Set<string>();
  for (const edit of command.edits) {
    if (!object(edit) || !object(edit.resource) || edit.resource.collection !== 'series'
      || !isValidIdentifier(edit.resource.id) || !generation(edit.generation)
      || seen.has(edit.resource.id) || !Array.isArray(edit.beforeItems) || !Array.isArray(edit.afterItems)
      || !edit.beforeItems.every(object) || !edit.afterItems.every(object)) fail('Invalid series membership');
    seen.add(edit.resource.id);
  }
  if (!equalValues(command.edits[0].resource, command.resource) || command.edits[0].generation !== command.generation) fail('Primary series identity mismatch');
}

function prefix(a: string[], b: string[]): boolean {
  return a.length <= b.length && a.every((key, i) => key === b[i]);
}

function validField(value: unknown): value is FieldValue {
  return object(value) && typeof value.exists === 'boolean'
    && (value.exists ? own(value, 'value') : !own(value, 'value'));
}

export function commandFingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(commandFingerprint).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${commandFingerprint(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}

export function equalValues(a: unknown, b: unknown): boolean {
  return commandFingerprint(a) === commandFingerprint(b);
}

export function readField(data: DocumentData, path: string[]): FieldValue {
  let current: Json = data;
  for (const key of path) {
    if (!object(current) || !own(current, key)) return { exists: false };
    current = current[key];
  }
  return { exists: true, value: current };
}

function putField(data: DocumentData, path: string[], field: FieldValue): void {
  const key = path[0];
  if (field.exists) data[key] = field.value as Json;
  else delete data[key];
}

export function diffFields(base: DocumentData, next: DocumentData): FieldChange[] {
  return [...new Set([...Object.keys(base), ...Object.keys(next)])]
    .filter(key => !equalValues(readField(base, [key]), readField(next, [key])))
    .map(key => ({ path: [key], before: readField(base, [key]), after: readField(next, [key]) }));
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function itemKey(value: Json): string | null {
  if (typeof value === 'string') return `string:${value}`;
  if (object(value) && typeof value.id === 'string') return `id:${value.id}`;
  return null;
}

function indexed(values: Json[]): Map<string, Json> | null {
  const map = new Map<string, Json>();
  for (const item of values) {
    const key = itemKey(item);
    if (key === null || map.has(key)) return null;
    map.set(key, item);
  }
  return map;
}

function mergedOrder(base: Map<string, Json>, mine: Map<string, Json>, theirs: Map<string, Json>, keys: string[], mineMoved: boolean): string[] | null {
  const surviving = new Set(keys);
  const preferred = [...(mineMoved ? mine.keys() : theirs.keys())].filter(key => surviving.has(key));
  for (const key of keys) if (!preferred.includes(key)) preferred.push(key);
  const edges = new Map(preferred.map(key => [key, new Set<string>()]));
  const constrain = (sequence: string[], insertionsOnly: boolean) => {
    const kept = sequence.filter(key => surviving.has(key));
    for (let i = 1; i < kept.length; i += 1) {
      if (!insertionsOnly || !base.has(kept[i - 1]) || !base.has(kept[i])) edges.get(kept[i - 1])!.add(kept[i]);
    }
  };
  constrain(preferred.filter(key => base.has(key)), false);
  constrain([...mine.keys()], true);
  constrain([...theirs.keys()], true);
  const pending = new Set(preferred), ordered: string[] = [];
  while (pending.size) {
    const next = preferred.find(key => pending.has(key) && ![...pending].some(other => edges.get(other)!.has(key)));
    if (next === undefined) return null;
    ordered.push(next);
    pending.delete(next);
  }
  return ordered;
}

/** Shared three-way merge: an untouched sibling always belongs to the remote copy. */
export function mergeFields(base: FieldValue, mine: FieldValue, theirs: FieldValue, path: string[] = []): {
  value: FieldValue; conflicts: ConflictDetail[];
} {
  if (equalValues(mine, base)) return { value: theirs, conflicts: [] };
  if (equalValues(theirs, base) || equalValues(mine, theirs)) return { value: mine, conflicts: [] };
  if (base.exists && mine.exists && theirs.exists) {
    if (object(base.value) && object(mine.value) && object(theirs.value)) {
      return mergeObjects(base.value, mine.value, theirs.value, path);
    }
    if (Array.isArray(base.value) && Array.isArray(mine.value) && Array.isArray(theirs.value)) {
      const merged = mergeArrays(base.value, mine.value, theirs.value, path);
      if (merged) return merged;
    }
  }
  return { value: mine, conflicts: [{ path, base, mine, theirs }] };
}

/** Legacy revisions are server-owned metadata, never an editor's authored intent. */
export function mergeDocumentFields(base: DocumentData | null, mine: DocumentData | null, theirs: DocumentData | null): ReturnType<typeof mergeFields> {
  const field = (value: DocumentData | null): FieldValue => value === null ? { exists: false }
    : { exists: true, value: Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'rev')) };
  const merged = mergeFields(field(base), field(mine), field(theirs));
  if (merged.value.exists && theirs && Object.prototype.hasOwnProperty.call(theirs, 'rev')) {
    (merged.value.value as DocumentData).rev = clone(theirs.rev);
  }
  return merged;
}

function mergeObjects(base: DocumentData, mine: DocumentData, theirs: DocumentData, path: string[]): ReturnType<typeof mergeFields> {
  const result: DocumentData = {}, conflicts: ConflictDetail[] = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
    const merged = mergeFields(readField(base, [key]), readField(mine, [key]), readField(theirs, [key]), [...path, key]);
    if (merged.value.exists) result[key] = merged.value.value as Json;
    conflicts.push(...merged.conflicts);
  }
  return { value: { exists: true, value: result }, conflicts };
}

function mergeArrays(base: Json[], mine: Json[], theirs: Json[], path: string[]): ReturnType<typeof mergeFields> | null {
  const b = indexed(base), m = indexed(mine), t = indexed(theirs);
  if (!b || !m || !t) return null;
  const retained = [...b.keys()].filter(key => m.has(key) && t.has(key));
  const mineOrder = [...m.keys()].filter(key => retained.includes(key));
  const theirOrder = [...t.keys()].filter(key => retained.includes(key));
  const mineMoved = !equalValues(mineOrder, retained), theirsMoved = !equalValues(theirOrder, retained);
  if (mineMoved && theirsMoved && !equalValues(mineOrder, theirOrder)) return null;
  const order = [...new Set([...(mineMoved ? m.keys() : t.keys()), ...m.keys(), ...t.keys()])];
  const result: Json[] = [], conflicts: ConflictDetail[] = [];
  const field = (map: Map<string, Json>, key: string): FieldValue => map.has(key)
    ? { exists: true, value: map.get(key) as Json } : { exists: false };
  for (const key of order) {
    const merged = mergeFields(field(b, key), field(m, key), field(t, key), [...path, key]);
    if (merged.value.exists) result.push(merged.value.value as Json);
    conflicts.push(...merged.conflicts);
  }
  const values = new Map(result.map(item => [itemKey(item)!, item]));
  const mergedKeys = mergedOrder(b, m, t, [...values.keys()], mineMoved);
  return mergedKeys ? { value: { exists: true, value: mergedKeys.map(key => values.get(key)!) }, conflicts } : null;
}

const sermonAggregate: Record<string, string> = {
  thoughts: 'thoughts', scratch: 'scratch', outline: 'outline', structure: 'thoughts',
  thoughtsBySection: 'thoughts', preparation: 'preparation', preachDates: 'preachDates',
  planText: 'plan', planMode: 'plan', draft: 'plan', plan: 'plan',
};

function bumpLegacy(value: DocumentData, collection: string, changed: readonly string[]): void {
  if (collection === 'users' || collection === 'tags') return;
  if (collection === 'councils') { value.rev = typeof value.rev === 'number' ? value.rev + 1 : 1; return; }
  const aggregate = (key: string): string => {
    if (collection === 'sermons') return sermonAggregate[key] ?? 'core';
    if (collection === 'planTemplates') return 'template';
    if (collection === 'serviceOrders') return key === 'steps' ? 'steps' : 'meta';
    if (collection === 'studyNotes') return 'note';
    if (collection === 'series') return ['items', 'sermonIds', 'seriesKind'].includes(key) ? 'items' : 'meta';
    if (collection === 'groups') return key === 'meetingDates' ? 'meetingDates' : 'content';
    if (collection === 'prayerRequests') {
      if (key === 'updates') return 'updates';
      return ['status', 'answerText', 'answeredAt'].includes(key) ? 'status' : 'core';
    }
    return 'content';
  };
  const revision: DocumentData = object(value.rev) ? { ...value.rev } : {};
  for (const name of new Set(changed.filter(key => key !== 'updatedAt' && key !== 'createdAt').map(aggregate))) {
    revision[name] = typeof revision[name] === 'number' ? revision[name] + 1 : 1;
  }
  value.rev = revision;
}

/** All transaction effects use this revision policy, including related documents. */
export function advanceResourceSnapshot(current: ResourceSnapshot, value: DocumentData | null, operationId: string, changedFields: readonly string[]): ResourceSnapshot {
  const next = value === null ? null : clone(value);
  if (next) bumpLegacy(next, current.resource.collection, changedFields);
  return {
    resource: { ...current.resource }, value: next,
    metadata: { protocol: 1, generation: current.metadata?.generation ?? operationId,
      revision: (current.metadata?.revision ?? 0) + 1, deleted: next === null, operationId },
  };
}

/** Mutates only the cloned candidate; a conflict prevents the entire candidate from committing. */
function applyExistingFields(command: Extract<DataCommand, { kind: 'update' | 'delete' }>, value: DocumentData): ConflictDetail[] {
  if (command.kind === 'delete') {
    const content = (data: DocumentData) => Object.fromEntries(Object.entries(data).filter(([key]) => !['rev', 'updatedAt', 'id', '_dataEngine'].includes(key)));
    return equalValues(content(command.baseline), content(value)) ? [] : [
      { path: [], base: { exists: true, value: command.baseline }, mine: { exists: false }, theirs: { exists: true, value } },
    ];
  }
  const conflicts: ConflictDetail[] = [];
  for (const change of command.changes) {
    const merged = mergeFields(change.before, change.after, readField(value, change.path), change.path);
    putField(value, change.path, merged.value);
    conflicts.push(...merged.conflicts);
  }
  return conflicts;
}

export function applyCommand(command: DataCommand, current: ResourceSnapshot): CommandResult {
  validateCommand(command);
  const refused = (code: string): CommandResult => ({ kind: 'refused', operationId: command.operationId, code });
  if (command.kind === 'relation') return refused('relation-requires-transaction');
  if (!equalValues(command.resource, current.resource)) return refused('resource-mismatch');
  if (current.metadata?.deleted) return { kind: 'deleted', operationId: command.operationId, snapshot: current };
  if (command.generation !== (current.metadata?.generation ?? null)) return refused('generation-mismatch');
  const policy = getResourcePolicy(command.resource.collection);
  if (current.value && (policy.ownerField === 'id' ? current.resource.id !== command.owner : current.value.userId !== command.owner)) {
    return refused('permission-denied');
  }
  let value: DocumentData;
  if (command.kind === 'create') {
    if (current.value) return refused('already-exists');
    value = clone(command.value);
    if (policy.ownerField === 'userId') value.userId = command.owner;
  } else {
    if (!current.value) return { kind: 'deleted', operationId: command.operationId, snapshot: current };
    value = clone(current.value);
    const conflicts = applyExistingFields(command, value);
    if (conflicts.length) return { kind: 'conflict', operationId: command.operationId, snapshot: current, conflicts };
  }
  if (!validCandidate(command, value)) return refused('invalid-document');
  return {
    kind: 'acknowledged', operationId: command.operationId,
    snapshot: advanceResourceSnapshot(current, command.kind === 'delete' ? null : value, command.operationId,
      command.kind === 'update' ? command.changes.map(change => change.path[0]) : Object.keys(value)),
  };
}

function validCandidate(command: Exclude<DataCommand, { kind: 'relation' }>, value: DocumentData): boolean {
  if (command.kind === 'delete') return true;
  try {
    validateResourceDocument(command.resource.collection, value, {
      kind: command.kind,
      changedFields: command.kind === 'update' ? command.changes.map(change => change.path[0]) : undefined,
    });
    return true;
  } catch { return false; }
}
