import {
    findStudyNoteOutlineBranchByKey,
    normalizeStudyNoteMarkdown,
    parseStudyNoteOutline,
    type StudyNoteOutlineBranch,
} from './studyNoteOutline';

type StudyNoteOutlineMoveDirection = 'up' | 'down';
type StudyNoteOutlineInsertPosition = 'sibling' | 'child';

interface StudyNoteOutlineInsertOptions {
    title: string;
    body?: string;
}

interface BranchSiblingContext {
    branch: StudyNoteOutlineBranch;
    siblings: StudyNoteOutlineBranch[];
    siblingIndex: number;
}

function trimBranchSliceForSwap(markdown: string): string {
    return markdown.replace(/^\n+/, '').replace(/\n+$/, '');
}

function restoreMarkdownLineEndings(markdown: string, originalMarkdown: string): string {
    return /\r\n/.test(originalMarkdown) ? markdown.replace(/\n/g, '\r\n') : markdown;
}

function trimTrailingNewlines(markdown: string): string {
    return markdown.replace(/\n+$/, '');
}

function trimLeadingNewlines(markdown: string): string {
    return markdown.replace(/^\n+/, '');
}

function buildInsertedBranchMarkdown(
    headingLevel: number,
    { title, body = '' }: StudyNoteOutlineInsertOptions
): string {
    const normalizedTitle = title.trim() || 'New branch';
    const normalizedBody = body.trim();
    const headingLine = `${'#'.repeat(headingLevel)} ${normalizedTitle}`;

    return normalizedBody ? `${headingLine}\n${normalizedBody}` : headingLine;
}

function findBranchSiblingContext(
    branches: StudyNoteOutlineBranch[],
    branchKey: string
): BranchSiblingContext | null {
    for (let siblingIndex = 0; siblingIndex < branches.length; siblingIndex += 1) {
        const branch = branches[siblingIndex];

        if (branch.key === branchKey) {
            return {
                branch,
                siblings: branches,
                siblingIndex,
            };
        }

        const nestedContext = findBranchSiblingContext(branch.children, branchKey);

        if (nestedContext) {
            return nestedContext;
        }
    }

    return null;
}

function swapSiblingSubtrees(
    markdown: string,
    firstBranch: StudyNoteOutlineBranch,
    secondBranch: StudyNoteOutlineBranch
): string {
    const firstRange = firstBranch.sourceRange;
    const secondRange = secondBranch.sourceRange;

    if (
        !firstRange ||
        !secondRange ||
        firstRange.startOffset > secondRange.startOffset ||
        firstRange.subtreeEndOffset > secondRange.startOffset ||
        secondRange.startOffset > secondRange.subtreeEndOffset
    ) {
        return markdown;
    }

    const before = markdown.slice(0, firstRange.startOffset);
    const firstSlice = trimBranchSliceForSwap(
        markdown.slice(firstRange.startOffset, firstRange.subtreeEndOffset)
    );
    const middle = markdown.slice(firstRange.subtreeEndOffset, secondRange.startOffset);
    const secondSlice = trimBranchSliceForSwap(
        markdown.slice(secondRange.startOffset, secondRange.subtreeEndOffset)
    );
    const after = markdown.slice(secondRange.subtreeEndOffset);
    const afterSeparator = after.length > 0 && !after.startsWith('\n') ? '\n\n' : '';

    return `${before}${secondSlice}\n\n${middle}${firstSlice}${afterSeparator}${after}`;
}

export function moveStudyNoteOutlineBranch(
    markdown: string,
    branchKey: string,
    direction: StudyNoteOutlineMoveDirection
): string {
    const normalizedMarkdown = normalizeStudyNoteMarkdown(markdown);
    const outline = parseStudyNoteOutline(normalizedMarkdown);
    const branchContext = findBranchSiblingContext(outline.branches, branchKey);

    if (!branchContext) {
        return markdown;
    }

    const targetSiblingIndex = direction === 'up'
        ? branchContext.siblingIndex - 1
        : branchContext.siblingIndex + 1;

    if (targetSiblingIndex < 0 || targetSiblingIndex >= branchContext.siblings.length) {
        return markdown;
    }

    const firstBranch = direction === 'up'
        ? branchContext.siblings[targetSiblingIndex]
        : branchContext.branch;
    const secondBranch = direction === 'up'
        ? branchContext.branch
        : branchContext.siblings[targetSiblingIndex];

    const nextMarkdown = swapSiblingSubtrees(normalizedMarkdown, firstBranch, secondBranch);

    return restoreMarkdownLineEndings(nextMarkdown, markdown);
}

export function insertStudyNoteOutlineBranch(
    markdown: string,
    branchKey: string,
    position: StudyNoteOutlineInsertPosition,
    options: StudyNoteOutlineInsertOptions
): string {
    const normalizedMarkdown = normalizeStudyNoteMarkdown(markdown);
    const outline = parseStudyNoteOutline(normalizedMarkdown);
    const branch = findStudyNoteOutlineBranchByKey(outline.branches, branchKey);

    if (!branch?.sourceRange) {
        return markdown;
    }

    const insertionHeadingLevel = position === 'child'
        ? Math.min(branch.headingLevel + 1, 6)
        : branch.headingLevel;

    if (position === 'child' && branch.headingLevel >= 6) {
        return markdown;
    }

    const insertionPoint = branch.sourceRange.subtreeEndOffset;
    const before = trimTrailingNewlines(normalizedMarkdown.slice(0, insertionPoint));
    const after = trimLeadingNewlines(normalizedMarkdown.slice(insertionPoint));
    const insertedBranch = buildInsertedBranchMarkdown(insertionHeadingLevel, options);
    const prefix = before.length > 0 ? '\n\n' : '';
    const suffix = after.length > 0 ? '\n\n' : '';
    const nextMarkdown = `${before}${prefix}${insertedBranch}${suffix}${after}`;

    return restoreMarkdownLineEndings(nextMarkdown, markdown);
}
