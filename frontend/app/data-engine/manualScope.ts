import { equalValues, getResourcePolicy, isValidIdentifier } from './protocol';
import { validateResourceDocument } from './resourceSchemas';

import type { SessionCheckpoint } from './session';
import type { DocumentData, FieldValue, Json, ResourceRef, ResourceSnapshot } from './types';

export type ManualPath = readonly (string | { id: string })[];
export interface ManualSavedIntent {
  id: string;
  owner: string;
  resource: ResourceRef;
  /** A planned value is never a confirmed snapshot. */
  value: DocumentData;
  predecessorId: string | null;
}
export interface ManualCapture {
  checkpoint: SessionCheckpoint;
  /** Only explicit provenance of the selected displayed fields belongs here. */
  provenance: readonly { path: ManualPath; requestId: string }[];
  requests: readonly ManualSavedIntent[];
}
export interface ManualScopeRecord {
  kind: 'manual';
  version: 1;
  owner: string;
  resource: ResourceRef;
  scopeId: string;
  selection: ManualPath[];
  /** The original complete confirmed snapshot, pinned even before the first edit. */
  baseline: ResourceSnapshot;
  predecessor: ManualSavedIntent | null;
  stage: FieldValue[];
  savedSelection: FieldValue[];
  generation: number;
  savedGeneration: number | null;
  active: boolean;
}
export interface ManualScopePort {
  capture(): ManualCapture;
  isCurrent(): boolean;
  isAcknowledged?(requestId: string): boolean;
  /** Dedicated manual records must not enter ordinary editor autosave/recovery. */
  persist(record: ManualScopeRecord): Promise<void>;
  save(scopeId: string, captured: SessionCheckpoint, options: { predecessorId?: string | null }): Promise<ManualSavedIntent>;
}
interface ScopeOptions {
  owner: string;
  resource: ResourceRef;
  scopeId: string;
  selection: readonly ManualPath[];
  port: ManualScopePort;
}
const OWNER_CHANGED = 'Manual form owner changed';
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sameResource = (a: ResourceRef | null | undefined, b: ResourceRef) => Boolean(a && a.collection === b.collection && a.id === b.id);
const samePath = (a: ManualPath, b: ManualPath) => equalValues(a, b);
const object = (value: unknown): value is DocumentData => value !== null && typeof value === 'object' && !Array.isArray(value);
const field = (value: unknown, exists: boolean): FieldValue => exists ? { exists: true, value: value as Json } : { exists: false };

/** A stage-only selection over a pinned ancestor. Delivery and merge stay in CommitQueue. */
export class ManualScope {
  private record: ManualScopeRecord;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private durable = false;
  private tail: { generation: number; stage: FieldValue[] } | null = null;
  private saves = new Map<number, Promise<{ delivery: 'queued'; requestId: string } | null>>();

  private constructor(private readonly options: ScopeOptions, record: ManualScopeRecord) { this.record = copy(record); }

  static begin(options: ScopeOptions, generation = 0): ManualScope {
    if (!Number.isSafeInteger(generation) || generation < 0) throw new Error('Invalid manual generation');
    validateOptions(options);
    if (!options.port.isCurrent()) throw new Error(OWNER_CHANGED);
    const scope = new ManualScope(options, captureRecord(options, generation));
    scope.persist();
    return scope;
  }

