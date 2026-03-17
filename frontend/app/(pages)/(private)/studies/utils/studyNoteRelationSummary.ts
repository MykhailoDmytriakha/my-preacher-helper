import { StudyNote, StudyNoteBranchState } from '@/models/models';
import {
  buildStudyNoteBranchRelationSearchTerms,
  extractStudyNoteBranchMarkdownReferences,
  getStudyNoteBranchRelationTranslationKey,
  normalizeStudyNoteBranchRelationKey,
} from '@/utils/studyNoteBranchLinks';

import { flattenHydratedStudyNoteOutlineBranches, hydrateStudyNoteBranchIdentity } from '../components/studyNoteBranchIdentity';
import { type StudyNoteOutlineBranch, parseStudyNoteOutline } from '../components/studyNoteOutline';

export interface StudyNoteRelationSummary {
  noteId: string;
  totalRelations: number;
  relationCounts: Record<string, number>;
  relationLabels: string[];
  normalizedRelationLabels: string[];
}

export interface StudyWorkspaceTopRelationLabel {
  label: string;
  relationKey: string;
  relationCount: number;
  noteCount: number;
}

export interface StudyWorkspaceRelationItem {
  relationLabel: string;
  relationKey: string;
  sourceNoteId: string;
  sourceNoteTitle: string;
  sourceBranchId?: string;
  sourceBranchTitle: string;
  targetNoteId: string | null;
  targetNoteTitle: string;
  targetBranchId: string;
  targetBranchTitle: string;
  sourceUpdatedAt: string;
  isResolved: boolean;
}

export interface StudyWorkspaceRelationLane {
  relationLabel: string;
  relationKey: string;
  totalItems: number;
  items: StudyWorkspaceRelationItem[];
}

export interface StudyWorkspaceRelationData {
  relationSummaryByNoteId: Map<string, StudyNoteRelationSummary>;
  topRelationLabels: StudyWorkspaceTopRelationLabel[];
  relationLanes: StudyWorkspaceRelationLane[];
}

interface RelationLabelAggregate {
  label: string;
  relationCount: number;
  noteIds: Set<string>;
}

interface HydratedNoteSnapshot {
  note: StudyNote;
  flatBranches: StudyNoteOutlineBranch[];
}

interface LiveBranchTarget {
  noteId: string;
  noteTitle: string;
  branch: StudyNoteOutlineBranch;
}

function sortLabels(a: string, b: string): number {
  return a.localeCompare(b);
}

function getStableRelationLabel(rawRelationLabel: string, relationKey: string): string {
  return getStudyNoteBranchRelationTranslationKey(relationKey) ? relationKey : rawRelationLabel;
}

function buildHydratedNoteSnapshots(
  notes: StudyNote[],
  branchStates: StudyNoteBranchState[]
): HydratedNoteSnapshot[] {
  const branchStateByNoteId = new Map(
    branchStates.map((branchState) => [branchState.noteId, branchState])
  );

  return notes.map((note) => {
    const branchState = branchStateByNoteId.get(note.id);
    const parsedOutline = parseStudyNoteOutline(note.content ?? '');
    const hydratedOutline = hydrateStudyNoteBranchIdentity(parsedOutline.branches, branchState?.branchRecords ?? []);

    return {
      note,
      flatBranches: flattenHydratedStudyNoteOutlineBranches(hydratedOutline.branches),
    };
  });
}

export function buildStudyNoteRelationSearchText(
  summary: StudyNoteRelationSummary | undefined
): string {
  if (!summary) {
    return '';
  }

  return Array.from(
    new Set(
      summary.normalizedRelationLabels.flatMap((relationLabel) =>
        buildStudyNoteBranchRelationSearchTerms(relationLabel)
      )
    )
  ).join(' ');
}

export function noteMatchesStudyRelationFilter(
  summary: StudyNoteRelationSummary | undefined,
  relationLabelFilter: string
): boolean {
  const normalizedRelationFilter =
    normalizeStudyNoteBranchRelationKey(relationLabelFilter)
    ?? (relationLabelFilter.replace(/\s+/g, ' ').trim().toLowerCase() || null);

  if (!normalizedRelationFilter) {
    return true;
  }

  if (!summary) {
    return false;
  }

  return summary.normalizedRelationLabels.includes(normalizedRelationFilter);
}

