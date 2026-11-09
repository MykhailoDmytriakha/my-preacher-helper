import { deriveSeriesItemsFromSermonIds, deriveSermonIdsFromItems, inferSeriesKind, normalizeSeriesItems } from '@/utils/seriesItems';
import { isServiceOrderCatalogKey } from '@/utils/serviceOrderSeedIdentity';
import { isStructureTag } from '@/utils/structureTags';
import { sameStudyAnalysisPassage, studyAnalysisPassageIdentity } from '@/utils/studyAnalysisSource';
import { isStudyNoteDraft } from '@/utils/studyNoteDraft';

import { ANALYSIS_RESHAPE_FRAME, sameAnalysisFrame } from './analysisReshapeFields';
import { validCouncilCarry } from './councilCarryContent';
import { materialNoteIds, seriesMemberResources, sermonSourceReferences } from './documentReferences';
import { childIdentityIssues } from './legacyChildIdentity';
import { advanceResourceSnapshot, applyCommand, equalValues, mergeFields, readField, MAX_RELATION_RESOURCES } from './protocol';
import { relationMirrorFields } from './relationMirrors';
import { validateResourceDocument } from './resourceSchemas';
import { memberResource, membershipKey, mergeOrderedSeriesItems, readSeriesMembershipMoves, reconcileDeletedSeriesMembership, resolveSeriesMembership, seriesLocation, type MembershipLocation, type SeriesMembershipMove, type SeriesMembershipPlacement, type SeriesMembershipWrite } from './seriesMembershipOrder.server';
import { planServiceOrderPlacement, type ServiceOrderPlacementWrite } from './serviceOrderPlacement.server';
import { planShareCapability, type ShareCapabilityCommand } from './shareCapabilities.server';

import type { SeriesMembershipComparison } from './seriesMembershipHistory';
import type { CommandResult, ConflictDetail, DataCommand, DocumentData, Json, ResourceRef, ResourceSnapshot } from './types';
import type { SeriesItem } from '@/models/models';

export { MAX_RELATION_RESOURCES } from './protocol';
export interface RelationFilter { field: 'materialIds' | 'seriesId' | 'noteId' | 'catalogKey' | 'type'; operator: '==' | 'array-contains'; value: string }
export interface RelationReader {
  serviceOrderPlacement?: { rawMetadata: unknown; serverMs: number | undefined };
  seriesMembershipOrder?: {
    serverMs: number;
    catalogVersion(): Promise<number>;
    read(member: ResourceRef): Promise<unknown>;
    readDeletion(location: MembershipLocation): Promise<number | undefined>;
  };
  get(resource: ResourceRef): Promise<ResourceSnapshot>;
  /** Implementations always add authenticated owner scope; callers cannot choose it. */
  list(collection: string, limit: number, filter?: RelationFilter, select?: (snapshot: ResourceSnapshot) => boolean): Promise<ResourceSnapshot[]>;
}
export interface CommandPlan { result: CommandResult; writes: ResourceSnapshot[]; seriesMembershipWrites?: SeriesMembershipWrite[]; serviceOrderPlacement?: ServiceOrderPlacementWrite }

class RelationRefusal extends Error {
  constructor(readonly code: string) { super(code); }
}
const fail = (code: string): never => { throw new RelationRefusal(code); };
const INVALID_DOCUMENT = 'invalid-document';
const PERMISSION_DENIED = 'permission-denied';
const RELATION_REQUIRED = 'relation-command-required';
const key = (resource: ResourceRef) => JSON.stringify([resource.collection, resource.id]);
const ownObject = (value: unknown): value is DocumentData => value !== null && typeof value === 'object' && !Array.isArray(value);
function ids(value: Json | undefined): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item)) return fail(INVALID_DOCUMENT);
  return [...new Set(value as string[])];
}

function currentItems(value: DocumentData): DocumentData[] {
  if (value.items === undefined || (Array.isArray(value.items) && value.items.length === 0 && ids(value.sermonIds).length > 0)) {
    return deriveSeriesItemsFromSermonIds(ids(value.sermonIds)) as unknown as DocumentData[];
  }
  if (!Array.isArray(value.items)) return fail(INVALID_DOCUMENT);
  validateResourceDocument('series', { items: value.items }, { kind: 'update', changedFields: ['items'] });
  return value.items as DocumentData[];
}

/**
 * Which sections claim to have been carried, and where.
 *
 * Only sections that actually carry the mark count. Comparing the whole array instead made
 * adding or removing a section look like a claim about another council, which refused ordinary
 * editing: the screen adds an empty section and the person names it afterwards.
 */
function carryMarks(side: { exists: boolean; value?: Json } | undefined): string {
  const topics = side?.exists && Array.isArray(side.value) ? side.value : [];
  const marks = topics.flatMap(topic => ownObject(topic) && typeof topic.id === 'string' && typeof topic.carriedToCouncilId === 'string'
    ? [[topic.id, topic.carriedToCouncilId]] : []);
  return JSON.stringify(marks.sort((left, right) => left[0].localeCompare(right[0])));
}

