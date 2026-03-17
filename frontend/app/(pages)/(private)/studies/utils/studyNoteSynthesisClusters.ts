import { StudyWorkspaceReviewBranchItem } from './studyNoteMetadataSummary';
import { StudyWorkspaceRelationData, StudyWorkspaceRelationItem } from './studyNoteRelationSummary';
import { StudyWorkspaceSynthesisItem } from './studyNoteSynthesisSummary';

export interface StudyWorkspaceSynthesisClusterLink extends StudyWorkspaceReviewBranchItem {
  relationKey: string;
}

export interface StudyWorkspaceQuestionSynthesisCluster {
  question: StudyWorkspaceSynthesisItem;
  supportLinks: StudyWorkspaceSynthesisClusterLink[];
  contrastLinks: StudyWorkspaceSynthesisClusterLink[];
  applicationLinks: StudyWorkspaceSynthesisClusterLink[];
}

function compareClusterLinks(
  a: StudyWorkspaceSynthesisClusterLink,
  b: StudyWorkspaceSynthesisClusterLink
): number {
  const updatedAtDelta = new Date(b.noteUpdatedAt).getTime() - new Date(a.noteUpdatedAt).getTime();

  if (updatedAtDelta !== 0) {
    return updatedAtDelta;
  }

  return a.branchTitle.localeCompare(b.branchTitle);
}

function buildClusterLink(
  questionBranchId: string,
  relationItem: StudyWorkspaceRelationItem,
  inventoryByBranchId: Map<string, StudyWorkspaceReviewBranchItem>
): StudyWorkspaceSynthesisClusterLink | null {
  if (!relationItem.isResolved) {
    return null;
  }

  if (relationItem.targetBranchId === questionBranchId && relationItem.sourceBranchId) {
    const sourceInventoryItem = inventoryByBranchId.get(relationItem.sourceBranchId);

    return {
      noteId: relationItem.sourceNoteId,
      noteTitle: sourceInventoryItem?.noteTitle ?? relationItem.sourceNoteTitle,
      branchId: relationItem.sourceBranchId,
      branchTitle: sourceInventoryItem?.branchTitle ?? relationItem.sourceBranchTitle,
      isResolved: sourceInventoryItem?.isResolved ?? true,
      branchKind: sourceInventoryItem?.branchKind ?? null,
      branchStatus: sourceInventoryItem?.branchStatus ?? null,
      semanticLabel: sourceInventoryItem?.semanticLabel ?? null,
      noteUpdatedAt: sourceInventoryItem?.noteUpdatedAt ?? relationItem.sourceUpdatedAt,
      relationKey: relationItem.relationKey,
    };
  }

  if (relationItem.sourceBranchId === questionBranchId && relationItem.targetNoteId) {
    const targetInventoryItem = inventoryByBranchId.get(relationItem.targetBranchId);

    return {
      noteId: relationItem.targetNoteId,
      noteTitle: targetInventoryItem?.noteTitle ?? relationItem.targetNoteTitle,
      branchId: relationItem.targetBranchId,
      branchTitle: targetInventoryItem?.branchTitle ?? relationItem.targetBranchTitle,
      isResolved: targetInventoryItem?.isResolved ?? relationItem.isResolved,
      branchKind: targetInventoryItem?.branchKind ?? null,
      branchStatus: targetInventoryItem?.branchStatus ?? null,
      semanticLabel: targetInventoryItem?.semanticLabel ?? null,
      noteUpdatedAt: targetInventoryItem?.noteUpdatedAt ?? relationItem.sourceUpdatedAt,
      relationKey: relationItem.relationKey,
    };
  }

  return null;
}

function collectClusterLinks(
  questionBranchId: string,
  relationItems: StudyWorkspaceRelationItem[],
  inventoryByBranchId: Map<string, StudyWorkspaceReviewBranchItem>
): StudyWorkspaceSynthesisClusterLink[] {
  const seenLinks = new Set<string>();
  const clusterLinks: StudyWorkspaceSynthesisClusterLink[] = [];

  relationItems.forEach((relationItem) => {
    const clusterLink = buildClusterLink(questionBranchId, relationItem, inventoryByBranchId);

    if (!clusterLink) {
      return;
    }

    const dedupeKey = `${clusterLink.branchId}:${clusterLink.relationKey}`;
    if (seenLinks.has(dedupeKey)) {
      return;
    }

    seenLinks.add(dedupeKey);
    clusterLinks.push(clusterLink);
  });

  return clusterLinks.sort(compareClusterLinks);
}

export function buildStudyWorkspaceQuestionSynthesisClusters(
  openQuestionItems: StudyWorkspaceSynthesisItem[],
  workspaceBranchInventory: StudyWorkspaceReviewBranchItem[],
  relationData: StudyWorkspaceRelationData
): StudyWorkspaceQuestionSynthesisCluster[] {
  const inventoryByBranchId = new Map(
    workspaceBranchInventory.map((item) => [item.branchId, item])
  );
  const resolvedRelationItems = relationData.relationLanes.flatMap((lane) =>
    lane.items.filter((item) => item.isResolved)
  );

  return openQuestionItems.map((questionItem) => {
    const supportItems = resolvedRelationItems.filter((item) =>
      item.targetBranchId === questionItem.branchId
      && (item.relationKey === 'supports' || item.relationKey === 'expands')
    );
    const contrastItems = resolvedRelationItems.filter((item) =>
      item.relationKey === 'contrasts'
      && (item.targetBranchId === questionItem.branchId || item.sourceBranchId === questionItem.branchId)
    );
    const applicationItems = resolvedRelationItems.filter((item) =>
      item.relationKey === 'applies'
      && (item.targetBranchId === questionItem.branchId || item.sourceBranchId === questionItem.branchId)
    );

    return {
      question: questionItem,
      supportLinks: collectClusterLinks(questionItem.branchId, supportItems, inventoryByBranchId),
      contrastLinks: collectClusterLinks(questionItem.branchId, contrastItems, inventoryByBranchId),
      applicationLinks: collectClusterLinks(questionItem.branchId, applicationItems, inventoryByBranchId),
    };
  });
}
