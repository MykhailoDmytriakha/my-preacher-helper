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

interface SplitBranchBodyResult {
    ownedContent: string;
    bubbledContent: string;
    popMarker: string | null;
}

const FENCE_PATTERN = /^(```+|~~~+)/;
const STRUCTURE_POP_PATTERN = /^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const ROOT_NODEBLOCK_PATTERN = /^[-+*][ \t]+(.+)$/;

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

function trimOuterBlankLines(markdown: string): string {
    return markdown.replace(/^\n+/, '').replace(/\n+$/, '');
}

function getShiftedFenceMarker(
    activeFenceMarker: { marker: '`' | '~'; length: number } | null,
    line: string
): { marker: '`' | '~'; length: number } | null {
    const trimmedLine = line.trim();
    const fenceMatch = trimmedLine.match(FENCE_PATTERN);

    if (!fenceMatch) {
        return activeFenceMarker;
    }

    const marker = fenceMatch[1][0] as '`' | '~';
    const markerLength = fenceMatch[1].length;

    if (activeFenceMarker === null) {
        return { marker, length: markerLength };
    }

    if (activeFenceMarker.marker === marker && markerLength >= activeFenceMarker.length) {
        return null;
    }

    return activeFenceMarker;
}

function splitLeafBranchBodyForNodeblockLift(content: string): SplitBranchBodyResult {
    const lines = content.split('\n');
    let activeFenceMarker: { marker: '`' | '~'; length: number } | null = null;
    let offset = 0;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        activeFenceMarker = getShiftedFenceMarker(activeFenceMarker, line);

        if (activeFenceMarker === null && STRUCTURE_POP_PATTERN.test(line)) {
            const lineEndOffset = offset + line.length;
            const remainderStartOffset = lineEndOffset < content.length ? lineEndOffset + 1 : lineEndOffset;

            return {
                ownedContent: content.slice(0, offset),
                bubbledContent: content.slice(remainderStartOffset),
                popMarker: line.trim(),
            };
        }

        offset += line.length;
        if (index < lines.length - 1) {
            offset += 1;
        }
    }

    return {
        ownedContent: content,
        bubbledContent: '',
        popMarker: null,
    };
}

function splitOwnedContentIntoTopLevelNodeblocks(content: string): {
    bodyPrefix: string;
    nodeblockSlices: string[];
} {
    const lines = content.split('\n');
    let activeFenceMarker: { marker: '`' | '~'; length: number } | null = null;
    let firstNodeblockLineIndex = -1;

    for (let index = 0; index < lines.length; index += 1) {
        activeFenceMarker = getShiftedFenceMarker(activeFenceMarker, lines[index]);

        if (activeFenceMarker === null && ROOT_NODEBLOCK_PATTERN.test(lines[index])) {
            firstNodeblockLineIndex = index;
            break;
        }
    }

    if (firstNodeblockLineIndex < 0) {
        return {
            bodyPrefix: trimOuterBlankLines(content),
            nodeblockSlices: [],
        };
    }

    const bodyPrefix = trimOuterBlankLines(lines.slice(0, firstNodeblockLineIndex).join('\n'));
    const nodeblockSlices: string[] = [];
    let currentNodeblockLines: string[] | null = null;
    activeFenceMarker = null;

    for (let index = firstNodeblockLineIndex; index < lines.length; index += 1) {
        const line = lines[index];
        activeFenceMarker = getShiftedFenceMarker(activeFenceMarker, line);
        const startsTopLevelNodeblock = activeFenceMarker === null && ROOT_NODEBLOCK_PATTERN.test(line);

        if (startsTopLevelNodeblock) {
            if (currentNodeblockLines) {
                nodeblockSlices.push(trimOuterBlankLines(currentNodeblockLines.join('\n')));
            }

            currentNodeblockLines = [line];
            continue;
        }

        currentNodeblockLines?.push(line);
    }

    if (currentNodeblockLines) {
        nodeblockSlices.push(trimOuterBlankLines(currentNodeblockLines.join('\n')));
    }

    return {
        bodyPrefix,
        nodeblockSlices,
    };
}

function splitOwnedContentIntoTopLevelBlocks(content: string): string[] {
    const trimmedContent = trimOuterBlankLines(content);

    if (!trimmedContent) {
        return [];
    }

    const lines = trimmedContent.split('\n');
    const blocks: string[] = [];
    const currentBlockLines: string[] = [];
    let activeFenceMarker: { marker: '`' | '~'; length: number } | null = null;

    const pushCurrentBlock = () => {
        const block = trimOuterBlankLines(currentBlockLines.join('\n'));

        if (block) {
            blocks.push(block);
        }

        currentBlockLines.length = 0;
    };

    lines.forEach((line) => {
        if (!line.trim() && activeFenceMarker === null) {
            if (currentBlockLines.length > 0) {
                pushCurrentBlock();
            }
            return;
        }

        currentBlockLines.push(line);
        activeFenceMarker = getShiftedFenceMarker(activeFenceMarker, line);
    });

    if (currentBlockLines.length > 0) {
        pushCurrentBlock();
    }

    return blocks;
}

