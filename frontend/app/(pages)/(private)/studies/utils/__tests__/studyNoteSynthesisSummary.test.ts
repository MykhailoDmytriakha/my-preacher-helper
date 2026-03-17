import { buildStudyWorkspaceSynthesisData } from '../studyNoteSynthesisSummary';
import { StudyWorkspaceReviewBranchItem } from '../studyNoteMetadataSummary';
import { StudyWorkspaceRelationData } from '../studyNoteRelationSummary';

describe('buildStudyWorkspaceSynthesisData', () => {
  const branchInventory: StudyWorkspaceReviewBranchItem[] = [
    {
      noteId: 'question-note',
      noteTitle: 'Question Note',
      branchId: 'question-branch',
      branchTitle: 'Open question',
      isResolved: true,
      branchKind: 'question',
      branchStatus: 'tentative',
      semanticLabel: 'Grace',
      noteUpdatedAt: '2026-03-16T00:00:00.000Z',
    },
    {
      noteId: 'evidence-note',
      noteTitle: 'Evidence Note',
      branchId: 'evidence-branch',
      branchTitle: 'Confirmed evidence',
      isResolved: true,
      branchKind: 'evidence',
      branchStatus: 'confirmed',
      semanticLabel: null,
      noteUpdatedAt: '2026-03-15T00:00:00.000Z',
    },
    {
      noteId: 'application-note',
      noteTitle: 'Application Note',
      branchId: 'application-branch',
      branchTitle: 'Ready application',
      isResolved: true,
      branchKind: 'application',
      branchStatus: 'active',
      semanticLabel: null,
      noteUpdatedAt: '2026-03-14T00:00:00.000Z',
    },
  ];

  const relationData: StudyWorkspaceRelationData = {
    relationSummaryByNoteId: new Map(),
    topRelationLabels: [],
    relationLanes: [
      {
        relationLabel: 'supports',
        relationKey: 'supports',
        totalItems: 1,
        items: [
          {
            relationLabel: 'supports',
            relationKey: 'supports',
            sourceNoteId: 'evidence-note',
            sourceNoteTitle: 'Evidence Note',
            sourceBranchId: 'evidence-branch',
            sourceBranchTitle: 'Confirmed evidence',
            targetNoteId: 'question-note',
            targetNoteTitle: 'Question Note',
            targetBranchId: 'question-branch',
            targetBranchTitle: 'Open question',
            sourceUpdatedAt: '2026-03-15T00:00:00.000Z',
            isResolved: true,
          },
        ],
      },
      {
        relationLabel: 'applies',
        relationKey: 'applies',
        totalItems: 1,
        items: [
          {
            relationLabel: 'applies',
            relationKey: 'applies',
            sourceNoteId: 'application-note',
            sourceNoteTitle: 'Application Note',
            sourceBranchId: 'application-branch',
            sourceBranchTitle: 'Ready application',
            targetNoteId: 'question-note',
            targetNoteTitle: 'Question Note',
            targetBranchId: 'question-branch',
            targetBranchTitle: 'Open question',
            sourceUpdatedAt: '2026-03-14T00:00:00.000Z',
            isResolved: true,
          },
        ],
      },
    ],
  };

  it('builds synthesis lanes and note summaries from branch inventory plus relation data', () => {
    const synthesisData = buildStudyWorkspaceSynthesisData(branchInventory, relationData);

    expect(synthesisData.synthesisCounts).toEqual({
      openQuestions: 1,
      confirmedEvidence: 1,
      applicationReady: 1,
    });

    expect(
      synthesisData.synthesisLanes.find((lane) => lane.id === 'openQuestions')?.items[0].relationBadges
    ).toEqual([{ relationKey: 'supports', count: 1 }]);
    expect(
      synthesisData.synthesisLanes.find((lane) => lane.id === 'confirmedEvidence')?.items[0].relationBadges
    ).toEqual([{ relationKey: 'supports', count: 1 }]);
    expect(
      synthesisData.synthesisLanes.find((lane) => lane.id === 'applicationReady')?.items[0].relationBadges
    ).toEqual([{ relationKey: 'applies', count: 1 }]);

    expect(synthesisData.noteSummaryByNoteId.get('question-note')).toEqual({
      noteId: 'question-note',
      openQuestionCount: 1,
      confirmedEvidenceCount: 0,
      applicationReadyCount: 0,
    });
    expect(synthesisData.noteSummaryByNoteId.get('evidence-note')).toEqual({
      noteId: 'evidence-note',
      openQuestionCount: 0,
      confirmedEvidenceCount: 1,
      applicationReadyCount: 0,
    });
    expect(synthesisData.noteSummaryByNoteId.get('application-note')).toEqual({
      noteId: 'application-note',
      openQuestionCount: 0,
      confirmedEvidenceCount: 0,
      applicationReadyCount: 1,
    });
  });

  it('keeps support counts for visible questions even when supporting notes are outside the visible inventory', () => {
    const visibleInventory = [branchInventory[0]];
    const synthesisData = buildStudyWorkspaceSynthesisData(visibleInventory, relationData);

    expect(synthesisData.synthesisCounts.openQuestions).toBe(1);
    expect(synthesisData.synthesisLanes.find((lane) => lane.id === 'openQuestions')?.items[0].relationBadges).toEqual([
      { relationKey: 'supports', count: 1 },
    ]);
  });

  it('excludes unresolved branches and unresolved relations from active synthesis', () => {
    const unresolvedInventory: StudyWorkspaceReviewBranchItem[] = [
      {
        noteId: 'stale-question-note',
        noteTitle: 'Stale Question Note',
        branchId: 'stale-question-branch',
        branchTitle: 'Deleted question',
        isResolved: false,
        branchKind: 'question',
        branchStatus: 'tentative',
        semanticLabel: null,
        noteUpdatedAt: '2026-03-16T00:00:00.000Z',
      },
      {
        noteId: 'application-note',
        noteTitle: 'Application Note',
        branchId: 'application-branch',
        branchTitle: 'Ready application',
        isResolved: true,
        branchKind: 'application',
        branchStatus: 'active',
        semanticLabel: null,
        noteUpdatedAt: '2026-03-14T00:00:00.000Z',
      },
    ];
    const relationDataWithStaleApply: StudyWorkspaceRelationData = {
      relationSummaryByNoteId: new Map(),
      topRelationLabels: [],
      relationLanes: [
        {
          relationLabel: 'applies',
          relationKey: 'applies',
          totalItems: 1,
          items: [
            {
              relationLabel: 'applies',
              relationKey: 'applies',
              sourceNoteId: 'application-note',
              sourceNoteTitle: 'Application Note',
              sourceBranchId: 'application-branch',
              sourceBranchTitle: 'Ready application',
              targetNoteId: null,
              targetNoteTitle: '',
              targetBranchId: 'missing-target',
              targetBranchTitle: 'Deleted target',
              sourceUpdatedAt: '2026-03-14T00:00:00.000Z',
              isResolved: false,
            },
          ],
        },
      ],
    };

    const synthesisData = buildStudyWorkspaceSynthesisData(unresolvedInventory, relationDataWithStaleApply);

    expect(synthesisData.synthesisCounts).toEqual({
      openQuestions: 0,
      confirmedEvidence: 0,
      applicationReady: 0,
    });
    expect(synthesisData.noteSummaryByNoteId.size).toBe(0);
  });
});
