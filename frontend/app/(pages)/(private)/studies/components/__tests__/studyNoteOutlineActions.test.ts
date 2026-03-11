import { insertStudyNoteOutlineBranch, moveStudyNoteOutlineBranch } from '../studyNoteOutlineActions';
import { parseStudyNoteOutline } from '../studyNoteOutline';

describe('studyNoteOutlineActions', () => {
    it('moves a top-level branch subtree downward without breaking child ownership', () => {
        const markdown = [
            'Intro line',
            '',
            '## Alpha',
            'Alpha body',
            '',
            '### Alpha child',
            'Child body',
            '',
            '## Beta',
            'Beta body',
            '',
            '## Gamma',
            'Gamma body',
        ].join('\n');

        const movedMarkdown = moveStudyNoteOutlineBranch(markdown, '1', 'down');
        const movedOutline = parseStudyNoteOutline(movedMarkdown);

        expect(movedOutline.branches.map((branch) => branch.title)).toEqual(['Beta', 'Alpha', 'Gamma']);
        expect(movedOutline.branches[1].children.map((branch) => branch.title)).toEqual(['Alpha child']);
    });

    it('moves a nested sibling branch upward within the same parent', () => {
        const markdown = [
            '## Root',
            'Root body',
            '',
            '### First child',
            'First body',
            '',
            '### Second child',
            'Second body',
        ].join('\n');

        const movedMarkdown = moveStudyNoteOutlineBranch(markdown, '1.2', 'up');
        const movedOutline = parseStudyNoteOutline(movedMarkdown);

        expect(movedOutline.branches[0].children.map((branch) => branch.title)).toEqual([
            'Second child',
            'First child',
        ]);
    });

    it('returns the original markdown when the branch cannot move further', () => {
        const markdown = [
            '## Root',
            'Root body',
            '',
            '## Next',
            'Next body',
        ].join('\n');

        expect(moveStudyNoteOutlineBranch(markdown, '1', 'up')).toBe(markdown);
        expect(moveStudyNoteOutlineBranch(markdown, '2', 'down')).toBe(markdown);
        expect(moveStudyNoteOutlineBranch(markdown, 'missing', 'down')).toBe(markdown);
    });

    it('inserts a sibling branch after the current subtree', () => {
        const markdown = [
            '## Root',
            'Root body',
            '',
            '## Next',
            'Next body',
        ].join('\n');

        const nextMarkdown = insertStudyNoteOutlineBranch(markdown, '1', 'sibling', {
            title: 'New branch',
        });
        const outline = parseStudyNoteOutline(nextMarkdown);

        expect(outline.branches.map((branch) => branch.title)).toEqual([
            'Root',
            'New branch',
            'Next',
        ]);
    });

    it('inserts a child branch as the last child of the current subtree', () => {
        const markdown = [
            '## Root',
            'Root body',
            '',
            '### Existing child',
            'Child body',
            '',
            '## Next',
            'Next body',
        ].join('\n');

        const nextMarkdown = insertStudyNoteOutlineBranch(markdown, '1', 'child', {
            title: 'New child',
        });
        const outline = parseStudyNoteOutline(nextMarkdown);

        expect(outline.branches[0].children.map((branch) => branch.title)).toEqual([
            'Existing child',
            'New child',
        ]);
        expect(outline.branches[1].title).toBe('Next');
    });

    it('inserts a nested sibling between existing siblings under the same parent', () => {
        const markdown = [
            '## Root',
            'Root body',
            '',
            '### First child',
            'First body',
            '',
            '### Second child',
            'Second body',
            '',
            '### Third child',
            'Third body',
        ].join('\n');

        const nextMarkdown = insertStudyNoteOutlineBranch(markdown, '1.1', 'sibling', {
            title: 'Inserted child',
        });
        const outline = parseStudyNoteOutline(nextMarkdown);

        expect(outline.branches[0].children.map((branch) => branch.title)).toEqual([
            'First child',
            'Inserted child',
            'Second child',
            'Third child',
        ]);
    });

    it('inserts a child branch into a branch that currently has no children', () => {
        const markdown = [
            '## Root',
            'Root body',
            '',
            '## Next',
            'Next body',
        ].join('\n');

        const nextMarkdown = insertStudyNoteOutlineBranch(markdown, '1', 'child', {
            title: 'First child',
        });
        const outline = parseStudyNoteOutline(nextMarkdown);

        expect(outline.branches[0].children.map((branch) => branch.title)).toEqual(['First child']);
        expect(outline.branches[1].title).toBe('Next');
    });

    it('inserts sibling and child branches correctly at the end of the document', () => {
        const markdown = [
            '## Root',
            'Root body',
        ].join('\n');

        const siblingMarkdown = insertStudyNoteOutlineBranch(markdown, '1', 'sibling', {
            title: 'Tail sibling',
        });
        const childMarkdown = insertStudyNoteOutlineBranch(markdown, '1', 'child', {
            title: 'Tail child',
        });

        expect(parseStudyNoteOutline(siblingMarkdown).branches.map((branch) => branch.title)).toEqual([
            'Root',
            'Tail sibling',
        ]);
        expect(parseStudyNoteOutline(childMarkdown).branches[0].children.map((branch) => branch.title)).toEqual([
            'Tail child',
        ]);
    });

    it('returns the original markdown when child insertion would exceed h6 or branch is missing', () => {
        const markdown = [
            '###### Deep root',
            'Body',
        ].join('\n');

        expect(insertStudyNoteOutlineBranch(markdown, '1', 'child', { title: 'Too deep' })).toBe(markdown);
        expect(insertStudyNoteOutlineBranch(markdown, 'missing', 'sibling', { title: 'Missing' })).toBe(markdown);
    });
});