  /** Recovery is explicit and stays stage-only; restoring never submits a request. */
  static restore(options: ScopeOptions, record: ManualScopeRecord): ManualScope {
    validateOptions(options);
    if (record?.kind !== 'manual' || record.version !== 1 || record.owner !== options.owner || record.scopeId !== options.scopeId
      || !sameResource(record.resource, options.resource) || !sameResource(record.baseline?.resource, options.resource)
      || !equalValues(record.selection, options.selection) || !Array.isArray(record.stage) || record.stage.length !== options.selection.length
      || !Array.isArray(record.savedSelection) || record.savedSelection.length !== options.selection.length
      || !Number.isSafeInteger(record.generation) || record.generation < 0 || typeof record.active !== 'boolean'
      || (record.savedGeneration !== null && (!Number.isSafeInteger(record.savedGeneration) || record.savedGeneration < 0 || record.savedGeneration > record.generation || !record.predecessor))) throw new Error('Manual recovery identity mismatch');
    if (!options.port.isCurrent()) throw new Error(OWNER_CHANGED);
    if (record.predecessor !== null) {
      validateIntent(record.predecessor, options);
      const evidence = new Map(options.port.capture().requests.map(request => [request.id, request]));
      const existing = evidence.get(record.predecessor.id);
      if (existing && !equalValues(existing, record.predecessor)) throw new Error('Manual predecessor evidence changed');
      validateAncestry(record.predecessor, evidence, options);
    }
    if (!record.baseline.value || record.baseline.metadata?.deleted) throw new Error('Manual form requires a live confirmed document');
    validateDocument(record.baseline.value, options);
    for (const field of [...record.stage, ...record.savedSelection]) {
      if (!field || (field.exists !== true && field.exists !== false)) throw new Error('Invalid manual field value');
      if (field.exists) validateResourceDocument(options.resource.collection, { value: presentValue(field) }, { kind: 'update', changedFields: [] });
    }
    const ancestor = record.predecessor?.value ?? record.baseline.value;
    if (record.savedSelection.some((field, index) => !equalValues(field, readSelection(ancestor, record.selection[index])))) throw new Error('Manual saved selection does not match its ancestor');
    const scope = new ManualScope(options, record);
    scope.value(); // Validate selection structure before exposing recovered disk data.
    scope.durable = true;
    return scope;
  }

  getState() {
    this.assertCurrent();
    return { record: copy(this.record), value: this.value(), dirty: !equalValues(this.record.stage, this.record.savedSelection), durable: this.durable };
  }

  update(updater: (current: DocumentData) => DocumentData): Promise<void> {
    this.assertActive();
    const current = this.value();
    const next = copy(updater(copy(current)));
    const stage = this.record.selection.map(path => readSelection(next, path));
    const selectedOnly = project(current, this.record.selection, stage);
    if (!equalValues(next, selectedOnly)) throw new Error('Manual update changed an unselected field');
    this.record.stage = stage;
    this.record.generation += 1;
    return this.persist();
  }

  save(): Promise<{ delivery: 'queued'; requestId: string } | null> {
    this.assertActive();
    const captured = copy(this.record);
    const running = this.saves.get(captured.generation);
    if (running) return running;
    if (equalValues(captured.stage, this.tail?.stage ?? captured.savedSelection)) return this.settled().then(() => null);
    this.tail = { generation: captured.generation, stage: copy(captured.stage) };
    const saving = this.enqueue(async () => {
      if (this.record.savedGeneration === captured.generation && this.record.predecessor) {
        await this.write();
        return { delivery: 'queued' as const, requestId: this.record.predecessor.id };
      }
      // Earlier Saves may finish local persistence while this invocation waits.
      // Only its selected stage is frozen; the predecessor is the preceding durable Save.
      const predecessor = copy(this.record.predecessor);
      const value = project(predecessor?.value ?? captured.baseline.value!, captured.selection, captured.stage);
      const checkpoint: SessionCheckpoint = { confirmed: captured.baseline, draft: value, dirty: true, editGeneration: captured.generation,
        remoteCandidate: null, conflicts: [], pending: {} };
      const request = await this.options.port.save(captured.scopeId, checkpoint, { predecessorId: predecessor?.id ?? null });
      this.assertCurrent();
      validateIntent(request, this.options);
      if (!equalValues(request.value, value) || request.predecessorId !== (predecessor?.id ?? null)) throw new Error('Manual save identity mismatch');
      this.record.predecessor = copy(request);
      this.record.savedSelection = copy(captured.stage);
      this.record.savedGeneration = captured.generation;
      // Later typing remains a separate stage, while future Saves depend on this request.
      await this.write();
      return { delivery: 'queued' as const, requestId: request.id };
    });
    this.saves.set(captured.generation, saving);
    void saving.catch(() => {
      this.saves.delete(captured.generation);
      if (this.tail?.generation === captured.generation) this.tail = null;
    });
    return saving;
  }

  /** Cancel only this stage. A previously durable Save survives cancellation. */
  cancel(): Promise<void> {
    this.assertCurrent();
    this.record.generation += 1;
    this.record.active = false;
    this.durable = false;
    return this.enqueue(async () => {
      this.record.stage = copy(this.record.savedSelection);
      await this.write();
    });
  }

