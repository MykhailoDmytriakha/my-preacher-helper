import { StudyWorkspaceReviewBranchItem } from './studyNoteMetadataSummary';
import { StudyWorkspaceRelationData } from './studyNoteRelationSummary';

export interface StudyNoteSynthesisSummary {
  noteId: string;
  openQuestionCount: number;
  confirmedEvidenceCount: number;
  applicationReadyCount: number;
}

export interface StudyWorkspaceSynthesisBadge {
  relationKey: string;
  count: number;
}

export interface StudyWorkspaceSynthesisItem extends StudyWorkspaceReviewBranchItem {
  relationBadges: StudyWorkspaceSynthesisBadge[];
  relationTouchCount: number;
}

export interface StudyWorkspaceSynthesisLane {
  id: 'openQuestions' | 'confirmedEvidence' | 'applicationReady';
  totalItems: number;
  items: StudyWorkspaceSynthesisItem[];
}

export interface StudyWorkspaceSynthesisCounts {
  openQuestions: number;
  confirmedEvidence: number;
  applicationReady: number;
}

export interface StudyWorkspaceSynthesisData {
  noteSummaryByNoteId: Map<string, StudyNoteSynthesisSummary>;
  synthesisCounts: StudyWorkspaceSynthesisCounts;
  synthesisLanes: StudyWorkspaceSynthesisLane[];
}

interface BranchRelationCountAggregate {
  incoming: Record<string, number>;
  outgoing: Record<string, number>;
}

function incrementCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function buildBranchRelationCountMap(
  relationData: StudyWorkspaceRelationData
): Map<string, BranchRelationCountAggregate> {
  const relationCountsByBranchId = new Map<string, BranchRelationCountAggregate>();

  relationData.relationLanes.forEach((lane) => {
    lane.items.forEach((item) => {
      if (!item.isResolved) {
        return;
      }

      if (item.sourceBranchId) {
        const aggregate = relationCountsByBranchId.get(item.sourceBranchId) ?? {
          incoming: {},
          outgoing: {},
        };
        incrementCount(aggregate.outgoing, item.relationKey);
        relationCountsByBranchId.set(item.sourceBranchId, aggregate);
      }

      if (item.targetBranchId) {
        const aggregate = relationCountsByBranchId.get(item.targetBranchId) ?? {
          incoming: {},
          outgoing: {},
        };
        incrementCount(aggregate.incoming, item.relationKey);
        relationCountsByBranchId.set(item.targetBranchId, aggregate);
      }
    });
  });

  return relationCountsByBranchId;
}

function getRelationCount(
  aggregate: BranchRelationCountAggregate | undefined,
  direction: 'incoming' | 'outgoing',
  relationKey: string
): number {
  return aggregate?.[direction][relationKey] ?? 0;
}

function getRelationTouchCount(aggregate: BranchRelationCountAggregate | undefined): number {
  if (!aggregate) {
    return 0;
  }

  return Object.values(aggregate.incoming).reduce((total, count) => total + count, 0)
    + Object.values(aggregate.outgoing).reduce((total, count) => total + count, 0);
}

function buildQuestionBadges(
  aggregate: BranchRelationCountAggregate | undefined
): StudyWorkspaceSynthesisBadge[] {
  return [
    { relationKey: 'supports', count: getRelationCount(aggregate, 'incoming', 'supports') },
    { relationKey: 'expands', count: getRelationCount(aggregate, 'incoming', 'expands') },
    { relationKey: 'contrasts', count: getRelationCount(aggregate, 'incoming', 'contrasts') },
  ].filter((badge) => badge.count > 0);
}

function buildEvidenceBadges(
  aggregate: BranchRelationCountAggregate | undefined
): StudyWorkspaceSynthesisBadge[] {
  return [
    { relationKey: 'supports', count: getRelationCount(aggregate, 'outgoing', 'supports') },
    { relationKey: 'expands', count: getRelationCount(aggregate, 'outgoing', 'expands') },
    { relationKey: 'applies', count: getRelationCount(aggregate, 'outgoing', 'applies') },
  ].filter((badge) => badge.count > 0);
}

function buildApplicationBadges(
  aggregate: BranchRelationCountAggregate | undefined
): StudyWorkspaceSynthesisBadge[] {
  const appliesCount =
    getRelationCount(aggregate, 'incoming', 'applies')
    + getRelationCount(aggregate, 'outgoing', 'applies');

  return [
    { relationKey: 'applies', count: appliesCount },
    { relationKey: 'supports', count: getRelationCount(aggregate, 'incoming', 'supports') },
    { relationKey: 'expands', count: getRelationCount(aggregate, 'incoming', 'expands') },
  ].filter((badge) => badge.count > 0);
}

function compareByUpdatedAt(a: StudyWorkspaceReviewBranchItem, b: StudyWorkspaceReviewBranchItem): number {
  return new Date(b.noteUpdatedAt).getTime() - new Date(a.noteUpdatedAt).getTime();
}