function currentTopics(value: DocumentData): DocumentData[] {
  if (value.topics === undefined) return [];
  if (!Array.isArray(value.topics)) return fail(INVALID_DOCUMENT);
  validateResourceDocument('councils', { topics: value.topics }, { kind: 'update', changedFields: ['topics'], previous: value });
  // Carry addresses a topic, while its copy receives fresh question/option IDs.
  // Existing nested duplicates may remain; an ambiguous topic address may not.
  if (childIdentityIssues(value.topics).length) return fail(INVALID_DOCUMENT);
  return value.topics as DocumentData[];
}

function seriesFields(items: DocumentData[]): DocumentData {
  validateResourceDocument('series', { items }, { kind: 'update', changedFields: ['items'] });
  const identities = items.map(item => `${item.type}:${item.refId}`);
  if (new Set(identities).size !== identities.length) return fail('duplicate-membership');
  const normalized = normalizeSeriesItems(items as unknown as SeriesItem[]);
  return { items: normalized as unknown as Json[], sermonIds: deriveSermonIdsFromItems(normalized), seriesKind: inferSeriesKind(normalized) };
}

function materialSections(value: DocumentData, noteIds: string[]): void {
  if (value.sections === undefined) return;
  if (!Array.isArray(value.sections)) return fail(INVALID_DOCUMENT);
  for (const section of value.sections) {
    if (!ownObject(section) || ids(section.noteIds).some(id => !noteIds.includes(id))) return fail('invalid-material-section-membership');
  }
}

function materialHasNote(value: DocumentData, noteId: string): boolean {
  return ids(value.noteIds).includes(noteId) || (Array.isArray(value.sections)
    && value.sections.some(section => ownObject(section) && ids(section.noteIds).includes(noteId)));
}

/** Owns a single read-only planning pass; persistence starts only after it finishes. */
class RelationPlanner {
  private readonly cached = new Map<string, ResourceSnapshot>();
  private readonly writes = new Map<string, ResourceSnapshot>();
  private readonly seriesMembershipWrites: SeriesMembershipWrite[] = [];
  private serviceOrderPlacement?: ServiceOrderPlacementWrite;

  constructor(private readonly command: DataCommand, private readonly primary: ResourceSnapshot, private readonly reader: RelationReader) {
    this.cached.set(key(primary.resource), primary);
  }

  private assertOwned(snapshot: ResourceSnapshot): void {
    const ownerField = snapshot.resource.collection === 'studyNoteShareLinks' ? 'ownerId' : 'userId';
    if (snapshot.value && snapshot.resource.collection !== 'users' && snapshot.value[ownerField] !== this.command.owner) fail(PERMISSION_DENIED);
  }

  private remember(snapshot: ResourceSnapshot): ResourceSnapshot {
    this.assertOwned(snapshot);
    this.cached.set(key(snapshot.resource), snapshot);
    if (this.cached.size > MAX_RELATION_RESOURCES) fail('relation-scope-too-large');
    return snapshot;
  }

  private async get(resource: ResourceRef): Promise<ResourceSnapshot> {
    return this.cached.get(key(resource)) ?? this.remember(await this.reader.get(resource));
  }

  private async list(collection: string, filter?: RelationFilter, select?: (snapshot: ResourceSnapshot) => boolean): Promise<ResourceSnapshot[]> {
    // Returned rows may include documents already read individually. Reserve room
    // for those duplicates plus one new row to prove a truncated scope cannot pass.
    const overlap = [...this.cached.values()].filter(snapshot => snapshot.resource.collection === collection).length;
    const values = await this.reader.list(collection, MAX_RELATION_RESOURCES - this.cached.size + overlap + 1, filter, select);
    return values.map(snapshot => this.remember(snapshot));
  }

  private async serviceOrderPlacementScope(select?: (snapshot: ResourceSnapshot) => boolean) {
    const rows = await this.reader.list('serviceOrders', MAX_RELATION_RESOURCES + 1, undefined,
      snapshot => Boolean(snapshot.value && !snapshot.metadata?.deleted && (!select || select(snapshot))));
    const unseen = new Set(rows.map(row => key(row.resource)).filter(id => !this.cached.has(id)));
    if (this.cached.size + unseen.size > MAX_RELATION_RESOURCES) return undefined;
    return rows.map(row => this.remember(row));
  }

  private live(snapshot: ResourceSnapshot, generation?: string | null): DocumentData {
    this.assertOwned(snapshot);
    if (!snapshot.value || snapshot.metadata?.deleted) return fail('referenced-document-deleted');
    if (generation !== undefined && (snapshot.metadata?.generation ?? null) !== generation) fail('generation-mismatch');
    return snapshot.value;
  }

  private stage(snapshot: ResourceSnapshot, patch: DocumentData): void {
    const original = this.cached.get(key(snapshot.resource)) ?? snapshot;
    const prior = this.writes.get(key(snapshot.resource));
    const previous = this.live(prior ?? snapshot);
    const value = { ...previous, ...patch };
    if (equalValues(value, previous)) return;
    validateResourceDocument(snapshot.resource.collection, value, { kind: 'update', changedFields: Object.keys(patch), previous, derivedSectionNoteIds: true });
    // An ordinary primary command already advanced its revision once. Deriving
    // additional fields in that same aggregate must not advance it again.
    this.writes.set(key(snapshot.resource), prior ? { ...prior, value }
      : advanceResourceSnapshot(original, value, this.command.operationId, Object.keys(patch)));
  }