  /** A completed form can start a fresh pinned stage without resetting its save identity. */
  restart(): Promise<void> {
    this.assertCurrent();
    if (!equalValues(this.record.stage, this.record.savedSelection)) throw new Error('Resolve the unsaved manual stage before reopening');
    if (this.record.predecessor && !this.options.port.isAcknowledged?.(this.record.predecessor.id)) throw new Error('The previous manual Save is not acknowledged');
    this.record = captureRecord(this.options, this.record.generation + 1);
    this.tail = null;
    this.saves.clear();
    return this.persist();
  }

  /** Reopening a pending lineage resumes its planned value, never a fabricated confirmed one. */
  reopen(): Promise<void> { this.assertCurrent(); this.record.active = true; return this.persist(); }
  settled(): Promise<void> { return this.queue.then(() => { this.assertCurrent(); }); }
  retryPersistence(): Promise<void> { this.assertCurrent(); return this.persist(); }
  dispose(): void { this.closed = true; }

  private value(): DocumentData { return project(this.record.predecessor?.value ?? this.record.baseline.value!, this.record.selection, this.record.stage); }
  private persist(): Promise<void> { this.durable = false; return this.enqueue(() => this.write()); }
  private async write(): Promise<void> {
    this.assertCurrent();
    this.durable = false;
    const record = copy(this.record);
    await this.options.port.persist(record);
    this.assertCurrent();
    if (equalValues(record, this.record)) this.durable = true;
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(() => { this.assertCurrent(); return operation(); });
    this.queue = next;
    // The returned promise reports storage failure; callers can also await settled().
    void next.catch(() => { if (!this.closed && this.options.port.isCurrent()) this.durable = false; });
    return next;
  }
  private assertCurrent(): void { if (this.closed || !this.options.port.isCurrent()) throw new Error(OWNER_CHANGED); }
  private assertActive(): void { this.assertCurrent(); if (!this.record.active) throw new Error('Manual form is closed'); }
}

function validateOptions(options: ScopeOptions): void {
  if (!isValidIdentifier(options.owner) || !options.scopeId || !isValidIdentifier(options.resource.id) || !options.selection.length) throw new Error('Invalid manual form identity');
  for (const path of options.selection) {
    if (typeof path[0] !== 'string' || !getResourcePolicy(options.resource.collection).writableFields.includes(path[0])) throw new Error('Manual selection is read-only');
    if (!path.length || path.some(part => typeof part === 'string' ? !isValidIdentifier(part) : !part || !isValidIdentifier(part.id))) throw new Error('Invalid manual selection');
  }
  options.selection.forEach((path, index) => {
    if (options.selection.some((other, otherIndex) => index !== otherIndex && path.length <= other.length && samePath(path, other.slice(0, path.length)))) throw new Error('Overlapping manual selections');
  });
}
function validateIntent(intent: ManualSavedIntent, options: ScopeOptions): void {
  if (!intent || !isValidIdentifier(intent.id) || intent.owner !== options.owner || !sameResource(intent.resource, options.resource) || !object(intent.value)
    || (intent.predecessorId !== null && (!isValidIdentifier(intent.predecessorId) || intent.predecessorId === intent.id))) throw new Error('Manual predecessor identity mismatch');
  validateDocument(intent.value, options);
}
function selectPredecessor(options: ScopeOptions, captured: ManualCapture): ManualSavedIntent | null {
  const ids = new Set(captured.provenance.filter(item => options.selection.some(path => samePath(path, item.path))).map(item => item.requestId));
  if (!ids.size) return null;
  const records = new Map(captured.requests.map(request => [request.id, request]));
  for (const id of ids) { const request = records.get(id); if (!request) throw new Error('Missing manual predecessor evidence'); validateIntent(request, options); }
  const containsAll = (request: ManualSavedIntent) => {
    const found = validateAncestry(request, records, options);
    return [...ids].every(id => found.has(id));
  };
  const candidates = [...ids].map(id => records.get(id)!).filter(containsAll);
  if (candidates.length !== 1) throw new Error('Selected fields have incompatible saved predecessors');
  return copy(candidates[0]);
}
function readSelection(value: unknown, path: ManualPath): FieldValue {
  let current = value;
  for (const part of path) {
    if (typeof part === 'string') {
      if (!object(current) || !Object.prototype.hasOwnProperty.call(current, part)) return { exists: false };
      current = current[part];
    } else {
      if (!Array.isArray(current)) return { exists: false };
      const matches = current.filter(child => object(child) && child.id === part.id);
      if (matches.length > 1) throw new Error('Ambiguous child identity');
      if (!matches.length) return { exists: false };
      current = matches[0];
    }
  }
  return field(copy(current), true);
}
function project(base: DocumentData, paths: readonly ManualPath[], values: readonly FieldValue[]): DocumentData {
  const result = copy(base);
  paths.forEach((path, index) => writeSelection(result, path, values[index]));
  return result;
}
function writeSelection(parent: unknown, path: ManualPath, value: FieldValue): void {
  const [part, ...rest] = path;
  if (typeof part === 'string') writeObjectSelection(parent, part, rest, value);
  else writeChildSelection(parent, part.id, rest, value);
}
function writeObjectSelection(parent: unknown, part: string, rest: ManualPath, value: FieldValue): void {
  if (!object(parent)) throw new Error('Manual selection parent is not an object');
  if (rest.length) {
    if (!Object.prototype.hasOwnProperty.call(parent, part)) {
      if (!value.exists) return;
      parent[part] = typeof rest[0] === 'string' ? {} : [];
    }
    writeSelection(parent[part], rest, value);
  } else if (value.exists) parent[part] = copy(presentValue(value));
  else delete parent[part];
}
function writeChildSelection(parent: unknown, id: string, rest: ManualPath, value: FieldValue): void {
  if (!Array.isArray(parent)) throw new Error('Manual selection parent is not an array');
  const indices = parent.flatMap((child, index) => object(child) && child.id === id ? [index] : []);
  if (indices.length > 1) throw new Error('Ambiguous child identity');
  const index = indices[0] ?? -1;
  if (rest.length) {
    if (index < 0) throw new Error('Selected child no longer exists');
    writeSelection(parent[index], rest, value);
  } else if (!value.exists) {
    if (index >= 0) parent.splice(index, 1);
  } else {
    if (!object(value.value) || value.value.id !== id) throw new Error('Manual child identity changed');
    if (index < 0) parent.push(copy(value.value)); else parent[index] = copy(value.value);
  }
}
function presentValue(field: FieldValue): Json {
  if (field.value === undefined) throw new Error('Invalid manual field value');
  return field.value;
}