function buildLaneItem(
  item: StudyWorkspaceReviewBranchItem,
  relationBadges: StudyWorkspaceSynthesisBadge[],
  relationTouchCount: number
): StudyWorkspaceSynthesisItem {
  return {
    ...item,
    relationBadges,
    relationTouchCount,
  };
}

export function buildStudyWorkspaceSynthesisData(
  visibleBranchInventory: StudyWorkspaceReviewBranchItem[],
  relationData: StudyWorkspaceRelationData
): StudyWorkspaceSynthesisData {
  const relationCountsByBranchId = buildBranchRelationCountMap(relationData);
  const openQuestionItems: StudyWorkspaceSynthesisItem[] = [];
  const confirmedEvidenceItems: StudyWorkspaceSynthesisItem[] = [];
  const applicationReadyItems: StudyWorkspaceSynthesisItem[] = [];
  const noteSummaryByNoteId = new Map<string, StudyNoteSynthesisSummary>();

  visibleBranchInventory.forEach((item) => {
    if (!item.isResolved) {
      return;
    }

    const aggregate = relationCountsByBranchId.get(item.branchId);
    const relationTouchCount = getRelationTouchCount(aggregate);
    const questionBadges = buildQuestionBadges(aggregate);
    const evidenceBadges = buildEvidenceBadges(aggregate);
    const applicationBadges = buildApplicationBadges(aggregate);
    const synthesisSummary = noteSummaryByNoteId.get(item.noteId) ?? {
      noteId: item.noteId,
      openQuestionCount: 0,
      confirmedEvidenceCount: 0,
      applicationReadyCount: 0,
    };

    if (item.branchKind === 'question' && item.branchStatus !== 'confirmed' && item.branchStatus !== 'resolved') {
      openQuestionItems.push(buildLaneItem(item, questionBadges, relationTouchCount));
      synthesisSummary.openQuestionCount += 1;
    }

    if (item.branchKind === 'evidence' && (item.branchStatus === 'confirmed' || item.branchStatus === 'resolved')) {
      confirmedEvidenceItems.push(buildLaneItem(item, evidenceBadges, relationTouchCount));
      synthesisSummary.confirmedEvidenceCount += 1;
    }

    if (
      item.branchKind === 'application'
      && (
        item.branchStatus === 'confirmed'
        || item.branchStatus === 'resolved'
        || applicationBadges.length > 0
      )
    ) {
      applicationReadyItems.push(buildLaneItem(item, applicationBadges, relationTouchCount));
      synthesisSummary.applicationReadyCount += 1;
    }

    if (
      synthesisSummary.openQuestionCount > 0
      || synthesisSummary.confirmedEvidenceCount > 0
      || synthesisSummary.applicationReadyCount > 0
    ) {
      noteSummaryByNoteId.set(item.noteId, synthesisSummary);
    }
  });

  openQuestionItems.sort((a, b) => {
    const aSupportCount = a.relationBadges.reduce((total, badge) => total + badge.count, 0);
    const bSupportCount = b.relationBadges.reduce((total, badge) => total + badge.count, 0);
    if (aSupportCount !== bSupportCount) {
      return aSupportCount - bSupportCount;
    }

    const updatedAtDelta = compareByUpdatedAt(a, b);
    if (updatedAtDelta !== 0) {
      return updatedAtDelta;
    }

    return a.branchTitle.localeCompare(b.branchTitle);
  });

  confirmedEvidenceItems.sort((a, b) => {
    if (b.relationTouchCount !== a.relationTouchCount) {
      return b.relationTouchCount - a.relationTouchCount;
    }

    const updatedAtDelta = compareByUpdatedAt(a, b);
    if (updatedAtDelta !== 0) {
      return updatedAtDelta;
    }

    return a.branchTitle.localeCompare(b.branchTitle);
  });

  applicationReadyItems.sort((a, b) => {
    if (b.relationTouchCount !== a.relationTouchCount) {
      return b.relationTouchCount - a.relationTouchCount;
    }

    const updatedAtDelta = compareByUpdatedAt(a, b);
    if (updatedAtDelta !== 0) {
      return updatedAtDelta;
    }

    return a.branchTitle.localeCompare(b.branchTitle);
  });

  return {
    noteSummaryByNoteId,
    synthesisCounts: {
      openQuestions: openQuestionItems.length,
      confirmedEvidence: confirmedEvidenceItems.length,
      applicationReady: applicationReadyItems.length,
    },
    synthesisLanes: [
      {
        id: 'openQuestions',
        totalItems: openQuestionItems.length,
        items: openQuestionItems,
      },
      {
        id: 'confirmedEvidence',
        totalItems: confirmedEvidenceItems.length,
        items: confirmedEvidenceItems,
      },
      {
        id: 'applicationReady',
        totalItems: applicationReadyItems.length,
        items: applicationReadyItems,
      },
    ],
  };
}