interface BuildStudyWorkspaceRelationDataOptions {
  liveTargetNotes?: StudyNote[];
}

function upsertNoteRelationAggregate(
  noteRelationAggregatesByNoteId: Map<string, Map<string, { label: string; count: number }>>,
  noteId: string,
  relationKey: string,
  relationLabel: string
): void {
  const noteAggregates = noteRelationAggregatesByNoteId.get(noteId) ?? new Map<string, { label: string; count: number }>();
  const aggregate = noteAggregates.get(relationKey);

  if (aggregate) {
    aggregate.count += 1;
  } else {
    noteAggregates.set(relationKey, {
      label: relationLabel,
      count: 1,
    });
  }

  noteRelationAggregatesByNoteId.set(noteId, noteAggregates);
}

export function buildStudyWorkspaceRelationData(
  notes: StudyNote[],
  branchStates: StudyNoteBranchState[],
  options: BuildStudyWorkspaceRelationDataOptions = {}
): StudyWorkspaceRelationData {
  const noteSnapshots = buildHydratedNoteSnapshots(notes, branchStates);
  const liveTargetSnapshots = options.liveTargetNotes
    ? buildHydratedNoteSnapshots(options.liveTargetNotes, branchStates)
    : noteSnapshots;
  const liveTargetsByBranchId = new Map<string, LiveBranchTarget>();
  const relationSummaryByNoteId = new Map<string, StudyNoteRelationSummary>();
  const laneMap = new Map<string, { label: string; items: StudyWorkspaceRelationItem[] }>();
  const relationLabelAggregates = new Map<string, RelationLabelAggregate>();
  const seenRelationKeys = new Set<string>();
  const noteRelationAggregatesByNoteId = new Map<string, Map<string, { label: string; count: number }>>();

  liveTargetSnapshots.forEach(({ note, flatBranches }) => {
    flatBranches.forEach((branch) => {
      if (!branch.branchId) {
        return;
      }

      liveTargetsByBranchId.set(branch.branchId, {
        noteId: note.id,
        noteTitle: note.title || '',
        branch,
      });
    });
  });

  noteSnapshots.forEach(({ note, flatBranches }) => {
    flatBranches.forEach((sourceBranch) => {
      extractStudyNoteBranchMarkdownReferences(sourceBranch.body).forEach((reference) => {
        const normalizedRelationLabel = reference.relationKey;

        if (!normalizedRelationLabel) {
          return;
        }

        if (sourceBranch.branchId && sourceBranch.branchId === reference.branchId) {
          return;
        }

        const dedupeKey = JSON.stringify({
          noteId: note.id,
          sourceBranchKey: sourceBranch.key,
          targetBranchId: reference.branchId,
          relationLabel: normalizedRelationLabel,
        });

        if (seenRelationKeys.has(dedupeKey)) {
          return;
        }

        seenRelationKeys.add(dedupeKey);

        const relationLabel = getStableRelationLabel(
          reference.relationLabel!.replace(/\s+/g, ' ').trim(),
          normalizedRelationLabel
        );
        const targetBranch = liveTargetsByBranchId.get(reference.branchId);
        const relationItem: StudyWorkspaceRelationItem = {
          relationLabel,
          relationKey: normalizedRelationLabel,
          sourceNoteId: note.id,
          sourceNoteTitle: note.title || '',
          sourceBranchId: sourceBranch.branchId,
          sourceBranchTitle: sourceBranch.title,
          targetNoteId: targetBranch?.noteId ?? null,
          targetNoteTitle: targetBranch?.noteTitle ?? '',
          targetBranchId: reference.branchId,
          targetBranchTitle: targetBranch?.branch.title ?? reference.label,
          sourceUpdatedAt: note.updatedAt,
          isResolved: Boolean(targetBranch),
        };

        upsertNoteRelationAggregate(noteRelationAggregatesByNoteId, note.id, normalizedRelationLabel, relationLabel);
        if (targetBranch?.noteId && targetBranch.noteId !== note.id) {
          upsertNoteRelationAggregate(
            noteRelationAggregatesByNoteId,
            targetBranch.noteId,
            normalizedRelationLabel,
            relationLabel
          );
        }

        const workspaceAggregate = relationLabelAggregates.get(normalizedRelationLabel);
        if (workspaceAggregate) {
          workspaceAggregate.relationCount += 1;
          workspaceAggregate.noteIds.add(note.id);
          if (targetBranch?.noteId) {
            workspaceAggregate.noteIds.add(targetBranch.noteId);
          }
        } else {
          relationLabelAggregates.set(normalizedRelationLabel, {
            label: relationLabel,
            relationCount: 1,
            noteIds: new Set([note.id, ...(targetBranch?.noteId ? [targetBranch.noteId] : [])]),
          });
        }

        const relationLane = laneMap.get(normalizedRelationLabel);
        if (relationLane) {
          relationLane.items.push(relationItem);
        } else {
          laneMap.set(normalizedRelationLabel, {
            label: relationLabel,
            items: [relationItem],
          });
        }
      });
    });
  });

  notes.forEach((note) => {
    const noteRelationAggregates = noteRelationAggregatesByNoteId.get(note.id);

    if (!noteRelationAggregates || noteRelationAggregates.size === 0) {
      return;
    }

    const normalizedRelationLabels = Array.from(noteRelationAggregates.keys()).sort(sortLabels);
    const relationCounts = normalizedRelationLabels.reduce<Record<string, number>>((counts, relationKey) => {
      counts[relationKey] = noteRelationAggregates.get(relationKey)?.count ?? 0;
      return counts;
    }, {});

    relationSummaryByNoteId.set(note.id, {
      noteId: note.id,
      totalRelations: Array.from(noteRelationAggregates.values()).reduce(
        (totalCount, aggregate) => totalCount + aggregate.count,
        0
      ),
      relationCounts,
      relationLabels: normalizedRelationLabels,
      normalizedRelationLabels,
    });
  });

  const topRelationLabels = Array.from(relationLabelAggregates.values())
    .sort((a, b) => {
      if (b.relationCount !== a.relationCount) {
        return b.relationCount - a.relationCount;
      }

      return a.label.localeCompare(b.label);
    })
    .slice(0, 6)
    .map((aggregate) => ({
      label: aggregate.label,
      relationKey: normalizeRelationLabelKeyUnsafe(aggregate.label),
      relationCount: aggregate.relationCount,
      noteCount: aggregate.noteIds.size,
    }));

  const relationLanes = Array.from(laneMap.values())
    .map((lane) => ({
      relationLabel: lane.label,
      relationKey: normalizeRelationLabelKeyUnsafe(lane.label),
      totalItems: lane.items.length,
      items: [...lane.items].sort((a, b) => {
        const updatedAtDelta = new Date(b.sourceUpdatedAt).getTime() - new Date(a.sourceUpdatedAt).getTime();

        if (updatedAtDelta !== 0) {
          return updatedAtDelta;
        }

        const noteTitleDelta = a.sourceNoteTitle.localeCompare(b.sourceNoteTitle);
        if (noteTitleDelta !== 0) {
          return noteTitleDelta;
        }

        return a.sourceBranchTitle.localeCompare(b.sourceBranchTitle);
      }),
    }))
    .sort((a, b) => {
      if (b.totalItems !== a.totalItems) {
        return b.totalItems - a.totalItems;
      }

      return a.relationLabel.localeCompare(b.relationLabel);
    });

  return {
    relationSummaryByNoteId,
    topRelationLabels,
    relationLanes,
  };
}

function normalizeRelationLabelKeyUnsafe(relationLabel: string): string {
  return normalizeStudyNoteBranchRelationKey(relationLabel)
    ?? relationLabel.replace(/\s+/g, ' ').trim().toLowerCase();
}
