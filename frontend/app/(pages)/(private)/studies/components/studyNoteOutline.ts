import type {
    StudyNoteBranchKind,
    StudyNoteBranchOverlayTone,
    StudyNoteBranchStatus,
} from '@/models/models';

export interface StudyNoteOutlineBranch {
    key: string;
    branchId?: string;
    overlayTone?: StudyNoteBranchOverlayTone | null;
    semanticLabel?: string | null;
    branchKind?: StudyNoteBranchKind | null;
    branchStatus?: StudyNoteBranchStatus | null;
    path: number[];
    depth: number;
    headingLevel: number;
    title: string;
    rawTitle: string;
    body: string;
    preview: string;
    children: StudyNoteOutlineBranch[];
    sourceRange?: StudyNoteOutlineBranchSourceRange;
}

export interface StudyNoteOutlineBranchSourceRange {
    startOffset: number;
    bodyStartOffset: number;
    bodyEndOffset: number;
    subtreeEndOffset: number;
}

export interface StudyNoteOutline {
    introduction: string;
    branches: StudyNoteOutlineBranch[];
    hasOutline: boolean;
    totalBranches: number;
    baseHeadingLevel: number | null;
}

interface StudyNoteOutlineBranchMatchDescriptor {
    signature: string;
    occurrenceIndex: number;
}

interface StudyNoteOutlineBranchSiblingContext {
    branch: StudyNoteOutlineBranch;
    siblings: StudyNoteOutlineBranch[];
    siblingIndex: number;
}

interface StudyNoteOutlineBranchSignatureOptions {
    includeHeadingLevel?: boolean;
}

interface CollectedHeading {
    headingLevel: number;
    rawTitle: string;
    plainTitle: string;
    startOffset: number;
    bodyStartOffset: number;
}

interface MutableBranch {
    headingLevel: number;
    rawTitle: string;
    title: string;
    body: string;
    children: MutableBranch[];
    sourceRange: StudyNoteOutlineBranchSourceRange;
}