  private conflict(conflicts: ConflictDetail[]): CommandResult {
    return { kind: 'conflict', operationId: this.command.operationId, snapshot: this.primary, conflicts };
  }

  private async checkSeriesTargets(items: DocumentData[]): Promise<void> {
    for (const resource of seriesMemberResources(items)) {
      // A delete must contend on the target even though only the series is written.
      this.live(this.writes.get(key(resource)) ?? await this.get(resource));
    }
  }

  private async createSeriesMember(command: Extract<DataCommand, { relation: 'series-member-create' }>): Promise<CommandResult | undefined> {
    // Ordinary creation owns validation, ownership, provenance and absent-ID semantics.
    // These are proposed writes only: a failed series relation exposes neither effect.
    const result = await this.ordinary({ ...command, kind: 'create' });
    if (result) return result;
    return this.seriesRelation({ ...command, resource: command.edit.resource, generation: command.edit.generation,
      relation: 'series-membership', edits: [command.edit] });
  }

  private async linkMaterial(material: ResourceSnapshot, before: string[], after: string[], generations?: Map<string, string | null>): Promise<void> {
    materialSections(this.live(material), after);
    for (const noteId of materialNoteIds(before, after)) {
      if (generations && !generations.has(noteId)) fail('missing-target-generation');
      const note = await this.get({ collection: 'studyNotes', id: noteId });
      const value = this.live(note, generations?.get(noteId));
      const materialIds = ids(value.materialIds);
      const next = after.includes(noteId) ? [...new Set([...materialIds, material.resource.id])]
        : materialIds.filter(id => id !== material.resource.id);
      this.stage(note, { materialIds: next });
    }
  }

  private async materialRelation(command: Extract<DataCommand, { relation: 'material-notes' }>): Promise<CommandResult | undefined> {
    const before = ids(this.primary.value?.noteIds);
    const merged = mergeFields({ exists: true, value: command.beforeNoteIds }, { exists: true, value: command.afterNoteIds }, { exists: true, value: before }, ['noteIds']);
    if (merged.conflicts.length) return this.conflict(merged.conflicts);
    const after = ids(merged.value.value);
    const generations = new Map(command.targets.map(target => [target.id, target.generation]));
    for (const noteId of after) {
      // Concurrent untouched additions use their current server generation.
      if (!generations.has(noteId) && !command.beforeNoteIds.includes(noteId) && !command.afterNoteIds.includes(noteId)) {
        generations.set(noteId, (await this.get({ collection: 'studyNotes', id: noteId })).metadata?.generation ?? null);
      }
    }
    materialSections(this.live(this.primary), before);
    const patch: DocumentData = { noteIds: after };
    if (Array.isArray(this.primary.value?.sections)) {
      patch.sections = this.primary.value.sections.map(section => ({ ...(section as DocumentData), noteIds: ids((section as DocumentData).noteIds).filter(id => after.includes(id)) }));
    }
    this.stage(this.primary, patch);
    await this.linkMaterial(this.writes.get(key(this.primary.resource)) ?? this.primary, before, after, generations);
  }

  /** Validate the final transaction view, including documents absent from the client's edits. */
  private async exclusiveSeriesMembers(added: Map<string, ResourceRef>): Promise<void> {
    if (!added.size) return;
    const series = new Map((await this.list('series', undefined, snapshot => Boolean(snapshot.value && !snapshot.metadata?.deleted
      && currentItems(snapshot.value).some(member => added.has(`${member.type}:${member.refId}`))))).map(snapshot => [key(snapshot.resource), snapshot]));
    for (const snapshot of this.writes.values()) {
      if (snapshot.resource.collection === 'series') series.set(key(snapshot.resource), snapshot);
    }
    const assigned = new Map<string, ResourceSnapshot>();
    for (const snapshot of series.values()) {
      if (!snapshot.value || snapshot.metadata?.deleted) continue;
      for (const member of currentItems(snapshot.value)) {
        const identity = `${member.type}:${member.refId}`;
        if (!added.has(identity)) continue;
        if (assigned.has(identity)) fail('membership-already-assigned');
        assigned.set(identity, snapshot);
      }
    }
    for (const [identity, member] of added) this.recordUnclockedMembership(member, assigned.get(identity));
  }

  private recordUnclockedMembership(member: ResourceRef, destination?: ResourceSnapshot): void {
    this.seriesMembershipWrites.push({ member, head: {
      owner: this.command.owner, memberGeneration: null, time: null, operationId: this.command.operationId,
      location: destination ? seriesLocation(destination) : null,
    } });
  }

