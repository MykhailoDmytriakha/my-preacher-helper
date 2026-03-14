import {
    createStudyNoteBranchStateRecord,
    hydrateStudyNoteBranchIdentity,
    mapFoldedBranchIdsToKeys,
} from '../studyNoteBranchIdentity';
import { parseStudyNoteOutline } from '../studyNoteOutline';

describe('studyNoteBranchIdentity', () => {
    it('hydrates branch IDs back onto structurally equivalent branches after a reorder', () => {
        const initialOutline = parseStudyNoteOutline([
            '## Alpha',
            'Alpha body',
            '',
            '## Beta',
            'Beta body',
        ].join('\n'));
        const alphaRecord = createStudyNoteBranchStateRecord(initialOutline.branches, '1', 'branch-alpha');

        expect(alphaRecord).not.toBeNull();

        const reorderedOutline = parseStudyNoteOutline([
            '## Beta',
            'Beta body',
            '',
            '## Alpha',
            'Alpha body',
        ].join('\n'));
        const hydrated = hydrateStudyNoteBranchIdentity(reorderedOutline.branches, [alphaRecord!]);

        expect(hydrated.branchIdByKey['2']).toBe('branch-alpha');
        expect(hydrated.keyByBranchId['branch-alpha']).toBe('2');
    });

    it('maps folded branch ids back to keys after a subtree depth change', () => {
        const initialOutline = parseStudyNoteOutline([
            '## Parent',
            'Parent body',
            '',
            '### Child',
            'Child body',
        ].join('\n'));
        const childRecord = createStudyNoteBranchStateRecord(initialOutline.branches, '1.1', 'branch-child');

        expect(childRecord).not.toBeNull();

        const promotedOutline = parseStudyNoteOutline([
            '## Parent',
            'Parent body',
            '',
            '## Child',
            'Child body',
        ].join('\n'));
        const hydrated = hydrateStudyNoteBranchIdentity(promotedOutline.branches, [childRecord!]);

        expect(mapFoldedBranchIdsToKeys(['branch-child'], hydrated.keyByBranchId)).toEqual(['2']);
    });

    it('preserves branch identity when the heading title changes but subtree content stays the same', () => {
        const initialOutline = parseStudyNoteOutline([
            '## Alpha',
            'Alpha body',
            '',
            '### Child',
            'Child body',
        ].join('\n'));
        const alphaRecord = createStudyNoteBranchStateRecord(initialOutline.branches, '1', 'branch-alpha');

        expect(alphaRecord).not.toBeNull();

        const renamedOutline = parseStudyNoteOutline([
            '## Renamed Alpha',
            'Alpha body',
            '',
            '### Child Renamed',
            'Child body',
        ].join('\n'));
        const hydrated = hydrateStudyNoteBranchIdentity(renamedOutline.branches, [alphaRecord!]);

        expect(hydrated.branchIdByKey['1']).toBe('branch-alpha');
    });

    it('rehydrates overlay tone metadata onto the matched branch record', () => {
        const initialOutline = parseStudyNoteOutline([
            '## Alpha',
            'Alpha body',
        ].join('\n'));
        const alphaRecord = createStudyNoteBranchStateRecord(initialOutline.branches, '1', 'branch-alpha');

        expect(alphaRecord).not.toBeNull();

        alphaRecord!.overlayTone = 'amber';

        const reorderedOutline = parseStudyNoteOutline([
            '## Beta',
            'Beta body',
            '',
            '## Alpha',
            'Alpha body',
        ].join('\n'));
        const hydrated = hydrateStudyNoteBranchIdentity(reorderedOutline.branches, [alphaRecord!]);

        expect(hydrated.branchIdByKey['2']).toBe('branch-alpha');
        expect(hydrated.branches[1].overlayTone).toBe('amber');
        expect(hydrated.branchRecords[0].overlayTone).toBe('amber');
    });

    it('rehydrates semantic label metadata onto the matched branch record', () => {
        const initialOutline = parseStudyNoteOutline([
            '## Alpha',
            'Alpha body',
        ].join('\n'));
        const alphaRecord = createStudyNoteBranchStateRecord(initialOutline.branches, '1', 'branch-alpha');

        expect(alphaRecord).not.toBeNull();

        alphaRecord!.semanticLabel = 'Theme';

        const reorderedOutline = parseStudyNoteOutline([
            '## Beta',
            'Beta body',
            '',
            '## Alpha',
            'Alpha body',
        ].join('\n'));
        const hydrated = hydrateStudyNoteBranchIdentity(reorderedOutline.branches, [alphaRecord!]);

        expect(hydrated.branchIdByKey['2']).toBe('branch-alpha');
        expect(hydrated.branches[1].semanticLabel).toBe('Theme');
        expect(hydrated.branchRecords[0].semanticLabel).toBe('Theme');
    });

    it('rehydrates controlled branch metadata onto the matched branch record', () => {
        const initialOutline = parseStudyNoteOutline([
            '## Alpha',
            'Alpha body',
        ].join('\n'));
        const alphaRecord = createStudyNoteBranchStateRecord(initialOutline.branches, '1', 'branch-alpha');

        expect(alphaRecord).not.toBeNull();

        alphaRecord!.branchKind = 'evidence';
        alphaRecord!.branchStatus = 'confirmed';

        const reorderedOutline = parseStudyNoteOutline([
            '## Beta',
            'Beta body',
            '',
            '## Alpha',
            'Alpha body',
        ].join('\n'));
        const hydrated = hydrateStudyNoteBranchIdentity(reorderedOutline.branches, [alphaRecord!]);

        expect(hydrated.branchIdByKey['2']).toBe('branch-alpha');
        expect(hydrated.branches[1].branchKind).toBe('evidence');
        expect(hydrated.branches[1].branchStatus).toBe('confirmed');
        expect(hydrated.branchRecords[0].branchKind).toBe('evidence');
        expect(hydrated.branchRecords[0].branchStatus).toBe('confirmed');
    });
});
