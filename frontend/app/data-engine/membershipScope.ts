import { boundedActionTime, type ActionTime } from './actionClock';
import { prepareDomainCommand } from './domainPolicy';
import { retireLocalWrite, type LocalWriteHandoff } from './localWriteback';
import { captureSeriesMembership, projectMembershipAction, type MembershipAction, type MembershipRef } from './membershipIntent';
import { equalValues, isValidIdentifier } from './protocol';
import { validateResourceDocument } from './resourceSchemas';

import type { AtomicCapture } from './commits';
import type { ManualSavedIntent } from './manualScope';
import type { SeriesHistorySelection } from './seriesMembershipHistory';
import type { DocumentData, ResourceRef, ResourceSnapshot } from './types';

export const CREATION_SCOPE_PREFIX = 'creation:';
export interface MembershipCreation { resource: ResourceRef; value: DocumentData; seriesOpened: boolean; requestedSeriesId?: string }

export interface MembershipPin {
  baseline: ResourceSnapshot;
  /** Explicit saved provenance, including a creation not yet acknowledged. */
  predecessor: ManualSavedIntent | null;
  predecessorRemovals?: MembershipRef[];
}
export interface MembershipScopeRecord {
  kind: 'membership'; version: 1; owner: string; scopeId: string; revision: number;
  pins: MembershipPin[];
  action: MembershipAction | null;
  generation: number;
  phase: 'editing' | 'saving' | 'submitted' | 'cancelled';
  requestIds: string[];
  seriesMembershipTime?: ActionTime | null;
  seriesCatalogVersion?: number;
  creation?: MembershipCreation;
}
export interface MembershipSaveReceipt { revision: number; requestIds: string[]; seriesMembershipTime?: ActionTime | null }