  private async seriesRelation(command: Extract<DataCommand, { relation: 'series-membership' }>): Promise<CommandResult | undefined> {
    const order = this.reader.seriesMembershipOrder;
    if (command.edits[0].membership && order) {
      const moves = readSeriesMembershipMoves(command.edits, order.serverMs);
      if (!moves) return fail(INVALID_DOCUMENT);
      const observed = command.edits[0].membership.observedCatalogVersion;
      if (observed !== undefined && observed > await order.catalogVersion()) return fail(INVALID_DOCUMENT);
      if (moves !== 'legacy-repair' && moves.size) return this.orderedSeriesRelation(command, moves, order);
    }
    const added = new Map<string, ResourceRef>(), removed = new Map<string, ResourceRef>();
    for (const edit of command.edits) {
      const series = await this.get(edit.resource);
      const value = this.live(series, edit.generation);
      const merged = mergeFields({ exists: true, value: edit.beforeItems }, { exists: true, value: edit.afterItems }, { exists: true, value: currentItems(value) }, ['items']);
      if (merged.conflicts.length) return this.conflict(merged.conflicts.map(item => ({ ...item, path: [edit.resource.id, ...item.path] })));
      const fields = seriesFields(merged.value.value as DocumentData[]);
      const opening = currentItems(value), before = new Set(opening.map(membershipKey));
      const after = new Set((fields.items as DocumentData[]).map(membershipKey));
      for (const member of opening) if (!after.has(membershipKey(member))) removed.set(membershipKey(member), seriesMemberResources([member])[0]);
      for (const member of fields.items as DocumentData[]) {
        const identity = membershipKey(member);
        if (!before.has(identity)) added.set(identity, seriesMemberResources([member])[0]);
      }
      await this.checkSeriesTargets(fields.items as DocumentData[]);
      this.stage(series, fields);
      // Explicit participants must each have committed evidence, including a side
      // already satisfied by another writer. Receipt replay never re-plans this.
      if (!this.writes.has(key(series.resource))) this.writes.set(key(series.resource), advanceResourceSnapshot(series, value, command.operationId, []));
    }
    await this.exclusiveSeriesMembers(added);
    // A Clear in an older client still advances what a subsequent action must
    // have observed. Do not scan the whole catalog for an untimed removal.
    for (const [identity, member] of removed) if (!added.has(identity)) {
      const retained = [...this.writes.values()].find(snapshot => snapshot.resource.collection === 'series' && snapshot.value
        && currentItems(snapshot.value).some(item => membershipKey(item) === identity));
      this.recordUnclockedMembership(member, retained);
    }
  }

  private async orderedSeriesRelation(command: Extract<DataCommand, { relation: 'series-membership' }>,
    moves: Map<string, SeriesMembershipMove>, order: NonNullable<RelationReader['seriesMembershipOrder']>): Promise<CommandResult | undefined> {
    const edits = new Map(command.edits.map(edit => [edit.resource.id, edit]));
    const participants = new Map<string, ResourceSnapshot>();
    for (const edit of edits.values()) {
      const series = await this.get(edit.resource);
      this.live(series, edit.generation);
      if (edit.membership!.observedRevision > (series.metadata?.revision ?? 0)) return fail(INVALID_DOCUMENT);
      participants.set(series.resource.id, series);
    }
    const current = new Map<string, { series: ResourceSnapshot; item: DocumentData; items: DocumentData[] }>();
    for (const series of await this.list('series', undefined, snapshot => Boolean(snapshot.value && !snapshot.metadata?.deleted
      && currentItems(snapshot.value).some(item => moves.has(membershipKey(item)))))) {
      const items = currentItems(this.live(series));
      for (const item of items) {
        const identity = membershipKey(item);
        if (!moves.has(identity)) continue;
        if (current.has(identity)) return fail('membership-already-assigned');
        current.set(identity, { series, item, items });
      }
    }

    const predecessors = new Set(command.edits.flatMap(({ membership }) => membership?.predecessorOperationId ? [membership.predecessorOperationId] : []));
    const placements = new Map<string, SeriesMembershipPlacement[]>();
    const comparisons: SeriesMembershipComparison[] = [];
    for (const [identity, move] of moves) {
      const stored = current.get(identity);
      const intended = move.to && participants.get(move.to.edit.resource.id)!;
      const member = await this.get(memberResource(move.ref));
      this.live(member);
      const location = stored ? seriesLocation(stored.series) : null;
      const proof = await reconcileDeletedSeriesMembership(await order.read(member.resource), command.owner, location, order.readDeletion);
      const proposed = intended ? seriesLocation(intended) : null;
      const decision = resolveSeriesMembership(move, command.owner, command.operationId, member, location, proposed, proof, predecessors);
      if (!decision) {
        comparisons.push({ ref: move.ref, label: typeof member.value?.title === 'string' ? member.value.title : '', proposed, stored: location });
        continue;
      }
      if (decision.write) this.seriesMembershipWrites.push(decision.write);
      if (decision.incoming && stored) participants.set(stored.series.resource.id, stored.series);
      const keepsStored = stored && (!decision.incoming || stored.series.resource.id === intended?.resource.id);
      const placement = keepsStored ? { id: stored.series.resource.id, item: stored.item, order: stored.items }
        : decision.incoming && intended && move.to ? { id: intended.resource.id, item: move.to.item, order: move.to.edit.afterItems } : null;
      if (placement) {
        const items = placements.get(placement.id) ?? [];
        items.push({ identity, item: placement.item, order: placement.order });
        placements.set(placement.id, items);
      }
    }

    if (comparisons.length) return { kind: 'refused', operationId: command.operationId,
      code: 'membership-already-assigned', seriesMembershipComparisons: comparisons };

    for (const [id, series] of participants) {
      const value = this.live(series), edit = edits.get(id);
      const projected = mergeOrderedSeriesItems(currentItems(value), edit, moves, placements.get(id) ?? []);
      if (projected.conflicts.length) return this.conflict(projected.conflicts.map(conflict => ({ ...conflict, path: [id, ...conflict.path] })));
      const fields = seriesFields(projected.items);
      await this.checkSeriesTargets(fields.items as DocumentData[]);
      this.stage(series, fields);
      if (edit && !this.writes.has(key(series.resource))) this.writes.set(key(series.resource), advanceResourceSnapshot(series, value, command.operationId, []));
    }
  }

