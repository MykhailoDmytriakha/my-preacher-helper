import { projectMembershipAction, type MembershipAction } from './membershipIntent';
import { equalValues, isValidIdentifier, MAX_RELATION_RESOURCES } from './protocol';
import { validateResourceDocument } from './resourceSchemas';

import type { AtomicCapture } from './commits';
import type { ManualSavedIntent } from './manualScope';
import type { DocumentData, ResourceSnapshot } from './types';

export interface MembershipPin {
  baseline: ResourceSnapshot;
  /** Explicit saved provenance, including a creation not yet acknowledged. */
  predecessor: ManualSavedIntent | null;
}
export interface MembershipScopeRecord {
  kind: 'membership'; version: 1; owner: string; scopeId: string; revision: number;
  pins: MembershipPin[];
  action: MembershipAction | null;
  generation: number;
  phase: 'editing' | 'saving' | 'submitted' | 'cancelled';
  requestIds: string[];
}
export interface MembershipScopePort {
  isCurrent(): boolean;
  /** Returns the durable CAS revision. Creation uses expectedRevision=null. */
  persist(record: MembershipScopeRecord, expectedRevision: number | null): Promise<MembershipScopeRecord>;
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
    || record.pins.length > MAX_RELATION_RESOURCES || new Set(record.pins.map(pin => pin.baseline?.resource.id)).size !== record.pins.length
    || !Array.isArray(record.requestIds) || record.requestIds.some(id => !isValidIdentifier(id)) || new Set(record.requestIds).size !== record.requestIds.length
    || (record.phase !== 'submitted' && record.requestIds.length > 0)) throw new Error('Invalid membership scope');
  for (const pin of record.pins) validatePin(pin, record.owner);
  projectMembershipAction(new Map(record.pins.map(pin => [pin.baseline.resource.id, ancestor(pin)])), record.action);
}
function validatePin(pin: MembershipPin, owner: string): void {
  const { baseline, predecessor } = pin;
  if (!baseline || baseline.resource.collection !== 'series' || !isValidIdentifier(baseline.resource.id) || baseline.metadata?.deleted
    || (!baseline.value && (!predecessor || baseline.metadata))) throw new Error('Membership requires a live series or its saved creation');
  if (baseline.value) validateDocument(baseline.value, owner);
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
  private closed = false;
  private readonly listeners = new Set<() => void>();
  private constructor(record: MembershipScopeRecord, private readonly port: MembershipScopePort, restored: boolean) {
    validateMembershipScope(record); this.record = clone(record); this.revision = restored ? record.revision : null; this.durable = restored;
  }
  static begin(owner: string, scopeId: string, pins: readonly MembershipPin[], port: MembershipScopePort): MembershipScope {
    const scope = new MembershipScope({ kind: 'membership', version: 1, owner, scopeId, pins: clone([...pins]), revision: 0,
      action: null, generation: 0, phase: 'editing', requestIds: [] }, port, false);
    scope.assertCurrent(); void scope.enqueue(() => scope.write()).catch(() => undefined); return scope;
  }
  static restore(record: MembershipScopeRecord, port: MembershipScopePort): MembershipScope {
    const scope = new MembershipScope(record, port, true); scope.assertCurrent(); return scope;
  }
  getState() {
    this.assertCurrent();
    return { record: clone(this.record), durable: this.durable,
      values: clone([...projectMembershipAction(this.values(), this.record.action)].map(([id, value]) => ({ id, value }))) };
  }
  subscribe(listener: () => void): () => void { this.assertCurrent(); this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  update(action: MembershipAction | null): Promise<void> {
    this.assertEditing();
    projectMembershipAction(this.values(), action);
    this.record.action = clone(action); this.record.generation += 1; this.durable = false; this.emit();
    return this.enqueue(() => this.write());
  }
  save(): Promise<string[]> {
    this.assertCurrent();
    if (this.saving) return this.saving;
    if (this.record.phase === 'submitted') return this.enqueue(async () => { if (!this.durable) await this.write(); return [...this.record.requestIds]; });
    if (this.record.phase === 'cancelled') throw new Error('Membership action was cancelled');
    // Freeze before any await. No later selection can change an uncertain capture.
    this.record.phase = 'saving'; this.durable = false; this.emit();
    const result = this.enqueue(async () => {
      await this.write();
      const captures = this.captures();
      const requests = captures.length ? await this.port.save(captures) : [];
      this.assertCurrent();
      if (requests.length !== captures.length || new Set(requests.map(request => request.id)).size !== requests.length) throw new Error('Incomplete membership capture');
      this.record.phase = 'submitted'; this.record.requestIds = requests.map(request => request.id);
      await this.write(); return [...this.record.requestIds];
    });
    this.saving = result;
    void result.finally(() => { this.saving = null; }).catch(() => undefined);
    return result;
  }
  cancel(): Promise<void> {
    this.assertEditing(); this.record.phase = 'cancelled'; this.record.action = null; this.durable = false; this.emit();
    return this.enqueue(() => this.write());
  }
  retryPersistence(): Promise<void> { this.assertCurrent(); return this.enqueue(() => this.write()); }
  settled(): Promise<void> { return this.queue.then(() => { this.assertCurrent(); }); }
  dispose(): void { this.closed = true; this.listeners.clear(); }
  private values() { return new Map(this.record.pins.map(pin => [pin.baseline.resource.id, ancestor(pin)])); }
  private captures(): AtomicCapture[] {
    const next = projectMembershipAction(this.values(), this.record.action);
    const changed = this.record.pins.some(pin => !equalValues(ancestor(pin), next.get(pin.baseline.resource.id)));
    if (!changed) return [];
    return this.record.pins.flatMap(pin => {
      const id = pin.baseline.resource.id, draft = next.get(id)!;
      // Even an already-satisfied target must participate: deleting it remotely
      // cannot allow the action to remove the last surviving source membership.
      const target = this.record.action?.kind === 'assign' && this.record.action.targetId === id;
      if (!target && equalValues(ancestor(pin), draft)) return [];
      return [{ editorId: JSON.stringify([this.record.scopeId, 'membership', id]), predecessorId: pin.predecessor?.id ?? null, retentionScope: this.record.scopeId,
        captured: { confirmed: clone(pin.baseline), draft: clone(draft), dirty: true, editGeneration: this.record.generation,
          conflicts: [], remoteCandidate: null, pending: {} } }];
    });
  }
  private async write(): Promise<void> {
    this.assertCurrent(); this.durable = false;
    const submitted = clone(this.record);
    const stored = await this.port.persist(submitted, this.revision);
    this.assertCurrent(); this.revision = stored.revision; this.record.revision = stored.revision;
    if (equalValues({ ...submitted, revision: stored.revision }, this.record)) this.durable = true;
    this.emit();
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