function validateDocument(value: DocumentData, options: ScopeOptions): void {
  const policy = getResourcePolicy(options.resource.collection);
  if (policy.ownerField === 'id' ? options.resource.id !== options.owner : value[policy.ownerField] !== options.owner) throw new Error('Manual document ownership mismatch');
  validateResourceDocument(options.resource.collection, value, { kind: 'update', changedFields: [] });
}

function validateAncestry(request: ManualSavedIntent, records: Map<string, ManualSavedIntent>, options: ScopeOptions): Set<string> {
  const found = new Set<string>();
  let current: ManualSavedIntent | undefined = request;
  while (current) {
    validateIntent(current, options);
    if (found.has(current.id)) throw new Error('Cyclic manual predecessor ancestry');
    found.add(current.id);
    current = current.predecessorId ? records.get(current.predecessorId) : undefined;
  }
  return found;
}

function captureRecord(options: ScopeOptions, generation: number): ManualScopeRecord {
    const captured = copy(options.port.capture());
    const baseline = captured.checkpoint.confirmed;
    if (!sameResource(baseline.resource, options.resource) || !baseline.value || baseline.metadata?.deleted) throw new Error('Manual form requires a live confirmed document');
    validateDocument(baseline.value, options);
    const predecessor = selectPredecessor(options, captured);
    const ancestor = predecessor?.value ?? baseline.value;
    const stage = options.selection.map(path => readSelection(captured.checkpoint.draft, path));
    if (stage.some((value, index) => !equalValues(value, readSelection(ancestor, options.selection[index])))) {
      throw new Error('An unsaved editor already owns a selected field');
    }
    return { kind: 'manual', version: 1, owner: options.owner, resource: copy(options.resource), scopeId: options.scopeId,
      selection: copy([...options.selection]), baseline, predecessor, stage, savedSelection: copy(stage), generation, savedGeneration: null, active: true };

}

/** Selection projection is shared with the parent editor; it never merges or sends. */
export function projectManualSelection(base: DocumentData, selected: DocumentData, paths: readonly ManualPath[]): DocumentData {
  return project(base, paths, paths.map(path => readSelection(selected, path)));
}
export function sameManualSelection(a: DocumentData | null, b: DocumentData | null, path: ManualPath): boolean {
  return equalValues(readSelection(a, path), readSelection(b, path));
}
