import type { CommitRequest } from './commits';
import type { JournalEntry, ResourceRef } from './types';

type RequestBucket = Map<string, CommitRequest>;

function add(buckets: Map<string, RequestBucket>, key: string, request: CommitRequest): void {
  const bucket = buckets.get(key) ?? new Map<string, CommitRequest>();
  bucket.set(request.id, request);
  buckets.set(key, bucket);
}

function remove(buckets: Map<string, RequestBucket>, key: string, id: string): void {
  const bucket = buckets.get(key);
  bucket?.delete(id);
  if (!bucket?.size) buckets.delete(key);
}

/** Same ordering and relationships as the remembered requests, keyed for local presentation. */
export class OpenEditorRequests {
  private readonly resources = new Map<string, RequestBucket>();
  private readonly collections = new Map<string, RequestBucket>();
  private readonly editors = new Map<string, RequestBucket>();
  private readonly dependents = new Map<string, RequestBucket>();
  private readonly order = new Map<string, number>();
  private sequence = 0;

  private resourceKey(owner: string, resource: ResourceRef): string {
    return JSON.stringify([owner, resource.collection, resource.id]);
  }

  set(request: CommitRequest, previous?: CommitRequest): void {
    const resource = this.resourceKey(request.owner, request.baseline.resource);
    const collection = JSON.stringify([request.owner, request.baseline.resource.collection]);
    if (previous) {
      const formerResource = this.resourceKey(previous.owner, previous.baseline.resource);
      const formerCollection = JSON.stringify([previous.owner, previous.baseline.resource.collection]);
      if (formerResource !== resource) remove(this.resources, formerResource, request.id);
      if (formerCollection !== collection) remove(this.collections, formerCollection, request.id);
      if (previous.editorId !== request.editorId) remove(this.editors, previous.editorId, request.id);
      if (previous.predecessor && previous.predecessor !== request.predecessor) remove(this.dependents, previous.predecessor, request.id);
    } else this.order.set(request.id, this.sequence++);
    add(this.resources, resource, request);
    add(this.collections, collection, request);
    add(this.editors, request.editorId, request);
    if (request.predecessor) add(this.dependents, request.predecessor, request);
  }

  private removeBuckets(request: CommitRequest): void {
    remove(this.resources, this.resourceKey(request.owner, request.baseline.resource), request.id);
    remove(this.collections, JSON.stringify([request.owner, request.baseline.resource.collection]), request.id);
    remove(this.editors, request.editorId, request.id);
    if (request.predecessor) remove(this.dependents, request.predecessor, request.id);
  }

  delete(request: CommitRequest): void {
    this.removeBuckets(request);
    this.order.delete(request.id);
  }

  clear(): void {
    this.resources.clear();
    this.collections.clear();
    this.editors.clear();
    this.dependents.clear();
    this.order.clear();
    this.sequence = 0;
  }

  forResource(owner: string, resource: ResourceRef): ReadonlyMap<string, CommitRequest> {
    return this.resources.get(this.resourceKey(owner, resource)) ?? emptyBucket;
  }

  forCollection(owner: string, collection: string): CommitRequest[] {
    const bucket = this.collections.get(JSON.stringify([owner, collection]));
    if (!bucket) return [];
    return [...bucket.values()].sort((a, b) => this.order.get(a.id)! - this.order.get(b.id)!);
  }

  /** Follow every dependent and whole-action participant, including those on other documents. */
  forChoice(records: ReadonlyMap<string, CommitRequest>, owner: string, ids: readonly string[], editorId?: string): CommitRequest[] {
    const selected = new Map<string, CommitRequest>();
    const addRequest = (request?: CommitRequest) => {
      if (request?.owner === owner && !selected.has(request.id)) selected.set(request.id, request);
    };
    for (const id of ids) addRequest(records.get(id));
    if (editorId !== undefined) for (const request of this.editors.get(editorId)?.values() ?? []) addRequest(request);
    for (const request of selected.values()) {
      for (const id of request.atomic?.participants ?? []) addRequest(records.get(id));
      for (const dependent of this.dependents.get(request.id)?.values() ?? []) addRequest(dependent);
    }
    return [...selected.values()].sort((a, b) => this.order.get(a.id)! - this.order.get(b.id)!);
  }
}

const emptyBucket: ReadonlyMap<string, CommitRequest> = new Map();

/** Keep journal ordering when a view asks for only the entries linked to its local requests. */
export class OpenEditorJournal {
  private readonly operations = new Map<string, { entry: JournalEntry; ordinal: number }[]>();
  private readonly shareLinks = new Map<string, JournalEntry[]>();

  constructor(entries: readonly JournalEntry[]) {
    entries.forEach((entry, ordinal) => {
      const id = entry.command.operationId;
      const matches = this.operations.get(id) ?? [];
      matches.push({ entry, ordinal });
      this.operations.set(id, matches);
      if (entry.command.resource.collection === 'studyNoteShareLinks' && entry.result?.kind === 'acknowledged') {
        const owner = entry.command.owner;
        const links = this.shareLinks.get(owner) ?? [];
        links.push(entry);
        this.shareLinks.set(owner, links);
      }
    });
  }

  forOperations(ids: Iterable<string>): JournalEntry[] {
    return [...new Set(ids)].flatMap(id => this.operations.get(id) ?? [])
      .sort((a, b) => a.ordinal - b.ordinal).map(({ entry }) => entry);
  }

  forShareLinks(owner: string): readonly JournalEntry[] {
    return this.shareLinks.get(owner) ?? [];
  }
}