  /**
   * A section moves between two councils in one commit. Each side states the topics it was built
   * on, so a section another device added meanwhile survives the merge; a stale generation on
   * either side is a conflict, never a silent overwrite.
   */
  private async councilCarry(command: Extract<DataCommand, { relation: 'council-carry' }>): Promise<CommandResult | undefined> {
    if (!validCouncilCarry(command.edits[0].beforeTopics, command.edits[0].afterTopics,
      command.edits[1].resource.id, command.edits[1].afterTopics, command.edits[1].beforeTopics)) fail(INVALID_DOCUMENT);
    for (const edit of command.edits) {
      const council = await this.get(edit.resource);
      if (edit.create !== undefined) {
        if (edit !== command.edits[1] || edit.generation !== null || edit.beforeTopics.length
          || edit.create.userId !== command.owner || edit.create.status !== 'preparing'
          || !equalValues(edit.create.topics, edit.afterTopics)) fail(INVALID_DOCUMENT);
        this.assertOwned(council);
        if (council.value || council.metadata) fail('destination-already-exists');
        const result = applyCommand({ protocol: command.protocol, owner: command.owner, operationId: command.operationId,
          resource: edit.resource, generation: null, dependsOn: command.dependsOn, kind: 'create', value: edit.create }, council);
        if (result.kind !== 'acknowledged') return result;
        this.writes.set(key(edit.resource), result.snapshot);
        continue;
      }
      const value = this.live(council, edit.generation);
      const merged = mergeFields({ exists: true, value: edit.beforeTopics }, { exists: true, value: edit.afterTopics },
        { exists: true, value: currentTopics(value) }, ['topics']);
      if (merged.conflicts.length) return this.conflict(merged.conflicts.map(item => ({ ...item, path: [edit.resource.id, ...item.path] })));
      this.stage(council, { topics: merged.value.value as Json });
    }
  }

  /** Apply a bounded source-first analysis reshape only when every authored frame still matches. */
  private async analysisReshape(command: Extract<DataCommand, { relation: 'analysis-reshape' }>): Promise<CommandResult | undefined> {
    const candidates: ResourceSnapshot[] = [];
    for (const edit of command.edits) {
      const current = await this.get(edit.resource);
      this.assertOwned(current);
      if (edit.create !== undefined) {
        if (current.metadata?.deleted) return { kind: 'deleted', operationId: command.operationId, snapshot: current };
        if (current.value || current.metadata) fail('destination-already-exists');
        const created = applyCommand({ ...command, resource: edit.resource, generation: null, kind: 'create', value: edit.create }, current);
        if (created.kind !== 'acknowledged') return created;
        candidates.push(created.snapshot);
        continue;
      }

      const value = this.live(current, edit.generation);
      const expectedFrame = Object.fromEntries(ANALYSIS_RESHAPE_FRAME.map(field => [field, edit.changes.find(change => change.path[0] === field)!.before.value as Json]));
      if (!sameAnalysisFrame(value, expectedFrame)) {
        const conflicts = edit.changes.flatMap(change => {
          if (!ANALYSIS_RESHAPE_FRAME.includes(change.path[0] as (typeof ANALYSIS_RESHAPE_FRAME)[number])) return [];
          const theirs = readField(value, change.path);
          return equalValues(change.before, theirs) ? [] : [{
            path: [edit.resource.id, ...change.path], base: change.before, mine: change.after, theirs,
          }];
        });
        return this.conflict(conflicts);
      }
      if (value.type !== 'analysis' || !value.analysis || typeof value.content !== 'string' || !Array.isArray(value.scriptureRefs)) fail(INVALID_DOCUMENT);
      const updated = applyCommand({ ...command, resource: edit.resource, generation: edit.generation, kind: 'update', changes: edit.changes }, current);
      if (updated.kind === 'conflict') return this.conflict(updated.conflicts.map(conflict => ({ ...conflict, path: [edit.resource.id, ...conflict.path] })));
      if (updated.kind !== 'acknowledged') return updated;
      candidates.push(updated.snapshot);
    }

    // Candidate validation and all participant reads above complete before any write is exposed.
    candidates.forEach(candidate => this.writes.set(key(candidate.resource), candidate));
  }