function buildLeafBranchBodyWithPoppedNodeblocks(
    ownedContent: string,
    bubbledContent: string,
    popMarker: string | null
): string {
    const normalizedOwnedContent = trimOuterBlankLines(ownedContent);
    const normalizedBubbledContent = trimOuterBlankLines(bubbledContent);

    if (!normalizedBubbledContent) {
        return normalizedOwnedContent;
    }

    const separator = popMarker ?? '---';

    if (!normalizedOwnedContent) {
        return `${separator}\n${normalizedBubbledContent}`;
    }

    return `${normalizedOwnedContent}\n\n${separator}\n${normalizedBubbledContent}`;
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

export function liftStudyNoteOutlineNodeblockToParentBranch(
    markdown: string,
    branchKey: string,
    topLevelNodeblockIndex: number
): string {
    const normalizedMarkdown = normalizeStudyNoteMarkdown(markdown);
    const outline = parseStudyNoteOutline(normalizedMarkdown);
    const branch = findStudyNoteOutlineBranchByKey(outline.branches, branchKey);

    if (
        !branch?.sourceRange ||
        branch.path.length <= 1 ||
        branch.children.length > 0 ||
        topLevelNodeblockIndex < 0
    ) {
        return markdown;
    }

    const branchBody = normalizedMarkdown.slice(
        branch.sourceRange.bodyStartOffset,
        branch.sourceRange.bodyEndOffset
    );
    const splitBranchBody = splitLeafBranchBodyForNodeblockLift(branchBody);
    const { bodyPrefix, nodeblockSlices } = splitOwnedContentIntoTopLevelNodeblocks(splitBranchBody.ownedContent);

    if (topLevelNodeblockIndex >= nodeblockSlices.length) {
        return markdown;
    }

    const movedNodeblockSlice = nodeblockSlices[topLevelNodeblockIndex];
    const remainingNodeblockSlices = nodeblockSlices.filter((_, index) => index !== topLevelNodeblockIndex);
    const nextOwnedContent = trimOuterBlankLines([
        bodyPrefix,
        ...remainingNodeblockSlices,
    ].filter(Boolean).join('\n\n'));
    const nextBubbledContent = trimOuterBlankLines([
        movedNodeblockSlice,
        splitBranchBody.bubbledContent,
    ].filter(Boolean).join('\n\n'));
    const rebuiltBranchBody = buildLeafBranchBodyWithPoppedNodeblocks(
        nextOwnedContent,
        nextBubbledContent,
        splitBranchBody.popMarker
    );
    const before = normalizedMarkdown.slice(0, branch.sourceRange.bodyStartOffset);
    const after = normalizedMarkdown.slice(branch.sourceRange.bodyEndOffset);
    const nextMarkdown = `${before}${rebuiltBranchBody}${after}`;

    return restoreMarkdownLineEndings(nextMarkdown, markdown);
}

export function liftStudyNoteOutlineBlockToParentBranch(
    markdown: string,
    branchKey: string,
    topLevelBlockIndex: number
): string {
    const normalizedMarkdown = normalizeStudyNoteMarkdown(markdown);
    const outline = parseStudyNoteOutline(normalizedMarkdown);
    const branch = findStudyNoteOutlineBranchByKey(outline.branches, branchKey);

    if (
        !branch?.sourceRange ||
        branch.path.length <= 1 ||
        branch.children.length > 0 ||
        topLevelBlockIndex < 0
    ) {
        return markdown;
    }

    const branchBody = normalizedMarkdown.slice(
        branch.sourceRange.bodyStartOffset,
        branch.sourceRange.bodyEndOffset
    );
    const splitBranchBody = splitLeafBranchBodyForNodeblockLift(branchBody);
    const topLevelBlocks = splitOwnedContentIntoTopLevelBlocks(splitBranchBody.ownedContent);

    if (topLevelBlockIndex >= topLevelBlocks.length) {
        return markdown;
    }

    const movedBlock = topLevelBlocks[topLevelBlockIndex];
    const remainingBlocks = topLevelBlocks.filter((_, index) => index !== topLevelBlockIndex);
    const nextOwnedContent = trimOuterBlankLines(remainingBlocks.join('\n\n'));
    const nextBubbledContent = trimOuterBlankLines([
        movedBlock,
        splitBranchBody.bubbledContent,
    ].filter(Boolean).join('\n\n'));
    const rebuiltBranchBody = buildLeafBranchBodyWithPoppedNodeblocks(
        nextOwnedContent,
        nextBubbledContent,
        splitBranchBody.popMarker
    );
    const before = normalizedMarkdown.slice(0, branch.sourceRange.bodyStartOffset);
    const after = normalizedMarkdown.slice(branch.sourceRange.bodyEndOffset);
    const nextMarkdown = `${before}${rebuiltBranchBody}${after}`;

    return restoreMarkdownLineEndings(nextMarkdown, markdown);
}
