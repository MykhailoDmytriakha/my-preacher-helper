/** The wire contract is shared by browser and server; it imports no transport. */
import type { AccountPreferenceField, AccountPreferenceStamps } from './accountPreference';
import type { ActionTime } from './actionClock';
import type { CommentKindCapture, CommentKindStamp } from './commentKindAction';
import type { CouncilAssemblyActions, CouncilAssemblyCapture } from './councilAssemblyAction';
import type { CouncilOutcomeWire } from './councilOutcomeAction';
import type { CouncilTopicKindActions, CouncilTopicKindCapture } from './councilTopicKindAction';
import type { DatedRowActionEvidence } from './datedRowAction';
import type { DocumentFieldAction, DocumentFieldObservation, DocumentFieldStamp, PlanTemplateNameCapture, PrayerTitleCapture, SermonPlanModeCapture, SermonPlanModeStamp, StudyNoteTitleCapture, StudyNoteTypeCapture, ServiceOrderTitleCapture, TagColorCapture } from './documentFieldAction';
import type { DocumentTagIntent } from './documentTagCapture';
import type { ExegeticalPointStamp } from './exegeticalPointAction';
import type { ExegeticalPointEdit } from './exegeticalPointCapture';
import type { GroupMeetingFieldActions } from './groupMeetingFieldAction';
import type { SeriesMembershipCapture } from './membershipIntent';
import type { PrayerStatusCapture } from './prayerStatusAction';
import type { PreachDateFieldActions } from './preachDateFieldAction';
import type { PreachStatusAction } from './preachStatusAction';
import type { AutosaveRowFieldActions } from './rowFieldAutosave';
import type { SeriesFieldStamps } from './seriesFieldAction';
import type { SeriesMembershipComparison } from './seriesMembershipHistory';
import type { SermonChurchFill } from './sermonChurchFill';
import type { ServiceOrderFlagActions, ServiceOrderFlagCapture, ServiceOrderStepTitleActions, ServiceOrderStepTitleCapture } from './serviceOrderStepAction';
import type { ShownCopy } from './session';
import type { TagMembershipAction, TagMembershipWire } from './tagMembershipOrder';
import type { ThoughtTagAction } from './thoughtTagAction';
import type { OutlinePointGap, OutlinePointOrder } from '@/utils/outlineDnd';
import type { PreparationConfirmation } from '@/utils/preparationFieldValues';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type DocumentData = Record<string, Json>;

export interface ResourceRef {
  collection: string;
  id: string;
}

