import { deriveSeriesItemsFromSermonIds, deriveSermonIdsFromItems, inferSeriesKind, normalizeSeriesItems } from '@/utils/seriesItems';
import { isStructureTag } from '@/utils/structureTags';

import { advanceResourceSnapshot, applyCommand, equalValues, mergeFields } from './protocol';
import { validateResourceDocument } from './resourceSchemas';

import type { CommandResult, ConflictDetail, DataCommand, DocumentData, Json, ResourceRef, ResourceSnapshot } from './types';
import type { SeriesItem } from '@/models/models';

export const MAX_RELATION_RESOURCES = 100;
export interface RelationFilter { field: 'materialIds' | 'seriesId' | 'noteId'; operator: '==' | 'array-contains'; value: string }
export interface RelationReader {
  get(resource: ResourceRef): Promise<ResourceSnapshot>;
  /** Implementations always add authenticated owner scope; callers cannot choose it. */
  list(collection: string, limit: number, filter?: RelationFilter): Promise<ResourceSnapshot[]>;
}
export interface CommandPlan { result: CommandResult; writes: ResourceSnapshot[] }

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

function currentTopics(value: DocumentData): DocumentData[] {
  if (value.topics === undefined) return [];
  if (!Array.isArray(value.topics)) return fail(INVALID_DOCUMENT);
  validateResourceDocument('councils', { topics: value.topics }, { kind: 'update', changedFields: ['topics'] });
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

function scratchSources(value: DocumentData | null): Map<string, string> {
  const sources = new Map<string, string>();
  if (!Array.isArray(value?.scratch)) return sources;
  for (const item of value.scratch) {
    if (ownObject(item) && typeof item.id === 'string' && ownObject(item.source) && typeof item.source.noteId === 'string') sources.set(item.id, item.source.noteId);
  }
  return sources;
}

/** Owns a single read-only planning pass; persistence starts only after it finishes. */
class RelationPlanner {
  private readonly cached = new Map<string, ResourceSnapshot>();
  private readonly writes = new Map<string, ResourceSnapshot>();

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

  private async list(collection: string, filter?: RelationFilter): Promise<ResourceSnapshot[]> {
    const values = await this.reader.list(collection, MAX_RELATION_RESOURCES - this.cached.size + 1, filter);
    return values.map(snapshot => this.remember(snapshot));
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
    const value = { ...this.live(prior ?? snapshot), ...patch };
    if (equalValues(value, (prior ?? snapshot).value)) return;
    validateResourceDocument(snapshot.resource.collection, value, { kind: 'update', changedFields: Object.keys(patch) });
    // An ordinary primary command already advanced its revision once. Deriving
    // additional fields in that same aggregate must not advance it again.
    this.writes.set(key(snapshot.resource), prior ? { ...prior, value }
      : advanceResourceSnapshot(original, value, this.command.operationId, Object.keys(patch)));
  }

  private conflict(conflicts: ConflictDetail[]): CommandResult {
    return { kind: 'conflict', operationId: this.command.operationId, snapshot: this.primary, conflicts };
  }

  private async checkSeriesTargets(items: DocumentData[]): Promise<void> {
    for (const item of items) {
      // A delete must contend on the target even though only the series is written.
      this.live(await this.get({ collection: item.type === 'sermon' ? 'sermons' : 'groups', id: String(item.refId) }));
    }
  }

  private async linkMaterial(material: ResourceSnapshot, before: string[], after: string[], generations?: Map<string, string | null>): Promise<void> {
    materialSections(this.live(material), after);
    for (const noteId of new Set([...before, ...after])) {
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

  private async seriesRelation(command: Extract<DataCommand, { relation: 'series-membership' }>): Promise<CommandResult | undefined> {
    for (const edit of command.edits) {
      const series = await this.get(edit.resource);
      const value = this.live(series, edit.generation);
      const merged = mergeFields({ exists: true, value: edit.beforeItems }, { exists: true, value: edit.afterItems }, { exists: true, value: currentItems(value) }, ['items']);
      if (merged.conflicts.length) return this.conflict(merged.conflicts.map(item => ({ ...item, path: [edit.resource.id, ...item.path] })));
      const fields = seriesFields(merged.value.value as DocumentData[]);
      await this.checkSeriesTargets(fields.items as DocumentData[]);
      this.stage(series, fields);
    }
  }

  /**
   * A section moves between two councils in one commit. Each side states the topics it was built
   * on, so a section another device added meanwhile survives the merge; a stale generation on
   * either side is a conflict, never a silent overwrite.
   */
  private async councilCarry(command: Extract<DataCommand, { relation: 'council-carry' }>): Promise<CommandResult | undefined> {
    for (const edit of command.edits) {
      const council = await this.get(edit.resource);
      const value = this.live(council, edit.generation);
      const merged = mergeFields({ exists: true, value: edit.beforeTopics }, { exists: true, value: edit.afterTopics },
        { exists: true, value: currentTopics(value) }, ['topics']);
      if (merged.conflicts.length) return this.conflict(merged.conflicts.map(item => ({ ...item, path: [edit.resource.id, ...item.path] })));
      this.stage(council, { topics: merged.value.value as Json });
    }
  }

  private guardOrdinary(command: Exclude<DataCommand, { kind: 'relation' }>): void {
    const collection = command.resource.collection;
    if (command.kind === 'create') {
      if (collection === 'studyNotes' && ids(command.value.materialIds).length) fail(RELATION_REQUIRED);
      if (['sermons', 'groups'].includes(collection) && (command.value.seriesId != null || command.value.seriesPosition != null)) fail(RELATION_REQUIRED);
    }
    if (command.kind === 'update') {
      const forbidden: Record<string, string[]> = {
        studyNotes: ['materialIds', 'isDraft'], studyMaterials: ['noteIds'], series: ['items', 'sermonIds', 'seriesKind'],
        sermons: ['seriesId', 'seriesPosition'], groups: ['seriesId', 'seriesPosition'],
        // Sections are carried between councils as one operation; an ordinary rewrite of the
        // whole array cannot promise the source and the destination change together.
        councils: ['topics'],
      };
      if (command.changes.some(change => forbidden[collection]?.includes(change.path[0]))) fail(RELATION_REQUIRED);
    }
  }

  private async detachSeriesMember(): Promise<void> {
    const type = this.primary.resource.collection === 'sermons' ? 'sermon' : 'group';
    // Group refs are nested in items; a bounded owner scan avoids inventing an index.
    for (const series of await this.list('series')) {
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
    // A bounded scan covers legacy section-only references omitted from root membership.
    for (const material of await this.list('studyMaterials')) this.removeMaterialNote(material, id);
  }

  private removeMaterialNote(material: ResourceSnapshot, id: string): void {
    if (!material.value || material.metadata?.deleted) return;
    const sections = material.value.sections;
    const hasSection = Array.isArray(sections) && sections.some(section => ownObject(section) && ids(section.noteIds).includes(id));
    if (!ids(material.value.noteIds).includes(id) && !hasSection) return;
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
    for (const sermon of await this.list('sermons')) {
      if (!sermon.value || sermon.metadata?.deleted || !Array.isArray(sermon.value.thoughts)) continue;
      const thoughts = sermon.value.thoughts.map(thought => {
        if (!ownObject(thought) || !Array.isArray(thought.tags) || !thought.tags.includes(tag.name)) return thought;
        return { ...thought, tags: thought.tags.filter(name => name !== tag.name) };
      });
      this.stage(sermon, { thoughts });
    }
  }

  private async checkSermonSources(command: Exclude<DataCommand, { kind: 'relation' | 'delete' }>, accepted: DocumentData): Promise<void> {
    const changed = command.kind === 'create' ? ['sourceNoteIds', 'scratch']
      : command.changes.map(change => change.path[0]);
    const added = new Set<string>();
    if (changed.includes('sourceNoteIds')) {
      const original = Array.isArray(this.primary.value?.sourceNoteIds) ? this.primary.value.sourceNoteIds : [];
      for (const id of ids(accepted.sourceNoteIds)) if (!original.includes(id)) added.add(id);
    }
    if (changed.includes('scratch')) {
      const original = scratchSources(this.primary.value);
      for (const [id, noteId] of scratchSources(accepted)) {
        if (original.get(id) === noteId) continue;
        if (!ids(accepted.sourceNoteIds).includes(noteId)) fail('invalid-scratch-provenance');
        added.add(noteId);
      }
    }
    // Retain historical provenance after a source disappears, but every newly
    // assigned reference must name a live owned note in this same transaction.
    for (const id of added) this.live(await this.get({ collection: 'studyNotes', id }));
  }

  private async deriveAccepted(command: Exclude<DataCommand, { kind: 'relation' | 'delete' }>): Promise<void> {
    const accepted = this.writes.get(key(this.primary.resource))!;
    const value = this.live(accepted);
    if (this.primary.resource.collection === 'sermons') await this.checkSermonSources(command, value);
    if (this.primary.resource.collection === 'studyNotes') {
      this.stage(accepted, { isDraft: ids(value.tags).length === 0 || !Array.isArray(value.scriptureRefs) || value.scriptureRefs.length === 0 });
    }
    if (this.primary.resource.collection === 'studyMaterials') {
      materialSections(value, ids(value.noteIds));
      if (command.kind === 'create') await this.linkMaterial(accepted, [], ids(value.noteIds));
    }
    if (this.primary.resource.collection === 'series' && command.kind === 'create') await this.checkSeriesTargets(value.items as DocumentData[]);
  }

  private async ordinary(command: Exclude<DataCommand, { kind: 'relation' }>): Promise<CommandResult | undefined> {
    this.guardOrdinary(command);
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
    if (this.command.kind === 'relation') {
      this.live(this.primary, this.command.generation);
      result = this.command.relation === 'material-notes' ? await this.materialRelation(this.command)
        : this.command.relation === 'council-carry' ? await this.councilCarry(this.command)
        : await this.seriesRelation(this.command);
      // A legacy no-op still establishes a durable generation.
      if (!result && !(this.writes.get(key(this.primary.resource)) ?? this.primary).metadata) {
        this.writes.set(key(this.primary.resource), advanceResourceSnapshot(this.primary, this.live(this.primary), this.command.operationId, []));
      }
    } else result = await this.ordinary(this.command);
    if (result) return { result, writes: [] };
    const snapshot = this.writes.get(key(this.primary.resource)) ?? this.primary;
    const affected = [...this.writes.values()].filter(value => key(value.resource) !== key(this.primary.resource)).map(value => ({ resource: value.resource, metadata: value.metadata! }));
    return { result: { kind: 'acknowledged', operationId: this.command.operationId, snapshot, ...(affected.length ? { affected } : {}) }, writes: [...this.writes.values()] };
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