const HEADING_PATTERN = /^[ ]{0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE_PATTERN = /^(```+|~~~+)/;
const COLLAPSED_PREVIEW_LIMIT = 140;

export function normalizeStudyNoteMarkdown(markdown: string): string {
    return markdown.replace(/\r\n?/g, '\n');
}

function trimOuterBlankLines(value: string): string {
    return value.replace(/^\n+/, '').replace(/\n+$/, '');
}

function stripInlineMarkdown(value: string): string {
    return value
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/[*_~]/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
        .trim();
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

function getCollapsedPreview(body: string): string {
    const firstNonEmptyLine = body
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean);

    if (!firstNonEmptyLine) {
        return '';
    }

    const plainLine = stripInlineMarkdown(firstNonEmptyLine);

    if (plainLine.length <= COLLAPSED_PREVIEW_LIMIT) {
        return plainLine;
    }

    return `${plainLine.slice(0, COLLAPSED_PREVIEW_LIMIT).trimEnd()}...`;
}

function collectHeadings(markdown: string): CollectedHeading[] {
    const lines = markdown.split('\n');
    const headings: CollectedHeading[] = [];
    let offset = 0;
    let activeFenceMarker: { marker: '`' | '~'; length: number } | null = null;

    lines.forEach((line) => {
        activeFenceMarker = getShiftedFenceMarker(activeFenceMarker, line);

        if (activeFenceMarker === null) {
            const headingMatch = line.match(HEADING_PATTERN);

            if (headingMatch) {
                const headingLevel = headingMatch[1].length;
                const rawTitle = headingMatch[2].trim();
                const plainTitle = stripInlineMarkdown(rawTitle) || rawTitle;

                headings.push({
                    headingLevel,
                    rawTitle,
                    plainTitle,
                    startOffset: offset,
                    bodyStartOffset: offset + line.length + 1,
                });
            }
        }

        offset += line.length + 1;
    });

    return headings;
}

function buildTree(markdown: string, headings: CollectedHeading[]): MutableBranch[] {
    const roots: MutableBranch[] = [];
    const stack: MutableBranch[] = [];

    headings.forEach((heading, index) => {
        const bodyEndOffset = headings[index + 1]?.startOffset ?? markdown.length;
        const subtreeEndOffset = getSubtreeEndOffset(markdown, headings, index);
        const body = trimOuterBlankLines(markdown.slice(heading.bodyStartOffset, bodyEndOffset));

        const branch: MutableBranch = {
            headingLevel: heading.headingLevel,
            rawTitle: heading.rawTitle,
            title: heading.plainTitle,
            body,
            children: [],
            sourceRange: {
                startOffset: heading.startOffset,
                bodyStartOffset: heading.bodyStartOffset,
                bodyEndOffset,
                subtreeEndOffset,
            },
        };

        while (stack.length > 0 && stack[stack.length - 1].headingLevel >= heading.headingLevel) {
            stack.pop();
        }

        if (stack.length === 0) {
            roots.push(branch);
        } else {
            stack[stack.length - 1].children.push(branch);
        }

        stack.push(branch);
    });

    return roots;
}

function finalizeBranches(
    branches: MutableBranch[],
    parentPath: number[] = [],
    baseHeadingLevel: number
): StudyNoteOutlineBranch[] {
    return branches.map((branch, index) => {
        const path = [...parentPath, index + 1];
        const children = finalizeBranches(branch.children, path, baseHeadingLevel);

        return {
            key: path.join('.'),
            path,
            depth: Math.max(0, branch.headingLevel - baseHeadingLevel),
            headingLevel: branch.headingLevel,
            title: branch.title,
            rawTitle: branch.rawTitle,
            body: branch.body,
            preview: getCollapsedPreview(branch.body),
            children,
            sourceRange: branch.sourceRange,
        };
    });
}

function getSubtreeEndOffset(markdown: string, headings: CollectedHeading[], currentIndex: number): number {
    const currentHeading = headings[currentIndex];

    for (let index = currentIndex + 1; index < headings.length; index += 1) {
        if (headings[index].headingLevel <= currentHeading.headingLevel) {
            return headings[index].startOffset;
        }
    }

    return markdown.length;
}

export function parseStudyNoteOutline(markdown: string): StudyNoteOutline {
    const normalizedMarkdown = normalizeStudyNoteMarkdown(markdown);
    const headings = collectHeadings(normalizedMarkdown);

    if (headings.length === 0) {
        return {
            introduction: trimOuterBlankLines(normalizedMarkdown),
            branches: [],
            hasOutline: false,
            totalBranches: 0,
            baseHeadingLevel: null,
        };
    }

    const baseHeadingLevel = headings.reduce(
        (minLevel, heading) => Math.min(minLevel, heading.headingLevel),
        headings[0].headingLevel
    );

    const introduction = trimOuterBlankLines(normalizedMarkdown.slice(0, headings[0].startOffset));
    const branches = finalizeBranches(buildTree(normalizedMarkdown, headings), [], baseHeadingLevel);

    return {
        introduction,
        branches,
        hasOutline: branches.length > 0,
        totalBranches: flattenStudyNoteOutlineBranches(branches).length,
        baseHeadingLevel,
    };
}

export function flattenStudyNoteOutlineBranches(branches: StudyNoteOutlineBranch[]): StudyNoteOutlineBranch[] {
    const result = branches.flatMap((branch) => [branch, ...flattenStudyNoteOutlineBranches(branch.children)]);
    return result;
}

export function findStudyNoteOutlineBranchByKey(
    branches: StudyNoteOutlineBranch[],
    branchKey: string
): StudyNoteOutlineBranch | null {
    for (const branch of branches) {
        if (branch.key === branchKey) {
            return branch;
        }

        const nestedBranch = findStudyNoteOutlineBranchByKey(branch.children, branchKey);

        if (nestedBranch) {
            return nestedBranch;
        }
    }

    return null;
}

export function findStudyNoteOutlineBranchSiblingContext(
    branches: StudyNoteOutlineBranch[],
    branchKey: string
): StudyNoteOutlineBranchSiblingContext | null {
    for (let siblingIndex = 0; siblingIndex < branches.length; siblingIndex += 1) {
        const branch = branches[siblingIndex];

        if (branch.key === branchKey) {
            return {
                branch,
                siblings: branches,
                siblingIndex,
            };
        }

        const nestedContext = findStudyNoteOutlineBranchSiblingContext(branch.children, branchKey);

        if (nestedContext) {
            return nestedContext;
        }
    }

    return null;
}

export function findStudyNoteOutlinePreviousSiblingKey(
    branches: StudyNoteOutlineBranch[],
    branchKey: string
): string | null {
    const siblingContext = findStudyNoteOutlineBranchSiblingContext(branches, branchKey);

    if (!siblingContext || siblingContext.siblingIndex <= 0) {
        return null;
    }

    return siblingContext.siblings[siblingContext.siblingIndex - 1]?.key ?? null;
}

export function getStudyNoteOutlineBranchMaxHeadingLevel(branch: StudyNoteOutlineBranch): number {
    return branch.children.reduce(
        (maxHeadingLevel, childBranch) => Math.max(maxHeadingLevel, getStudyNoteOutlineBranchMaxHeadingLevel(childBranch)),
        branch.headingLevel
    );
}

export function getCollapsibleStudyNoteBranchKeys(branches: StudyNoteOutlineBranch[]): string[] {
    return flattenStudyNoteOutlineBranches(branches)
        .filter((branch) => Boolean(branch.body.trim()) || branch.children.length > 0)
        .map((branch) => branch.key);
}

export function filterStudyNoteOutlineKeys(
    candidateKeys: string[],
    branches: StudyNoteOutlineBranch[]
): string[] {
    const validKeys = new Set(flattenStudyNoteOutlineBranches(branches).map((branch) => branch.key));

    return candidateKeys.filter((key) => validKeys.has(key));
}

function getStudyNoteOutlineBranchSignature(
    branch: StudyNoteOutlineBranch,
    { includeHeadingLevel = true }: StudyNoteOutlineBranchSignatureOptions = {}
): string {
    return JSON.stringify({
        headingLevel: includeHeadingLevel ? branch.headingLevel : null,
        rawTitle: branch.rawTitle,
        body: branch.body.trim(),
        children: branch.children.map((childBranch) =>
            JSON.parse(
                getStudyNoteOutlineBranchSignature(childBranch, {
                    includeHeadingLevel,
                })
            )
        ),
    });
}

function getStudyNoteOutlineBranchMatchDescriptor(
    branches: StudyNoteOutlineBranch[],
    branchKey: string,
    options: StudyNoteOutlineBranchSignatureOptions = {}
): StudyNoteOutlineBranchMatchDescriptor | null {
    const flattenedBranches = flattenStudyNoteOutlineBranches(branches);
    const branch = flattenedBranches.find((candidate) => candidate.key === branchKey);

    if (!branch) {
        return null;
    }

    const signature = getStudyNoteOutlineBranchSignature(branch, options);
    const occurrenceIndex = flattenedBranches
        .filter((candidate) => getStudyNoteOutlineBranchSignature(candidate, options) === signature)
        .findIndex((candidate) => candidate.key === branch.key);

    if (occurrenceIndex < 0) {
        return null;
    }

    return {
        signature,
        occurrenceIndex,
    };
}

export function remapStudyNoteOutlineKey(
    branchKey: string,
    previousBranches: StudyNoteOutlineBranch[],
    nextBranches: StudyNoteOutlineBranch[]
): string | null {
    const matchDescriptor = getStudyNoteOutlineBranchMatchDescriptor(previousBranches, branchKey);

    if (!matchDescriptor) {
        return null;
    }

    const nextMatches = flattenStudyNoteOutlineBranches(nextBranches)
        .filter((branch) => getStudyNoteOutlineBranchSignature(branch) === matchDescriptor.signature);

    return nextMatches[matchDescriptor.occurrenceIndex]?.key ?? null;
}

export function remapStudyNoteOutlineKeyIgnoringHeadingLevel(
    branchKey: string,
    previousBranches: StudyNoteOutlineBranch[],
    nextBranches: StudyNoteOutlineBranch[]
): string | null {
    const matchDescriptor = getStudyNoteOutlineBranchMatchDescriptor(previousBranches, branchKey, {
        includeHeadingLevel: false,
    });

    if (!matchDescriptor) {
        return null;
    }

    const nextMatches = flattenStudyNoteOutlineBranches(nextBranches)
        .filter((branch) =>
            getStudyNoteOutlineBranchSignature(branch, { includeHeadingLevel: false }) === matchDescriptor.signature
        );

    return nextMatches[matchDescriptor.occurrenceIndex]?.key ?? null;
}

export function remapStudyNoteOutlineKeys(
    candidateKeys: string[],
    previousBranches: StudyNoteOutlineBranch[],
    nextBranches: StudyNoteOutlineBranch[]
): string[] {
    return candidateKeys.flatMap((branchKey) => {
        const remappedKey = remapStudyNoteOutlineKey(branchKey, previousBranches, nextBranches);
        return remappedKey ? [remappedKey] : [];
    });
}

export function shiftStudyNoteMarkdownHeadingLevels(markdown: string, delta: number): string {
    const lines = markdown.split('\n');
    let activeFenceMarker: { marker: '`' | '~'; length: number } | null = null;

    return lines.map((line) => {
        activeFenceMarker = getShiftedFenceMarker(activeFenceMarker, line);

        if (activeFenceMarker !== null) {
            return line;
        }

        const headingMatch = line.match(/^([ ]{0,3})(#{1,6})(?=[ \t]+.+$)/);

        if (!headingMatch) {
            return line;
        }

        const nextHeadingLevel = headingMatch[2].length + delta;

        if (nextHeadingLevel < 1 || nextHeadingLevel > 6) {
            return line;
        }

        return `${headingMatch[1]}${'#'.repeat(nextHeadingLevel)}${line.slice(headingMatch[1].length + headingMatch[2].length)}`;
    }).join('\n');
}
