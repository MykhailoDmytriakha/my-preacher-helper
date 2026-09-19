/** The wire contract is shared by browser and server; it imports no transport. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type DocumentData = Record<string, Json>;

export interface ResourceRef {
  collection: string;
  id: string;
}

export interface FieldValue {
  exists: boolean;
  value?: Json;
}

export interface FieldChange {
  /** One top-level root; nested edits carry the ancestor baseline and merge inside the engine. */
  path: string[];
  before: FieldValue;
  after: FieldValue;
}

export interface CommandBase {
  protocol: 1;
  operationId: string;
  owner: string;
  resource: ResourceRef;
  /** Null is permitted only for a first create or an unversioned legacy record. */
  generation: string | null;
  dependsOn: string[];
}

export type DataCommand = CommandBase & (
  | { kind: 'create'; value: DocumentData }
  | { kind: 'update'; changes: FieldChange[] }
  | { kind: 'delete'; baseline: DocumentData }
  | { kind: 'relation'; relation: 'material-notes'; beforeNoteIds: string[]; afterNoteIds: string[];
      targets: Array<{ id: string; generation: string | null }> }
  | { kind: 'relation'; relation: 'series-membership'; edits: Array<{
      resource: ResourceRef; generation: string | null; beforeItems: DocumentData[]; afterItems: DocumentData[];
    }> }
  /** Creating a member in a series is one effect, including when the response is lost. */
  | { kind: 'relation'; relation: 'series-member-create'; value: DocumentData; edit: {
      resource: ResourceRef; generation: string | null; beforeItems: DocumentData[]; afterItems: DocumentData[];
    } }
  /** Carrying a section between two councils: the source is marked carried only because it landed. */
  | { kind: 'relation'; relation: 'council-carry'; edits: Array<{
      resource: ResourceRef; generation: string | null; beforeTopics: DocumentData[]; afterTopics: DocumentData[];
    }> }
);

export interface EngineMetadata {
  protocol: 1;
  generation: string;
  revision: number;
  deleted: boolean;
  /** Identifies our own server-confirmed change before its HTTP acknowledgement arrives. */
  operationId?: string;
}

export interface ResourceSnapshot {
  resource: ResourceRef;
  /** Deleted and absent documents never masquerade as live data. */
  value: DocumentData | null;
  metadata: EngineMetadata | null;
}

export interface ConflictDetail {
  path: string[];
  base: FieldValue;
  mine: FieldValue;
  theirs: FieldValue;
}

export type CommandResult =
  | { kind: 'acknowledged'; operationId: string; snapshot: ResourceSnapshot;
      /** Original committed effect; replay may return a newer current snapshot. */
      committed?: EngineMetadata;
      affected?: Array<{ resource: ResourceRef; metadata: EngineMetadata }>;
      /** Current proven copies of secondary effects; never retained in compact ACK history. */
      relatedSnapshots?: ResourceSnapshot[] }
  | { kind: 'conflict'; operationId: string; snapshot: ResourceSnapshot; conflicts: ConflictDetail[] }
  | { kind: 'deleted'; operationId: string; snapshot: ResourceSnapshot }
  | { kind: 'refused'; operationId: string; code: string }
  | { kind: 'blocked'; operationId: string; dependencies: string[] };

export interface CommandReceipt {
  owner: string;
  operationId: string;
  commandHash: string;
  result: CommandResult;
}

export type DeliveryState = 'queued' | 'sending' | 'unknown' | 'acknowledged' | 'conflict' | 'refused' | 'blocked';
export interface JournalEntry {
  command: DataCommand;
  state: DeliveryState;
  createdAt: number;
  attempts: number;
  result?: CommandResult;
}

export interface JournalStore {
  put(entry: JournalEntry): Promise<void>;
  remove(owner: string, operationId: string): Promise<void>;
  list(owner: string): Promise<JournalEntry[]>;
}

export interface EngineTransport {
  send(command: DataCommand): Promise<CommandResult>;
  read(owner: string, resource: ResourceRef): Promise<ResourceSnapshot>;
}

export interface CollectionPage {
  snapshots: ResourceSnapshot[];
  nextCursor: string | null;
  version: number;
  /** Legacy writers may still change this collection without a feed event (activation.ts). */
  legacyOpen?: boolean;
}

export interface CollectionChanges {
  snapshots: ResourceSnapshot[];
  cursor: number;
  version: number;
  hasMore: boolean;
  resetRequired?: boolean;
  /** Legacy writers may still change this collection without a feed event (activation.ts). */
  legacyOpen?: boolean;
}

export interface CollectionTransport {
  list(owner: string, collection: string, options?: { limit?: number; cursor?: string }): Promise<CollectionPage>;
  changes(owner: string, collection: string, after: number, options?: { limit?: number }): Promise<CollectionChanges>;
}
