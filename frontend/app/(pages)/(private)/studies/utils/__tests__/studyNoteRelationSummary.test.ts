import { StudyNoteBranchState } from '@/models/models';
import { createStudyNoteBranchStateRecord } from '../../components/studyNoteBranchIdentity';
import { parseStudyNoteOutline } from '../../components/studyNoteOutline';
import {
  buildStudyNoteRelationSearchText,
  buildStudyWorkspaceRelationData,
  noteMatchesStudyRelationFilter,
} from '../studyNoteRelationSummary';

const makeBranchState = (noteId: string, branchRecords: StudyNoteBranchState['branchRecords']): StudyNoteBranchState => ({
  id: `branch-state-${noteId}`,
  noteId,
  userId: 'user-1',
  branchRecords,
  readFoldedBranchIds: [],
  previewFoldedBranchIds: [],
  createdAt: '2026-03-16T00:00:00.000Z',
  updatedAt: '2026-03-16T00:00:00.000Z',
});

describe('studyNoteRelationSummary', () => {
  it('builds relation summaries, top labels, and resolved relation lanes from hydrated outlines', () => {
    const sourceContent = [
      '## Source Branch',
      'See [Target Branch](#branch=branch-target "supports").',
    ].join('\n');
    const targetContent = [
      '## Target Branch',
      'Target body',
    ].join('\n');
    const sourceOutline = parseStudyNoteOutline(sourceContent);
    const targetOutline = parseStudyNoteOutline(targetContent);
    const sourceRecord = createStudyNoteBranchStateRecord(sourceOutline.branches, '1', 'branch-source');
    const targetRecord = createStudyNoteBranchStateRecord(targetOutline.branches, '1', 'branch-target');

    expect(sourceRecord).not.toBeNull();
    expect(targetRecord).not.toBeNull();

    const relationData = buildStudyWorkspaceRelationData([
      { id: 'note-1', title: 'Source Note', content: sourceContent, updatedAt: '2026-03-16T00:00:00.000Z' } as any,
      { id: 'note-2', title: 'Target Note', content: targetContent, updatedAt: '2026-03-15T00:00:00.000Z' } as any,
    ], [
      makeBranchState('note-1', [sourceRecord!]),
      makeBranchState('note-2', [targetRecord!]),
    ]);

    expect(relationData.relationSummaryByNoteId.get('note-1')).toEqual({
      noteId: 'note-1',
      totalRelations: 1,
      relationCounts: { supports: 1 },
      relationLabels: ['supports'],
      normalizedRelationLabels: ['supports'],
    });
    expect(relationData.relationSummaryByNoteId.get('note-2')).toEqual({
      noteId: 'note-2',
      totalRelations: 1,
      relationCounts: { supports: 1 },
      relationLabels: ['supports'],
      normalizedRelationLabels: ['supports'],
    });
    expect(relationData.topRelationLabels).toEqual([
      { label: 'supports', relationKey: 'supports', relationCount: 1, noteCount: 2 },
    ]);
    expect(relationData.relationLanes).toEqual([
      {
        relationLabel: 'supports',
        relationKey: 'supports',
        totalItems: 1,
        items: [
          expect.objectContaining({
            relationKey: 'supports',
            sourceNoteId: 'note-1',
            sourceNoteTitle: 'Source Note',
            sourceBranchTitle: 'Source Branch',
            targetNoteId: 'note-2',
            targetNoteTitle: 'Target Note',
            targetBranchId: 'branch-target',
            targetBranchTitle: 'Target Branch',
            isResolved: true,
          }),
        ],
      },
    ]);
  });

  it('keeps unresolved relation items visible and searchable when the target anchor no longer resolves', () => {
    const sourceContent = [
      '## Source Branch',
      'See [Snapshot Branch](#branch=missing-branch "contrasts").',
    ].join('\n');
    const sourceOutline = parseStudyNoteOutline(sourceContent);
    const sourceRecord = createStudyNoteBranchStateRecord(sourceOutline.branches, '1', 'branch-source');

    expect(sourceRecord).not.toBeNull();

    const relationData = buildStudyWorkspaceRelationData([
      { id: 'note-1', title: 'Source Note', content: sourceContent, updatedAt: '2026-03-16T00:00:00.000Z' } as any,
    ], [
      makeBranchState('note-1', [sourceRecord!]),
    ]);

    const noteSummary = relationData.relationSummaryByNoteId.get('note-1');

    expect(noteSummary).toEqual({
      noteId: 'note-1',
      totalRelations: 1,
      relationCounts: { contrasts: 1 },
      relationLabels: ['contrasts'],
      normalizedRelationLabels: ['contrasts'],
    });
    expect(buildStudyNoteRelationSearchText(noteSummary)).toContain('contrasts');
    expect(noteMatchesStudyRelationFilter(noteSummary, 'Contrasts')).toBe(true);
    expect(relationData.relationLanes[0].items[0]).toEqual(expect.objectContaining({
      relationKey: 'contrasts',
      targetBranchTitle: 'Snapshot Branch',
      isResolved: false,
    }));
  });

  it('keeps targets resolved when the source scope is narrower than the workspace scope', () => {
    const sourceContent = [
      '## Source Branch',
      'See [Target Branch](#branch=branch-target "Поддерживает").',
    ].join('\n');
    const targetContent = [
      '## Target Branch',
      'Target body',
    ].join('\n');
    const targetOutline = parseStudyNoteOutline(targetContent);
    const targetRecord = createStudyNoteBranchStateRecord(targetOutline.branches, '1', 'branch-target');

    expect(targetRecord).not.toBeNull();

    const relationData = buildStudyWorkspaceRelationData(
      [
        { id: 'note-1', title: 'Source Note', content: sourceContent, updatedAt: '2026-03-16T00:00:00.000Z' } as any,
      ],
      [
        makeBranchState('note-2', [targetRecord!]),
      ],
      {
        liveTargetNotes: [
          { id: 'note-1', title: 'Source Note', content: sourceContent, updatedAt: '2026-03-16T00:00:00.000Z' } as any,
          { id: 'note-2', title: 'Target Note', content: targetContent, updatedAt: '2026-03-15T00:00:00.000Z' } as any,
        ],
      }
    );

    expect(relationData.topRelationLabels).toEqual([
      { label: 'supports', relationKey: 'supports', relationCount: 1, noteCount: 2 },
    ]);
    expect(relationData.relationLanes[0].items[0]).toEqual(expect.objectContaining({
      relationKey: 'supports',
      targetNoteId: 'note-2',
      targetBranchTitle: 'Target Branch',
      isResolved: true,
    }));
  });
});
