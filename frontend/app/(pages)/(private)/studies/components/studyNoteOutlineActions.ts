import {
    findStudyNoteOutlineBranchSiblingContext,
    findStudyNoteOutlineBranchByKey,
    getStudyNoteOutlineBranchMaxHeadingLevel,
    normalizeStudyNoteMarkdown,
    parseStudyNoteOutline,
    shiftStudyNoteMarkdownHeadingLevels,
    type StudyNoteOutlineBranch,
} from './studyNoteOutline';

type StudyNoteOutlineMoveDirection = 'up' | 'down';
type StudyNoteOutlineInsertPosition = 'sibling' | 'child';
type StudyNoteOutlineDepthDirection = 'promote' | 'demote';
type StudyNoteOutlineRootOptions = StudyNoteOutlineInsertOptions & {
    headingLevel?: number;
};

interface StudyNoteOutlineInsertOptions {
    title: string;
    body?: string;
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
    const branchContext = findStudyNoteOutlineBranchSiblingContext(outline.branches, branchKey);

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

export function insertStudyNoteOutlineRootBranch(
    markdown: string,
    options: StudyNoteOutlineRootOptions
): string {
    const normalizedMarkdown = normalizeStudyNoteMarkdown(markdown);
    const before = trimTrailingNewlines(normalizedMarkdown);
    const insertedBranch = buildInsertedBranchMarkdown(options.headingLevel ?? 2, options);
    const prefix = before.length > 0 ? '\n\n' : '';
    const nextMarkdown = `${before}${prefix}${insertedBranch}`;

    return restoreMarkdownLineEndings(nextMarkdown, markdown);
}

export function shiftStudyNoteOutlineBranchDepth(
    markdown: string,
    branchKey: string,
    direction: StudyNoteOutlineDepthDirection
): string {
    const normalizedMarkdown = normalizeStudyNoteMarkdown(markdown);
    const outline = parseStudyNoteOutline(normalizedMarkdown);
    const branchContext = findStudyNoteOutlineBranchSiblingContext(outline.branches, branchKey);

    if (!branchContext?.branch.sourceRange) {
        return markdown;
    }

    if (direction === 'promote' && branchContext.branch.path.length <= 1) {
        return markdown;
    }

    if (direction === 'demote') {
        if (branchContext.siblingIndex === 0 || getStudyNoteOutlineBranchMaxHeadingLevel(branchContext.branch) >= 6) {
            return markdown;
        }
    }

    const headingDelta = direction === 'promote' ? -1 : 1;
    const { startOffset, subtreeEndOffset } = branchContext.branch.sourceRange;
    const before = normalizedMarkdown.slice(0, startOffset);
    const subtree = normalizedMarkdown.slice(startOffset, subtreeEndOffset);
    const after = normalizedMarkdown.slice(subtreeEndOffset);
    const shiftedSubtree = shiftStudyNoteMarkdownHeadingLevels(subtree, headingDelta);

    if (shiftedSubtree === subtree) {
        return markdown;
    }

    return restoreMarkdownLineEndings(`${before}${shiftedSubtree}${after}`, markdown);
}
