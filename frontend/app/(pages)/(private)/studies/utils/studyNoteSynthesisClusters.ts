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

export type StudyWorkspaceQuestionSynthesisClusterGroupMode = 'workflow' | 'theme';

export interface StudyWorkspaceQuestionSynthesisClusterGroup {
  id: string;
  label: string;
  totalClusters: number;
  clusters: StudyWorkspaceQuestionSynthesisCluster[];
}

function buildClusterThemeGroupId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unlabeled';
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

  return openQuestionItems.flatMap((questionItem) => {
    if (!questionItem.isResolved) {
      return [];
    }

    const supportItems = resolvedRelationItems.filter((item) =>
      // Questions receive support from linked branches; outgoing support links from the
      // question itself are intentionally not treated as supporting evidence here.
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

    return [{
      question: questionItem,
      supportLinks: collectClusterLinks(questionItem.branchId, supportItems, inventoryByBranchId),
      contrastLinks: collectClusterLinks(questionItem.branchId, contrastItems, inventoryByBranchId),
      applicationLinks: collectClusterLinks(questionItem.branchId, applicationItems, inventoryByBranchId),
    }];
  });
}

export function buildStudyWorkspaceQuestionSynthesisClusterGroups(
  clusters: StudyWorkspaceQuestionSynthesisCluster[],
  mode: StudyWorkspaceQuestionSynthesisClusterGroupMode
): StudyWorkspaceQuestionSynthesisClusterGroup[] {
  if (mode === 'workflow') {
    const needsEvidence: StudyWorkspaceQuestionSynthesisCluster[] = [];
    const hasSupport: StudyWorkspaceQuestionSynthesisCluster[] = [];
    const readyToApply: StudyWorkspaceQuestionSynthesisCluster[] = [];

    clusters.forEach((cluster) => {
      if (cluster.applicationLinks.length > 0) {
        readyToApply.push(cluster);
        return;
      }

      if (cluster.supportLinks.length > 0) {
        hasSupport.push(cluster);
        return;
      }

      needsEvidence.push(cluster);
    });

    return [
      { id: 'needsEvidence', label: 'needsEvidence', totalClusters: needsEvidence.length, clusters: needsEvidence },
      { id: 'hasSupport', label: 'hasSupport', totalClusters: hasSupport.length, clusters: hasSupport },
      { id: 'readyToApply', label: 'readyToApply', totalClusters: readyToApply.length, clusters: readyToApply },
    ].filter((group) => group.totalClusters > 0);
  }

  const themeGroups = new Map<string, { label: string; clusters: StudyWorkspaceQuestionSynthesisCluster[] }>();

  clusters.forEach((cluster) => {
    const rawThemeLabel = cluster.question.semanticLabel?.trim();
    const normalizedThemeKey = rawThemeLabel?.toLowerCase() || 'unlabeled';
    const existingGroup = themeGroups.get(normalizedThemeKey) ?? {
      label: rawThemeLabel || 'unlabeled',
      clusters: [],
    };
    existingGroup.clusters.push(cluster);
    themeGroups.set(normalizedThemeKey, existingGroup);
  });

  return Array.from(themeGroups.entries())
    .sort((a, b) => {
      if (a[0] === 'unlabeled') {
        return 1;
      }
      if (b[0] === 'unlabeled') {
        return -1;
      }
      return a[1].label.localeCompare(b[1].label);
    })
    .map(([normalizedThemeKey, group]) => ({
      id: buildClusterThemeGroupId(normalizedThemeKey),
      label: group.label,
      totalClusters: group.clusters.length,
      clusters: group.clusters,
    }));
}