  private async shareCapability(command: ShareCapabilityCommand): Promise<void> {
    const writes = await planShareCapability(command, this.primary, {
      readLiveNote: async id => {
        const snapshot = await this.get({ collection: 'studyNotes', id });
        this.live(snapshot);
        return snapshot;
      },
      readRevokedLinkNote: async id => {
        try { return await this.get({ collection: 'studyNotes', id }); }
        catch (error) {
          // Revoking a legacy owned link must work even when its referenced note is foreign.
          if (error && typeof error === 'object' && 'code' in error && error.code === PERMISSION_DENIED) return undefined;
          throw error;
        }
      },
      listLinks: noteId => this.list('studyNoteShareLinks', { field: 'noteId', operator: '==', value: noteId }),
      refuse: fail,
    });
    writes.forEach(snapshot => this.writes.set(key(snapshot.resource), snapshot));
  }

  private async planRelation(command: Extract<DataCommand, { kind: 'relation' }>): Promise<CommandResult | undefined> {
    switch (command.relation) {
      case 'share-link-create':
      case 'share-link-revoke': await this.shareCapability(command); return;
      case 'service-order-seed': return this.seedServiceOrder(command);
      case 'series-member-create': return this.createSeriesMember(command);
      case 'material-notes': return this.materialRelation(command);
      case 'council-carry': return this.councilCarry(command);
      case 'analysis-reshape': return this.analysisReshape(command);
      default: return this.seriesRelation(command);
    }
  }

  /** Guard old generic creates too: different client IDs cannot name the same live standard rite. */
  private async uniqueServiceOrder(value: DocumentData): Promise<void> {
    if (!isServiceOrderCatalogKey(value.catalogKey)) return;
    const matching = await this.list('serviceOrders', { field: 'catalogKey', operator: '==', value: value.catalogKey });
    if (matching.some(snapshot => snapshot.resource.id !== this.primary.resource.id && snapshot.value !== null)) fail('catalog-entry-exists');
  }

  /** Admission belongs to final writes, including updates and every atomic reshape participant. */
  private async uniqueAnalysisWrites(): Promise<void> {
    const candidates = [...this.writes.values()].filter(snapshot => snapshot.resource.collection === 'studyNotes'
      && studyAnalysisPassageIdentity(snapshot.value));
    for (const candidate of candidates) {
      // Existing duplicates remain editable; this operation may not introduce another identity.
      if (sameStudyAnalysisPassage(this.cached.get(key(candidate.resource))?.value, candidate.value)) continue;
      const collides = (other: ResourceSnapshot) => other.resource.collection === 'studyNotes'
        && other.resource.id !== candidate.resource.id && other.value !== null && !other.metadata?.deleted
        && other.value.userId === this.command.owner && sameStudyAnalysisPassage(other.value, candidate.value);
      if ([...this.writes.values()].some(collides)) fail('analysis-exists');
      const matches = await this.reader.list('studyNotes', 1, { field: 'type', operator: '==', value: 'analysis' }, snapshot =>
        collides(this.writes.get(key(snapshot.resource)) ?? snapshot));
      if (matches.length) fail('analysis-exists');
    }
  }

  private async seedServiceOrder(command: Extract<DataCommand, { relation: 'service-order-seed' }>): Promise<CommandResult | undefined> {
    validateResourceDocument('serviceOrders', command.value, { kind: 'create' });
    if (this.primary.metadata?.deleted) return { kind: 'deleted', operationId: command.operationId, snapshot: this.primary };
    await this.uniqueServiceOrder(command.value);
    if (this.primary.value) {
      if (this.primary.value.catalogKey !== command.value.catalogKey) fail('catalog-identity-mismatch');
      // A new receipt proves this operation; all authored fields and recency come from the stored rite.
      this.writes.set(key(this.primary.resource), advanceResourceSnapshot(this.primary, this.primary.value, command.operationId, []));
    } else {
      const result = applyCommand({ ...command, kind: 'create' }, this.primary);
      if (result.kind !== 'acknowledged') return result;
      this.writes.set(key(this.primary.resource), result.snapshot);
    }
  }

  private guardOrdinary(command: Exclude<DataCommand, { kind: 'relation' }>): void {
    const collection = command.resource.collection;
    if (command.kind === 'create') {
      if (collection === 'studyNotes' && ids(command.value.materialIds).length) fail(RELATION_REQUIRED);
      if (['sermons', 'groups'].includes(collection) && (command.value.seriesId != null || command.value.seriesPosition != null)) fail(RELATION_REQUIRED);
    }
    if (command.kind === 'update') {
      const forbidden: Record<string, readonly string[]> = {
        studyNotes: [...relationMirrorFields('studyNotes'), 'isDraft'], studyMaterials: ['noteIds'], series: ['items', 'sermonIds', 'seriesKind'],
        sermons: relationMirrorFields('sermons'), groups: relationMirrorFields('groups'),
      };
      // Editing a section is ordinary work and stays an ordinary update. Only the carry mark is
      // a claim about ANOTHER council, and a claim that the other document never received is how
      // a section ends up in neither: it belongs to the two-council command.
      if (collection === 'councils' && command.changes.some(change => change.path[0] === 'topics' && carryMarks(change.after) !== carryMarks(change.before))) {
        fail(RELATION_REQUIRED);
      }
      if (command.changes.some(change => forbidden[collection]?.includes(change.path[0]))) fail(RELATION_REQUIRED);
    }
  }