/** What a background failure is about: a document, a whole collection, or — absent — nothing in particular. */
export interface FailureAddress {
  collection: string;
  id?: string;
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

export type EditorCommitAction =
  | { kind: 'bible-mark-stroke'; time: ActionTime }
  | (ExegeticalPointEdit & { time: ActionTime | null; shown?: ShownCopy })
  | { kind: 'sermon-plan-mode'; mode: SermonPlanModeCapture }
  | { kind: 'account-preference'; time: ActionTime | null; fields?: readonly AccountPreferenceField[] }
  | { kind: 'sermon-preparation-check'; field: PreparationConfirmation; time: ActionTime | null }
  | { kind: 'thought-placement'; rowId: string; time: ActionTime | null; shown?: ShownCopy }
  | { kind: 'service-order-placement'; move: ServiceOrderPlacementCapture }
  | { kind: 'service-order-step-placement'; move: ServiceOrderStepPlacementCapture }
  | { kind: 'outline-point-placement'; move: OutlinePointPlacementCapture }
  | { kind: 'service-order-title'; title: ServiceOrderTitleCapture }
  | { kind: 'service-order-flag'; flag: ServiceOrderFlagCapture }
  | { kind: 'service-order-step-title'; title: ServiceOrderStepTitleCapture }
  | { kind: 'council-lifecycle'; time: ActionTime | null }
  | { kind: 'council-assembly'; flag: CouncilAssemblyCapture }
  | { kind: 'council-topic-kind'; topicKind: CouncilTopicKindCapture }
  | { kind: 'prayer-title'; title: PrayerTitleCapture; tagMembership?: readonly DocumentTagIntent[] }
  | { kind: 'study-note-title'; title: StudyNoteTitleCapture; type?: StudyNoteTypeCapture; tagMembership?: readonly DocumentTagIntent[] }
  | { kind: 'study-note-type'; type: StudyNoteTypeCapture; tagMembership?: readonly DocumentTagIntent[] }
  | { kind: 'comment-kind'; commentKind: CommentKindCapture }
  | { kind: 'document-tags'; tagMembership: readonly DocumentTagIntent[] }
  | { kind: 'plan-template-name'; name: PlanTemplateNameCapture }
  | { kind: 'tag-color'; color: TagColorCapture }
  | { kind: 'prayer-status'; status: PrayerStatusCapture };

export type OutlinePointPlacement = {
  pointId: string;
  opening: OutlinePointGap;
  destination: OutlinePointGap;
  observedRevision: number;
  time: ActionTime | null;
  predecessorOperationId?: string;
};

export type OutlinePointPlacementCapture = {
  generation: string | null;
  before: OutlinePointOrder;
  after: OutlinePointOrder;
  placement: OutlinePointPlacement;
};

export type OutlinePointPlacementHistoryPage = {
  owner: string;
  sermonId: string;
  generation: string;
  entries: { id: string; pointId: string; earlier: OutlinePointGap; kept: OutlinePointGap; acceptedAt: string }[];
  nextCursor: string | null;
};

export type ServiceOrderStepGap = { previous: string | null; next: string | null };
export type ServiceOrderStepPlacement = {
  stepId: string;
  opening: ServiceOrderStepGap;
  destination: ServiceOrderStepGap;
  observedRevision: number;
  time: ActionTime | null;
  predecessorOperationId?: string;
};
export type ServiceOrderPlacementAnchor = { id: string; generation: string | null };
export type ServiceOrderPlacementGap = { previous: ServiceOrderPlacementAnchor | null; next: ServiceOrderPlacementAnchor | null };
export type ServiceOrderPlacement = {
  observedRevision: number;
  time: ActionTime | null;
  predecessorOperationId?: string;
  opening: ServiceOrderPlacementGap;
  destination: ServiceOrderPlacementGap;
};

export type LabeledServiceOrderPlacement = {
  previous: (ServiceOrderPlacementAnchor & { title?: string }) | null;
  next: (ServiceOrderPlacementAnchor & { title?: string }) | null;
};
export type ServiceOrderPlacementComparison = {
  step?: { id: string; title?: string };
  mine: LabeledServiceOrderPlacement;
  saved: LabeledServiceOrderPlacement | null;
  available: boolean;
};
export type ServiceOrderPlacementHistoryPage = {
  owner: string;
  orderId: string;
  generation: string;
  entries: {
    id: string;
    earlier: LabeledServiceOrderPlacement;
    kept: LabeledServiceOrderPlacement;
    acceptedAt: string;
    stepId?: string;
    stepTitle?: string;
  }[];
  nextCursor: string | null;
};

export type ServiceOrderPlacementCapture = {
  generation: string | null;
  before: FieldValue;
  rank: number;
  afterRequests?: string[];
  placement: ServiceOrderPlacement;
};

export type ServiceOrderStepPlacementCapture = {
  generation: string | null;
  shownIds: string[];
  placement: ServiceOrderStepPlacement;
};

export type BibleMarkStrokeStamp = { observedRevision: number; time: ActionTime; predecessorOperationId?: string };

export type DataCommand = CommandBase & (
  | { kind: 'create'; value: DocumentData; bibleMarkStroke?: BibleMarkStrokeStamp }
  | { kind: 'relation'; relation: 'service-order-seed'; value: DocumentData }
  | { kind: 'update'; changes: FieldChange[];
      preachDateAction?: DatedRowActionEvidence;
      meetingDateAction?: DatedRowActionEvidence;
      groupMeetingFieldActions?: GroupMeetingFieldActions;
      preachDateFieldActions?: PreachDateFieldActions;
      preachStatusActions?: PreachStatusAction[];
      bibleMarkStroke?: BibleMarkStrokeStamp;
      serviceOrderTitleAction?: DocumentFieldAction;
      serviceOrderFlagActions?: ServiceOrderFlagActions;
      serviceOrderStepTitleActions?: ServiceOrderStepTitleActions;
      councilAssemblyActions?: CouncilAssemblyActions;
      councilTopicKindActions?: CouncilTopicKindActions;
      councilOutcomeActions?: CouncilOutcomeWire[];
      prayerTitleAction?: DocumentFieldObservation;
      studyNoteTitleAction?: DocumentFieldStamp;
      studyNoteTypeAction?: DocumentFieldStamp;
      commentKindAction?: CommentKindStamp;
      planTemplateNameAction?: DocumentFieldStamp;
      tagColorAction?: DocumentFieldStamp;
      prayerStatusAction?: DocumentFieldObservation;
      prayerAnsweredAtAction?: DocumentFieldStamp;
      sermonTitleAction?: DocumentFieldObservation;
      sermonVerseAction?: DocumentFieldStamp;
      sermonChurchAction?: DocumentFieldStamp;
      sermonGoalTypeAction?: DocumentFieldStamp;
      sermonPlanModeAction?: SermonPlanModeStamp;
      accountPreferenceActions?: AccountPreferenceStamps;
      serviceOrderPlacement?: ServiceOrderPlacement;
      serviceOrderStepPlacement?: ServiceOrderStepPlacement;
      outlinePointPlacement?: OutlinePointPlacement;
      sermonPreparationCheckActions?: Partial<Record<PreparationConfirmation, DocumentFieldStamp>>;
      sermonChurchFill?: SermonChurchFill;
      exegeticalPlanActions?: ExegeticalPointStamp[];
      thoughtTagActions?: TagMembershipWire<ThoughtTagAction>[];
      tagMembershipActions?: TagMembershipWire<TagMembershipAction>[];
      seriesFieldActions?: SeriesFieldStamps;
      groupTitleAction?: DocumentFieldAction;
      groupStatusAction?: DocumentFieldAction;
      councilTitleAction?: DocumentFieldObservation;
      councilDateAction?: DocumentFieldStamp;
      councilLifecycleAction?: DocumentFieldStamp;
      /** Exact plan cells observed before an explicit outline removal. */
      observedPlanTextRemoval?: Record<string, string>;
      /** Exact orphaned text explicitly cleared while its point was absent. */
      observedPlanTextDiscard?: Record<string, string> } & Omit<AutosaveRowFieldActions, 'councilOutcomeActions'>
  | { kind: 'delete'; baseline: DocumentData }
  | { kind: 'relation'; relation: 'material-notes'; beforeNoteIds: string[]; afterNoteIds: string[];
      targets: Array<{ id: string; generation: string | null }> }
  | { kind: 'relation'; relation: 'series-membership'; edits: Array<{
      resource: ResourceRef; generation: string | null; beforeItems: DocumentData[]; afterItems: DocumentData[];
      membership?: SeriesMembershipCapture & { predecessorOperationId?: string };
    }> }
  /** Creating a member in a series is one effect, including when the response is lost. */
  | { kind: 'relation'; relation: 'series-member-create'; value: DocumentData; edit: {
      resource: ResourceRef; generation: string | null; beforeItems: DocumentData[]; afterItems: DocumentData[];
    } }
  /** Server-owned share-link capability creation, tied to the note version the person saw. */
  | { kind: 'relation'; relation: 'share-link-create'; note: { id: string; generation: string | null; shareRevocation?: string | null };
      authorLanguage: 'en' | 'ru' | 'uk' }
  /** Revoke exactly the capability addressed by the unversioned resource ID. */
  | { kind: 'relation'; relation: 'share-link-revoke' }
  /** Carrying a section between two councils: the source is marked carried only because it landed. */
  | { kind: 'relation'; relation: 'council-carry'; edits: Array<{
      resource: ResourceRef; generation: string | null; beforeTopics: DocumentData[]; afterTopics: DocumentData[];
      /** Only the absent destination can be created by this same action. */
      create?: DocumentData;
    }> }
  /** A source analysis changes extent with its removed authored words landed in adjacent analyses. */
  | { kind: 'relation'; relation: 'analysis-reshape'; edits: Array<{
      resource: ResourceRef; generation: string | null; changes: FieldChange[]; create?: DocumentData;
    }> }
);

export interface EngineMetadata {
  protocol: 1;
  generation: string;
  revision: number;
  deleted: boolean;
  /** Identifies our own server-confirmed change before its HTTP acknowledgement arrives. */
  operationId?: string;
  /** Latest committed revocation for this note, independent of its authored content. */
  shareRevocation?: string;
}

export interface ResourceSnapshot {
  resource: ResourceRef;
  /** Deleted and absent documents never masquerade as live data. */
  value: DocumentData | null;
  metadata: EngineMetadata | null;
}

export interface ConflictDetail {
  path: string[];
  code?: string;
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
  | { kind: 'conflict'; operationId: string; snapshot: ResourceSnapshot; conflicts: ConflictDetail[]; serviceOrderPlacementComparison?: ServiceOrderPlacementComparison }
  | { kind: 'deleted'; operationId: string; snapshot: ResourceSnapshot }
  | { kind: 'refused'; operationId: string; code: string; seriesMembershipComparisons?: SeriesMembershipComparison[] }
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

export interface EngineReadOptions {
  /** Require a new URL so an older worker cannot answer from its API cache. */
  fresh?: boolean;
}

export interface EngineTransport {
  send(command: DataCommand): Promise<CommandResult>;
  read(owner: string, resource: ResourceRef, options?: EngineReadOptions): Promise<ResourceSnapshot>;
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