export interface MembershipScopePort {
  isCurrent(): boolean;
  /** Returns the durable CAS revision. Creation uses expectedRevision=null. */
  persist(record: MembershipScopeRecord, expectedRevision: number | null): Promise<MembershipScopeRecord>;
  /** Undefined means already frozen; null means the original editing revision cannot be proved. */
  readSaveReceipt(record: MembershipScopeRecord, editingRevision?: number | null): Promise<MembershipSaveReceipt | null>;
  /** Uses CommitQueue, which deduplicates the captured scope/resource/generation. */
  save(captures: readonly AtomicCapture[]): Promise<readonly { id: string }[]>;
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const ancestor = (pin: MembershipPin): DocumentData => (pin.predecessor?.value ?? pin.baseline.value)!;
const OWNER_CHANGED = 'Membership action owner changed';

export function validateMembershipScope(record: MembershipScopeRecord): void {
  if (record?.kind !== 'membership' || record.version !== 1 || !isValidIdentifier(record.owner) || !record.scopeId
    || !Number.isSafeInteger(record.revision) || record.revision < 0 || !Number.isSafeInteger(record.generation) || record.generation < 0
    || !['editing', 'saving', 'submitted', 'cancelled'].includes(record.phase) || !Array.isArray(record.pins)
    || new Set(record.pins.map(pin => pin.baseline?.resource.id)).size !== record.pins.length
    || !Array.isArray(record.requestIds) || record.requestIds.some(id => !isValidIdentifier(id)) || new Set(record.requestIds).size !== record.requestIds.length
    || (record.seriesCatalogVersion !== undefined && (record.creation || !Number.isSafeInteger(record.seriesCatalogVersion) || record.seriesCatalogVersion < 0))
    || (record.seriesMembershipTime !== undefined && ((record.seriesMembershipTime !== null && !boundedActionTime(record.seriesMembershipTime))
      || !['saving', 'submitted'].includes(record.phase) || record.creation
      || (record.action?.kind !== 'assign' && record.action?.kind !== 'remove')))
    || (record.phase !== 'submitted' && record.requestIds.length > 0)) throw new Error('Invalid membership scope');
  for (const pin of record.pins) validatePin(pin, record.owner);
  validateCreation(record);
  projectMembershipAction(new Map(record.pins.map(pin => [pin.baseline.resource.id, ancestor(pin)])), record.action);
}
function validateCreation(record: MembershipScopeRecord): void {
  const creation = record.creation;
  if (!creation) {
    if (record.scopeId.startsWith(CREATION_SCOPE_PREFIX)) throw new Error('Creation scope requires its draft');
    return;
  }
  if (!record.scopeId.startsWith(CREATION_SCOPE_PREFIX) || !creation.resource || !['sermons', 'groups'].includes(creation.resource.collection)
    || (creation.requestedSeriesId !== undefined && (!isValidIdentifier(creation.requestedSeriesId) || creation.seriesOpened || ['saving', 'submitted'].includes(record.phase)))
    || typeof creation.seriesOpened !== 'boolean' || creation.value?.userId !== record.owner
    || (!creation.seriesOpened && (record.pins.length || record.action))) throw new Error('Invalid creation stage');
  // Input may be incomplete while typing; full resource validation belongs to Save.
  prepareDomainCommand(record.owner, 'validate-creation-draft', { resource: creation.resource, value: null, metadata: null }, creation.value);
  if (record.action && (record.action.kind !== 'assign' || record.action.refs.length !== 1
    || record.action.refs[0].refId !== creation.resource.id
    || record.action.refs[0].type !== (creation.resource.collection === 'sermons' ? 'sermon' : 'group'))) throw new Error('Creation may assign only its own member');
}
function validatePin(pin: MembershipPin, owner: string): void {
  const { baseline, predecessor } = pin;
  if (!baseline || baseline.resource.collection !== 'series' || !isValidIdentifier(baseline.resource.id) || baseline.metadata?.deleted
    || (!baseline.value && (!predecessor || baseline.metadata))) throw new Error('Membership requires a live series or its saved creation');
  if (baseline.value) validateDocument(baseline.value, owner);
  if (pin.predecessorRemovals && (!predecessor || !Array.isArray(pin.predecessorRemovals)
    || pin.predecessorRemovals.some(ref => (ref.type !== 'sermon' && ref.type !== 'group') || !isValidIdentifier(ref.refId)))) {
    throw new Error('Invalid membership predecessor removals');
  }
  if (predecessor) {
    if (!isValidIdentifier(predecessor.id) || predecessor.owner !== owner || !equalValues(predecessor.resource, baseline.resource)
      || (predecessor.predecessorId !== null && (!isValidIdentifier(predecessor.predecessorId) || predecessor.predecessorId === predecessor.id))) throw new Error('Invalid membership predecessor');
    validateDocument(predecessor.value, owner);
  }
}
function validateDocument(value: DocumentData, owner: string): void {
  if (!value || value.userId !== owner) throw new Error('Membership series belongs to another owner');
  validateResourceDocument('series', value, { kind: 'update', changedFields: [] });
}

/** One stage, one explicit Save. Stage persistence cannot dispatch any network operation. */
export class MembershipScope {
  private record: MembershipScopeRecord;
  private revision: number | null;
  private queue: Promise<unknown> = Promise.resolve();
  private saving: Promise<string[]> | null = null;
  private durable = false;
  // Later capture or submission can fail without undoing the durable freeze.
  private frozen: boolean;
  private saveFromRevision: number | null = null;
  private closed = false;
  private readonly listeners = new Set<() => void>();
  private constructor(record: MembershipScopeRecord, private readonly port: MembershipScopePort, restored: boolean) {
    validateMembershipScope(record); this.record = clone(record); this.revision = restored ? record.revision : null; this.durable = restored;
    this.frozen = restored && (record.phase === 'saving' || record.phase === 'submitted');
  }
  static begin(owner: string, scopeId: string, pins: readonly MembershipPin[], port: MembershipScopePort, seriesCatalogVersion?: number): MembershipScope {
    const scope = new MembershipScope({ kind: 'membership', version: 1, owner, scopeId, pins: clone([...pins]), revision: 0,
      action: null, generation: 0, phase: 'editing', requestIds: [], ...(seriesCatalogVersion !== undefined && { seriesCatalogVersion }) }, port, false);
    scope.assertCurrent(); void scope.enqueue(() => scope.write()).catch(() => undefined); return scope;
  }
  static restore(record: MembershipScopeRecord, port: MembershipScopePort): MembershipScope {
    const scope = new MembershipScope(record, port, true); scope.assertCurrent(); return scope;
  }
  static beginCreation(owner: string, scopeId: string, resource: ResourceRef, value: DocumentData, port: MembershipScopePort, requestedSeriesId?: string): MembershipScope {
    const scope = new MembershipScope({ kind: 'membership', version: 1, owner, scopeId, revision: 0, pins: [], action: null,
      generation: 0, phase: 'editing', requestIds: [], creation: { resource, value, seriesOpened: false, ...(requestedSeriesId ? { requestedSeriesId } : {}) } }, port, false);
    scope.assertCurrent(); void scope.enqueue(() => scope.write()).catch(() => undefined); return scope;
  }
  getState() {
    this.assertCurrent();
    const generations = new Map(this.record.pins.map(pin => [pin.baseline.resource.id, pin.baseline.metadata?.generation ?? null]));
    return { record: clone(this.record), durable: this.durable,
      values: clone([...projectMembershipAction(this.values(), this.record.action)].map(([id, value]) => ({ id, value, generation: generations.get(id) ?? null }))) };
  }
  restoreAssignment(member: MembershipRef, selection: SeriesHistorySelection | null): Promise<void> {
    this.assertEditing();
    if (selection) {
      const target = this.record.pins.find(pin => pin.baseline.resource.id === selection.id);
      if (!target || (target.baseline.metadata?.generation ?? null) !== selection.generation) {
        throw Object.assign(new Error('The series is unavailable in this form'), { code: 'referenced-document-deleted' });
      }
    }
    return this.update(selection ? { kind: 'assign', targetId: selection.id, refs: [member] } : { kind: 'remove', refs: [member] });
  }
  subscribe(listener: () => void): () => void { this.assertCurrent(); this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  update(action: MembershipAction | null): Promise<void> {
    this.assertEditing();
    const next = { ...this.record, action: clone(action), ...(this.record.creation ? { creation: { ...this.record.creation } } : {}) };
    // Explicit selection (including "No series") resolves a preset; typing never does.
    if (next.creation) delete next.creation.requestedSeriesId;
    validateCreation(next);
    projectMembershipAction(this.values(), action);
    this.record = next; this.record.generation += 1; this.durable = false; this.emit();
    return this.enqueuePersistence();
  }
  updateCreation(value: DocumentData): Promise<void> {
    this.assertEditing();
    if (!this.record.creation) throw new Error('Open a creation stage first');
    if (this.durable && equalValues(this.record.creation.value, value)) return this.settled();
    const next = { ...this.record, creation: { ...this.record.creation, value: clone(value) } };
    validateCreation(next); this.record = next;
    this.record.generation += 1; this.durable = false; this.emit(); return this.enqueuePersistence();
  }
  pinCreationSeries(pins: readonly MembershipPin[]): Promise<void> {
    this.assertEditing();
    if (!this.record.creation) throw new Error('Open a creation stage first');
    if (this.record.creation.seriesOpened) return this.settled();
    const creation = { ...this.record.creation, seriesOpened: true };
    const targetId = creation.requestedSeriesId;
    delete creation.requestedSeriesId;
    const action: MembershipAction | null = targetId ? { kind: 'assign', targetId,
      refs: [{ type: creation.resource.collection === 'sermons' ? 'sermon' : 'group', refId: creation.resource.id }] } : this.record.action;
    const next = { ...this.record, action, pins: clone([...pins]), creation };
    // Missing preset targets leave the stage untouched, so recovery cannot silently unlink it.
    validateMembershipScope(next); this.record = next;
    this.record.generation += 1; this.durable = false; this.emit(); return this.enqueuePersistence();
  }
  save(time?: ActionTime | null): Promise<string[]> {
    this.assertCurrent();
    if (this.saving) return this.saving;
    if (this.record.phase === 'submitted') return this.enqueue(() => this.finishSave(async () => {
      if (!this.durable) await this.write();
    }));
    if (this.record.phase === 'cancelled') throw new Error('Membership action was cancelled');
    if (this.record.creation?.requestedSeriesId) throw new Error('Resolve the requested series before saving');
    if (this.record.creation) validateResourceDocument(this.record.creation.resource.collection, this.record.creation.value, { kind: 'create' });
    // Only a local copy that matched its last durable editing row can use that row as proof.
    if (this.record.phase === 'editing') {
      this.saveFromRevision = this.durable ? this.revision : null;
      if (time !== undefined && !this.record.creation && (this.record.action?.kind === 'assign' || this.record.action?.kind === 'remove')) {
        this.record.seriesMembershipTime = boundedActionTime(time) ?? null;
      }
    }
    // Freeze before any await. No later selection can change an uncertain capture.
    this.record.phase = 'saving'; this.durable = false; this.emit();
    const result = this.enqueue(() => this.finishSave(async () => {
      // A restored Save was already frozen by the original window. Rewriting its
      // saving row would only advance the CAS revision before the same capture.
      if (!this.frozen) await this.write();
      const captures = this.captures();
      const requests = captures.length ? await this.port.save(captures) : [];
      this.assertCurrent();
      if (requests.length !== captures.length || new Set(requests.map(request => request.id)).size !== requests.length) throw new Error('Incomplete membership capture');
      this.record.phase = 'submitted'; this.record.requestIds = requests.map(request => request.id);
      await this.write();
    }));
    this.saving = result;
    void result.finally(() => { this.saving = null; }).catch(() => undefined);
    return result;
  }
  cancel(): Promise<void> {
    this.assertEditing(); this.record.phase = 'cancelled'; this.record.action = null; this.durable = false; this.emit();
    return this.enqueuePersistence();
  }
  retryPersistence(): Promise<void> { this.assertCurrent(); return this.enqueuePersistence(); }
  settled(): Promise<void> { return this.queue.then(() => { this.assertCurrent(); }); }
  dispose(): void { this.closed = true; this.listeners.clear(); }
  retire(): LocalWriteHandoff {
    return retireLocalWrite({ owner: this.record.owner, kind: 'membership', id: this.record.scopeId,
      ...(this.record.creation ? { resource: this.record.creation.resource } : {}) }, this.queue,
      () => this.dispose(), () => this.durable, () => this.writeLocal());
  }
  private values() { return new Map(this.record.pins.map(pin => [pin.baseline.resource.id, ancestor(pin)])); }
  private captures(): AtomicCapture[] {
    const next = projectMembershipAction(this.values(), this.record.action);
    const changed = this.record.pins.some(pin => !equalValues(ancestor(pin), next.get(pin.baseline.resource.id)));
    if (!changed && !this.record.creation) return [];
    const membership = this.record.pins.flatMap(pin => {
      const id = pin.baseline.resource.id, draft = next.get(id)!;
      const opening = ancestor(pin), time = this.record.seriesMembershipTime;
      // Even an already-satisfied target must participate: deleting it remotely
      // cannot allow the action to remove the last surviving source membership.
      const assignment = this.record.action?.kind === 'assign' ? this.record.action : undefined;
      const target = assignment?.targetId === id;
      // A Clear can make the source invisible in the new picker. Its own exact
      // queued receipt still belongs to the following assignment's ancestry.
      const clearWitness = time !== undefined && assignment && pin.predecessorRemovals?.some(removed =>
        assignment.refs.some(ref => ref.type === removed.type && ref.refId === removed.refId));
      if (!target && !clearWitness && equalValues(opening, draft)) return [];
      return [{ editorId: JSON.stringify([this.record.scopeId, 'membership', id]), predecessorId: pin.predecessor?.id ?? null, retentionScope: this.record.scopeId,
        ...(time !== undefined ? { seriesMembership: captureSeriesMembership(opening, draft, time, pin.baseline.metadata?.revision ?? 0, this.record.seriesCatalogVersion) } : {}),
        captured: { confirmed: clone(pin.baseline), draft: clone(draft), dirty: true, editGeneration: this.record.generation,
          conflicts: [], remoteCandidate: null, pending: {} } }];
    });
    if (!this.record.creation) return membership;
    const { resource, value } = this.record.creation;
    return [{ editorId: JSON.stringify([this.record.scopeId, 'create', resource]), predecessorId: null, retentionScope: this.record.scopeId,
      captured: { confirmed: { resource: clone(resource), value: null, metadata: null }, draft: clone(value), dirty: true,
        editGeneration: this.record.generation, conflicts: [], remoteCandidate: null, pending: {} } }, ...membership];
  }
  private async finishSave(write: () => Promise<void>): Promise<string[]> {
    try { await write(); }
    catch (error) {
      this.assertCurrent();
      const receipt = await this.port.readSaveReceipt(this.record, this.frozen ? undefined : this.saveFromRevision).catch(() => null);
      this.assertCurrent();
      if (!receipt) throw error;
      this.revision = receipt.revision; this.frozen = true;
      const { seriesMembershipTime: _discardedTime, ...record } = this.record;
      this.record = { ...record, ...receipt, phase: 'submitted' };
      this.durable = true;
      this.emit();
    }
    return [...this.record.requestIds];
  }
  private async write(): Promise<void> {
    this.assertCurrent();
    await this.writeLocal();
    this.assertCurrent();
  }
  private async writeLocal(): Promise<void> {
    this.durable = false;
    const submitted = clone(this.record);
    const stored = await this.port.persist(submitted, this.revision);
    this.revision = stored.revision; this.record.revision = stored.revision;
    if (stored.phase === 'saving' || stored.phase === 'submitted') {
      this.frozen = true;
      if (stored.seriesMembershipTime !== undefined) this.record.seriesMembershipTime = stored.seriesMembershipTime;
      else delete this.record.seriesMembershipTime;
    }
    if (equalValues(stored, this.record)) this.durable = true;
    this.emit();
  }
  private enqueuePersistence(): Promise<void> {
    const result = this.queue.catch(() => undefined).then(() => this.writeLocal());
    this.queue = result;
    void result.catch(() => { this.durable = false; this.emit(); });
    return result.then(() => { this.assertCurrent(); });
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => undefined).then(() => { this.assertCurrent(); return action(); });
    this.queue = result; void result.catch(() => { this.durable = false; this.emit(); }); return result;
  }
  private emit(): void {
    if (this.closed || !this.port.isCurrent()) return;
    for (const listener of this.listeners) { try { listener(); } catch { /* Rendering cannot change saved intent. */ } }
  }
  private assertCurrent(): void { if (this.closed || !this.port.isCurrent()) throw new Error(OWNER_CHANGED); }
  private assertEditing(): void { this.assertCurrent(); if (this.record.phase !== 'editing') throw new Error('Membership selection is frozen after Save'); }
}
