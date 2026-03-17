import {
  StudyNote,
  StudyNoteBranchKind,
  StudyNoteBranchState,
  StudyNoteBranchStatus,
} from '@/models/models';

import { flattenHydratedStudyNoteOutlineBranches, hydrateStudyNoteBranchIdentity } from '../components/studyNoteBranchIdentity';
import { parseStudyNoteOutline } from '../components/studyNoteOutline';

export interface StudyNoteMetadataSummary {
  noteId: string;
  branchCount: number;
  labeledBranchCount: number;
  branchKindCounts: Partial<Record<StudyNoteBranchKind, number>>;
  branchStatusCounts: Partial<Record<StudyNoteBranchStatus, number>>;
  semanticLabels: string[];
}

export type StudyNoteMetadataLabelFilter = 'all' | 'labeled';

export interface StudyWorkspaceMetadataCounts {
  notesWithMetadata: number;
  labeledNotes: number;
  kindNoteCounts: Partial<Record<StudyNoteBranchKind, number>>;
  statusNoteCounts: Partial<Record<StudyNoteBranchStatus, number>>;
}

export interface StudyWorkspaceTopSemanticLabel {
  label: string;
  noteCount: number;
}

export interface StudyWorkspaceReviewBranchItem {
  noteId: string;
  noteTitle: string;
  branchId: string;
  branchTitle: string;
  isResolved: boolean;
  branchKind?: StudyNoteBranchKind | null;
  branchStatus?: StudyNoteBranchStatus | null;
  semanticLabel?: string | null;
  noteUpdatedAt: string;
}

export interface StudyWorkspaceReviewLane {
  id: 'evidence' | 'question' | 'confirmed' | 'application' | 'labeled';
  totalItems: number;
  items: StudyWorkspaceReviewBranchItem[];
}

function incrementCount<T extends string>(counts: Partial<Record<T, number>>, key: T) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function buildLiveBranchLookup(note: StudyNote, branchState: StudyNoteBranchState) {
  const parsedOutline = parseStudyNoteOutline(note.content ?? '');
  const hydratedOutline = hydrateStudyNoteBranchIdentity(parsedOutline.branches, branchState.branchRecords);

  return new Map(
    flattenHydratedStudyNoteOutlineBranches(hydratedOutline.branches)
      .filter((branch) => Boolean(branch.branchId))
      .map((branch) => [branch.branchId!, branch])
  );
}

export function summarizeStudyNoteBranchState(
  branchState: StudyNoteBranchState | null | undefined
): StudyNoteMetadataSummary | null {
  if (!branchState) {
    return null;
  }

  const branchKindCounts: Partial<Record<StudyNoteBranchKind, number>> = {};
  const branchStatusCounts: Partial<Record<StudyNoteBranchStatus, number>> = {};
  const semanticLabels = new Set<string>();
  let labeledBranchCount = 0;

  branchState.branchRecords.forEach((record) => {
    if (record.branchKind) {
      incrementCount(branchKindCounts, record.branchKind);
    }

    if (record.branchStatus) {
      incrementCount(branchStatusCounts, record.branchStatus);
    }

    const normalizedLabel = record.semanticLabel?.trim();
    if (normalizedLabel) {
      labeledBranchCount += 1;
      semanticLabels.add(normalizedLabel);
    }
  });

  return {
    noteId: branchState.noteId,
    branchCount: branchState.branchRecords.length,
    labeledBranchCount,
    branchKindCounts,
    branchStatusCounts,
    semanticLabels: Array.from(semanticLabels).sort((a, b) => a.localeCompare(b)),
  };
}

export function buildStudyNoteMetadataSummaryMap(
  branchStates: StudyNoteBranchState[]
): Map<string, StudyNoteMetadataSummary> {
  const summaryMap = new Map<string, StudyNoteMetadataSummary>();

  branchStates.forEach((branchState) => {
    const summary = summarizeStudyNoteBranchState(branchState);
    if (summary) {
      summaryMap.set(summary.noteId, summary);
    }
  });

  return summaryMap;
}

export function noteMatchesStudyMetadataFilters(
  summary: StudyNoteMetadataSummary | undefined,
  {
    kindFilter = '',
    statusFilter = '',
    labelFilter = 'all',
  }: {
    kindFilter?: StudyNoteBranchKind | '';
    statusFilter?: StudyNoteBranchStatus | '';
    labelFilter?: StudyNoteMetadataLabelFilter;
  }
): boolean {
  if (!kindFilter && !statusFilter && labelFilter === 'all') {
    return true;
  }

  if (!summary) {
    return false;
  }

  if (kindFilter && (summary.branchKindCounts[kindFilter] ?? 0) === 0) {
    return false;
  }

  if (statusFilter && (summary.branchStatusCounts[statusFilter] ?? 0) === 0) {
    return false;
  }

  if (labelFilter === 'labeled' && summary.semanticLabels.length === 0) {
    return false;
  }

  return true;
}