  private async detachSeriesMember(): Promise<void> {
    const type = this.primary.resource.collection === 'sermons' ? 'sermon' : 'group';
    // Nested and historical memberships have no complete flat index. Only matching
    // participants consume the atomic scope; the reader still checks every owner page.
    for (const series of await this.list('series', undefined, snapshot => Boolean(snapshot.value && !snapshot.metadata?.deleted
      && currentItems(snapshot.value).some(item => item.type === type && item.refId === this.primary.resource.id)))) {
      if (!series.value || series.metadata?.deleted) continue;
      const before = currentItems(series.value);
      const after = before.filter(item => !(item.type === type && item.refId === this.primary.resource.id));
      if (before.length !== after.length) this.stage(series, seriesFields(after));
    }
  }

  private async detachMaterial(): Promise<void> {
    const id = this.primary.resource.id;
    // Historical partial writes may disagree with the forward membership.
    const notes = new Map((await this.list('studyNotes', { field: 'materialIds', operator: 'array-contains', value: id })).map(note => [note.resource.id, note]));
    for (const noteId of ids(this.primary.value?.noteIds)) {
      if (!notes.has(noteId)) notes.set(noteId, await this.get({ collection: 'studyNotes', id: noteId }));
    }
    for (const note of notes.values()) {
      if (note.value && !note.metadata?.deleted && ids(note.value.materialIds).includes(id)) {
        this.stage(note, { materialIds: ids(note.value.materialIds).filter(value => value !== id) });
      }
    }
  }

  private async detachNote(): Promise<void> {
    const id = this.primary.resource.id;
    const links = await this.list('studyNoteShareLinks', { field: 'noteId', operator: '==', value: id });
    for (const link of links) {
      if (link.value && !link.metadata?.deleted) this.writes.set(key(link.resource), advanceResourceSnapshot(link, null, this.command.operationId, []));
    }
    // Selection includes legacy section-only references omitted from root membership.
    for (const material of await this.list('studyMaterials', undefined, snapshot => Boolean(snapshot.value && !snapshot.metadata?.deleted
      && materialHasNote(snapshot.value, id)))) this.removeMaterialNote(material, id);
  }

  private removeMaterialNote(material: ResourceSnapshot, id: string): void {
    if (!material.value || material.metadata?.deleted) return;
    const sections = material.value.sections;
    if (!materialHasNote(material.value, id)) return;
    const patch: DocumentData = { noteIds: ids(material.value.noteIds).filter(value => value !== id) };
    if (Array.isArray(sections)) {
      patch.sections = sections.map(section => ownObject(section) ? { ...section, noteIds: ids(section.noteIds).filter(value => value !== id) } : section);
    }
    this.stage(material, patch);
  }

  private async detachSeries(): Promise<void> {
    for (const collection of ['sermons', 'groups']) {
      for (const member of await this.list(collection, { field: 'seriesId', operator: '==', value: this.primary.resource.id })) {
        if (member.value && !member.metadata?.deleted && member.value.seriesId === this.primary.resource.id) {
          this.stage(member, { seriesId: null, seriesPosition: null });
        }
      }
    }
  }

  private async cascadeDelete(): Promise<void> {
    switch (this.primary.resource.collection) {
      case 'sermons': case 'groups': return this.detachSeriesMember();
      case 'studyMaterials': return this.detachMaterial();
      case 'studyNotes': return this.detachNote();
      case 'series': return this.detachSeries();
      case 'tags': return this.detachTag();
    }
  }

  private async detachTag(): Promise<void> {
    const tag = this.primary.value!;
    if (tag.required === true || (typeof tag.name === 'string' && isStructureTag(tag.name))) fail('required-tag');
    if (typeof tag.name !== 'string' || !tag.name) fail(INVALID_DOCUMENT);
    // The thoughts that carry the name are cleaned after this commit, one sermon at a time
    // (server.ts → removeTagFromSermons): folding every sermon into this transaction refused
    // the deletion outright for anyone with a hundred sermons.
  }

  private async checkSermonSources(command: Exclude<DataCommand, { kind: 'relation' | 'delete' }>, accepted: DocumentData): Promise<void> {
    const changed = command.kind === 'create' ? ['sourceNoteIds', 'scratch']
      : command.changes.map(change => change.path[0]);
    const references = sermonSourceReferences(this.primary.value, accepted, changed);
    if (changed.includes('sourceNoteIds') || changed.includes('scratch') && references.noteIds.length) ids(accepted.sourceNoteIds);
    if (references.invalidProvenance) fail('invalid-scratch-provenance');
    // Retain historical provenance after a source disappears, but every newly
    // assigned reference must name a live owned note in this same transaction.
    for (const id of references.noteIds) this.live(await this.get({ collection: 'studyNotes', id }));
  }

  private async deriveAccepted(command: Exclude<DataCommand, { kind: 'relation' | 'delete' }>): Promise<void> {
    const accepted = this.writes.get(key(this.primary.resource))!;
    const value = this.live(accepted);
    if (this.primary.resource.collection === 'sermons') await this.checkSermonSources(command, value);
    if (this.primary.resource.collection === 'studyNotes') {
      this.stage(accepted, { isDraft: isStudyNoteDraft({ type: typeof value.type === 'string' ? value.type : undefined, tags: ids(value.tags), scriptureRefs: Array.isArray(value.scriptureRefs) ? value.scriptureRefs : null }) });
    }
    if (this.primary.resource.collection === 'studyMaterials') {
      materialSections(value, ids(value.noteIds));
      if (command.kind === 'create') await this.linkMaterial(accepted, [], ids(value.noteIds));
    }
    if (this.primary.resource.collection === 'series' && command.kind === 'create') {
      const members = value.items as DocumentData[];
      await this.checkSeriesTargets(members);
      await this.exclusiveSeriesMembers(new Map(members.map(member => [membershipKey(member), seriesMemberResources([member])[0]])));
    }
  }

  private async ordinary(command: Exclude<DataCommand, { kind: 'relation' }>): Promise<CommandResult | undefined> {
    this.guardOrdinary(command);
    if (command.kind === 'update' && command.serviceOrderPlacement && this.primary.value && !this.primary.metadata?.deleted
      && command.generation === (this.primary.metadata?.generation ?? null)) {
      const context = this.reader.serviceOrderPlacement;
      const plan = await planServiceOrderPlacement(command, this.primary, context?.rawMetadata, context?.serverMs, {
        get: id => this.get({ collection: 'serviceOrders', id }),
        list: select => this.serviceOrderPlacementScope(select),
      });
      if ('conflict' in plan) return { kind: 'conflict', operationId: command.operationId, snapshot: this.primary,
        conflicts: [plan.conflict], serviceOrderPlacementComparison: plan.comparison };
      for (const { snapshot, rank } of plan.ranks) this.stage(snapshot, { rank });
      if (!this.writes.has(key(this.primary.resource))) {
        this.writes.set(key(this.primary.resource), advanceResourceSnapshot(this.primary, this.primary.value, command.operationId, []));
      }
      this.serviceOrderPlacement = plan.write;
      return;
    }
    if (command.kind === 'create' && command.resource.collection === 'serviceOrders') await this.uniqueServiceOrder(command.value);
    const effective = command.kind === 'create' && command.resource.collection === 'series'
      ? { ...command, value: { ...command.value, ...seriesFields(currentItems(command.value)) } } : command;
    const result = applyCommand(effective, this.primary);
    if (result.kind !== 'acknowledged') return result;
    this.writes.set(key(this.primary.resource), result.snapshot);
    if (command.kind === 'delete') await this.cascadeDelete();
    else await this.deriveAccepted(command);
  }

  async plan(): Promise<CommandPlan> {
    if (key(this.command.resource) !== key(this.primary.resource)) fail('resource-mismatch');
    this.assertOwned(this.primary);
    let result: CommandResult | undefined;
    if (this.command.kind === 'relation' && ['share-link-create', 'share-link-revoke'].includes(this.command.relation)) {
      await this.shareCapability(this.command as ShareCapabilityCommand);
    } else if (this.command.kind === 'relation' && this.command.relation === 'service-order-seed') {
      result = await this.seedServiceOrder(this.command);
    } else if (this.command.kind === 'relation' && this.command.relation === 'series-member-create') {
      result = await this.createSeriesMember(this.command);
    } else if (this.command.kind === 'relation') {
      this.live(this.primary, this.command.generation);
      result = await this.planRelation(this.command);
      // Every new accepted operation needs its own primary proof, even when a
      // concurrent writer already satisfied the relation. Receipt replays bypass
      // this planner and therefore never increment the revision twice.
      if (!result && !this.writes.has(key(this.primary.resource))) {
        this.writes.set(key(this.primary.resource), advanceResourceSnapshot(this.primary, this.live(this.primary), this.command.operationId, []));
      }
    } else result = await this.ordinary(this.command);
    if (result) return { result, writes: [] };
    await this.uniqueAnalysisWrites();
    const snapshot = this.writes.get(key(this.primary.resource)) ?? this.primary;
    const affected = [...this.writes.values()].filter(value => key(value.resource) !== key(this.primary.resource)).map(value => ({ resource: value.resource, metadata: value.metadata! }));
    return { result: { kind: 'acknowledged', operationId: this.command.operationId, snapshot, ...(affected.length ? { affected } : {}) },
      writes: [...this.writes.values()], ...(this.serviceOrderPlacement && { serviceOrderPlacement: this.serviceOrderPlacement }),
      ...(this.seriesMembershipWrites.length ? { seriesMembershipWrites: this.seriesMembershipWrites } : {}) };
  }
}

/** No writes are exposed on conflict, invalid references, or scope overflow. */
export async function planDataCommand(command: DataCommand, primary: ResourceSnapshot, reader: RelationReader): Promise<CommandPlan> {
  try { return await new RelationPlanner(command, primary, reader).plan(); }
  catch (error) {
    let code: string;
    if (error instanceof RelationRefusal) code = error.code;
    else if (error && typeof error === 'object' && 'code' in error && error.code === PERMISSION_DENIED) code = PERMISSION_DENIED;
    else if (error && typeof error === 'object' && 'code' in error && error.code === 'invalid-argument') code = INVALID_DOCUMENT;
    else throw error;
    return { result: { kind: 'refused', operationId: command.operationId, code }, writes: [] };
  }
}