export function buildStudyWorkspaceMetadataCounts(
  notes: StudyNote[],
  metadataSummaryByNoteId: Map<string, StudyNoteMetadataSummary>
): StudyWorkspaceMetadataCounts {
  const kindNoteCounts: Partial<Record<StudyNoteBranchKind, number>> = {};
  const statusNoteCounts: Partial<Record<StudyNoteBranchStatus, number>> = {};
  let notesWithMetadata = 0;
  let labeledNotes = 0;

  notes.forEach((note) => {
    const summary = metadataSummaryByNoteId.get(note.id);
    if (!summary || summary.branchCount === 0) {
      return;
    }

    notesWithMetadata += 1;

    if (summary.semanticLabels.length > 0) {
      labeledNotes += 1;
    }

    Object.entries(summary.branchKindCounts).forEach(([kind, count]) => {
      if ((count ?? 0) > 0) {
        incrementCount(kindNoteCounts, kind as StudyNoteBranchKind);
      }
    });

    Object.entries(summary.branchStatusCounts).forEach(([status, count]) => {
      if ((count ?? 0) > 0) {
        incrementCount(statusNoteCounts, status as StudyNoteBranchStatus);
      }
    });
  });

  return {
    notesWithMetadata,
    labeledNotes,
    kindNoteCounts,
    statusNoteCounts,
  };
}

export function buildStudyNoteMetadataSearchText(
  summary: StudyNoteMetadataSummary | undefined
): string {
  if (!summary) {
    return '';
  }

  return [
    ...Object.keys(summary.branchKindCounts),
    ...Object.keys(summary.branchStatusCounts),
    ...summary.semanticLabels,
  ]
    .join(' ')
    .toLowerCase();
}

export function buildStudyWorkspaceTopSemanticLabels(
  notes: StudyNote[],
  metadataSummaryByNoteId: Map<string, StudyNoteMetadataSummary>,
  limit: number = 6
): StudyWorkspaceTopSemanticLabel[] {
  const labelCounts = new Map<string, number>();

  notes.forEach((note) => {
    const summary = metadataSummaryByNoteId.get(note.id);
    if (!summary || summary.semanticLabels.length === 0) {
      return;
    }

    summary.semanticLabels.forEach((label) => {
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    });
  });

  return Array.from(labelCounts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(([label, noteCount]) => ({ label, noteCount }));
}

export function buildStudyWorkspaceBranchReviewInventory(
  notes: StudyNote[],
  branchStates: StudyNoteBranchState[]
): StudyWorkspaceReviewBranchItem[] {
  const branchStateByNoteId = new Map(
    branchStates.map((branchState) => [branchState.noteId, branchState])
  );
  const inventoryItems: StudyWorkspaceReviewBranchItem[] = [];

  notes.forEach((note) => {
    const branchState = branchStateByNoteId.get(note.id);

    if (!branchState) {
      return;
    }

    const liveBranchesById = buildLiveBranchLookup(note, branchState);

    branchState.branchRecords.forEach((record) => {
      const liveBranch = liveBranchesById.get(record.branchId);
      inventoryItems.push({
        noteId: note.id,
        noteTitle: note.title || '',
        branchId: record.branchId,
        branchTitle: liveBranch?.title ?? record.title,
        isResolved: Boolean(liveBranch),
        branchKind: liveBranch?.branchKind ?? record.branchKind,
        branchStatus: liveBranch?.branchStatus ?? record.branchStatus,
        semanticLabel: liveBranch?.semanticLabel ?? record.semanticLabel,
        noteUpdatedAt: note.updatedAt,
      });
    });
  });

  return inventoryItems;
}

export function buildStudyWorkspaceReviewLanesFromInventory(
  inventoryItems: StudyWorkspaceReviewBranchItem[]
): StudyWorkspaceReviewLane[] {
  const laneMatchers: Array<{
    id: StudyWorkspaceReviewLane['id'];
    matches: (item: Pick<StudyWorkspaceReviewBranchItem, 'branchKind' | 'branchStatus' | 'semanticLabel'>) => boolean;
  }> = [
    {
      id: 'evidence',
      matches: (item) => item.branchKind === 'evidence',
    },
    {
      id: 'question',
      matches: (item) => item.branchKind === 'question',
    },
    {
      id: 'confirmed',
      matches: (item) => item.branchStatus === 'confirmed',
    },
    {
      id: 'application',
      matches: (item) => item.branchKind === 'application',
    },
    {
      id: 'labeled',
      matches: (item) => Boolean(item.semanticLabel?.trim()),
    },
  ];

  return laneMatchers.map(({ id, matches }) => {
    const laneItems = inventoryItems.filter((item) => matches(item));

    return {
      id,
      totalItems: laneItems.length,
      items: laneItems,
    };
  });
}

export function buildStudyWorkspaceReviewLanes(
  notes: StudyNote[],
  branchStates: StudyNoteBranchState[]
): StudyWorkspaceReviewLane[] {
  return buildStudyWorkspaceReviewLanesFromInventory(
    buildStudyWorkspaceBranchReviewInventory(notes, branchStates)
  );
}
