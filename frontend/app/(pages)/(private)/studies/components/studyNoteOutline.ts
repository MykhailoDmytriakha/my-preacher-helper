import type {
    StudyNoteBranchKind,
    StudyNoteBranchOverlayTone,
    StudyNoteBranchStatus,
} from '@/models/models';

export interface StudyNoteOutlineNodeblock {
    key: string;
    body: string;
    preview: string;
    children: StudyNoteOutlineNodeblock[];
}

export interface StudyNoteOutlineChildOrderEntry {
    kind: 'branch' | 'nodeblock';
    key: string;
}

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
    nodeblocks?: StudyNoteOutlineNodeblock[];
    childOrder?: StudyNoteOutlineChildOrderEntry[];
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
    rawBody: string;
    children: MutableBranch[];
    sourceRange: StudyNoteOutlineBranchSourceRange;
}

const HEADING_PATTERN = /^[ ]{0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE_PATTERN = /^(```+|~~~+)/;
const STRUCTURE_POP_PATTERN = /^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const ROOT_NODEBLOCK_PATTERN = /^[-+*][ \t]+(.+)$/;
const NESTED_NODEBLOCK_PATTERN = /^(\s+)[-+*][ \t]+(.+)$/;
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
        const rawBody = markdown.slice(heading.bodyStartOffset, bodyEndOffset);

        const branch: MutableBranch = {
            headingLevel: heading.headingLevel,
            rawTitle: heading.rawTitle,
            title: heading.plainTitle,
            rawBody,
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

interface ScopePopSplit {
    ownedContent: string;
    bubbledContent: string;
    popOffset: number | null;
}

interface ParsedScopeNodeblocks {
    body: string;
    nodeblocks: StudyNoteOutlineNodeblock[];
    nextNodeblockIndex: number;
}

interface ParsedTrailingNodeblocks {
    nodeblocks: StudyNoteOutlineNodeblock[];
    nextNodeblockIndex: number;
}

interface FinalizedMutableBranch {
    branch: StudyNoteOutlineBranch;
    bubbledContent: string;
}

function splitTopLevelScopePop(content: string): ScopePopSplit {
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
                popOffset: offset,
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
        popOffset: null,
    };
}

function isListItemAtIndent(line: string, indent: number): boolean {
    const indentPrefix = ' '.repeat(indent);

    if (!line.startsWith(indentPrefix)) {
        return false;
    }

    const remainder = line.slice(indent);
    return ROOT_NODEBLOCK_PATTERN.test(remainder);
}

function getNestedChildIndent(lines: string[]): number | null {
    const indents = lines.flatMap((line) => {
        const match = line.match(NESTED_NODEBLOCK_PATTERN);

        if (!match) {
            return [];
        }

        return [match[1].length];
    });

    if (indents.length === 0) {
        return null;
    }

    return Math.min(...indents);
}

function parseNodeblocksFromListLines(
    lines: string[],
    parentKey: string,
    startNodeblockIndex: number
): ParsedTrailingNodeblocks {
    const nodeblocks: StudyNoteOutlineNodeblock[] = [];
    let nextNodeblockIndex = startNodeblockIndex;
    let lineIndex = 0;

    while (lineIndex < lines.length) {
        if (!isListItemAtIndent(lines[lineIndex], 0)) {
            lineIndex += 1;
            continue;
        }

        const itemLines: string[] = [lines[lineIndex]];
        lineIndex += 1;

        while (lineIndex < lines.length && !isListItemAtIndent(lines[lineIndex], 0)) {
            itemLines.push(lines[lineIndex]);
            lineIndex += 1;
        }

        const firstLine = itemLines[0].replace(ROOT_NODEBLOCK_PATTERN, '$1');
        const normalizedLines = [
            firstLine,
            ...itemLines.slice(1),
        ];
        const nestedStartIndex = normalizedLines.findIndex((line, index) => index > 0 && NESTED_NODEBLOCK_PATTERN.test(line));
        const bodyLines = nestedStartIndex >= 0
            ? normalizedLines.slice(0, nestedStartIndex)
            : normalizedLines;
        const nestedLines = nestedStartIndex >= 0
            ? normalizedLines.slice(nestedStartIndex)
            : [];
        const nestedIndent = getNestedChildIndent(nestedLines);
        const normalizedNestedLines = nestedIndent === null
            ? []
            : nestedLines.map((line) =>
                line.startsWith(' '.repeat(nestedIndent))
                    ? line.slice(nestedIndent)
                    : line
            );
        const childParseResult = normalizedNestedLines.length > 0
            ? parseNodeblocksFromListLines(
                normalizedNestedLines,
                `${parentKey}.n${nextNodeblockIndex}`,
                1
            )
            : { nodeblocks: [], nextNodeblockIndex: 1 };
        const body = trimOuterBlankLines(bodyLines.join('\n'));

        nodeblocks.push({
            key: `${parentKey}.n${nextNodeblockIndex}`,
            body,
            preview: getCollapsedPreview(body),
            children: childParseResult.nodeblocks,
        });
        nextNodeblockIndex += 1;
    }

    return {
        nodeblocks,
        nextNodeblockIndex,
    };
}

function findFirstRootNodeblockLineIndex(lines: string[]): number {
    let activeFenceMarker: { marker: '`' | '~'; length: number } | null = null;

    for (let index = 0; index < lines.length; index += 1) {
        activeFenceMarker = getShiftedFenceMarker(activeFenceMarker, lines[index]);

        if (activeFenceMarker === null && ROOT_NODEBLOCK_PATTERN.test(lines[index])) {
            return index;
        }
    }

    return -1;
}

function parseScopeBodyAndNodeblocks(
    content: string,
    parentKey: string,
    startNodeblockIndex: number
): ParsedScopeNodeblocks {
    const lines = content.split('\n');
    const firstNodeblockLineIndex = findFirstRootNodeblockLineIndex(lines);

    if (firstNodeblockLineIndex < 0) {
        return {
            body: trimOuterBlankLines(content),
            nodeblocks: [],
            nextNodeblockIndex: startNodeblockIndex,
        };
    }

    const body = trimOuterBlankLines(lines.slice(0, firstNodeblockLineIndex).join('\n'));
    const nodeblockParseResult = parseNodeblocksFromListLines(
        lines.slice(firstNodeblockLineIndex),
        parentKey,
        startNodeblockIndex
    );

    return {
        body,
        nodeblocks: nodeblockParseResult.nodeblocks,
        nextNodeblockIndex: nodeblockParseResult.nextNodeblockIndex,
    };
}

function parseTrailingScopeContentAsNodeblocks(
    content: string,
    parentKey: string,
    startNodeblockIndex: number
): ParsedTrailingNodeblocks {
    const trimmedContent = trimOuterBlankLines(content);

    if (!trimmedContent) {
        return {
            nodeblocks: [],
            nextNodeblockIndex: startNodeblockIndex,
        };
    }

    const lines = trimmedContent.split('\n');

    if (findFirstRootNodeblockLineIndex(lines) === 0) {
        return parseNodeblocksFromListLines(lines, parentKey, startNodeblockIndex);
    }

    return {
        nodeblocks: [{
            key: `${parentKey}.n${startNodeblockIndex}`,
            body: trimmedContent,
            preview: getCollapsedPreview(trimmedContent),
            children: [],
        }],
        nextNodeblockIndex: startNodeblockIndex + 1,
    };
}

function finalizeBranches(
    branches: MutableBranch[],
    parentPath: number[] = [],
    baseHeadingLevel: number
): StudyNoteOutlineBranch[] {
    return branches.map((branch, index) =>
        finalizeBranch(branch, [...parentPath, index + 1], baseHeadingLevel).branch
    );
}

function finalizeBranch(
    branch: MutableBranch,
    path: number[],
    baseHeadingLevel: number
): FinalizedMutableBranch {
    const branchKey = path.join('.');
    const splitScope = branch.children.length === 0
        ? splitTopLevelScopePop(branch.rawBody)
        : {
            ownedContent: branch.rawBody,
            bubbledContent: '',
            popOffset: null,
        };
    const ownContentParseResult = parseScopeBodyAndNodeblocks(splitScope.ownedContent, branchKey, 1);
    const finalizedChildren = branch.children.map((childBranch, childIndex) =>
        finalizeBranch(childBranch, [...path, childIndex + 1], baseHeadingLevel)
    );
    const nodeblocks = [...ownContentParseResult.nodeblocks];
    const childOrder: StudyNoteOutlineChildOrderEntry[] = ownContentParseResult.nodeblocks.map((nodeblock) => ({
        kind: 'nodeblock',
        key: nodeblock.key,
    }));
    let nextNodeblockIndex = ownContentParseResult.nextNodeblockIndex;

    finalizedChildren.forEach((finalizedChild) => {
        childOrder.push({
            kind: 'branch',
            key: finalizedChild.branch.key,
        });

        if (!finalizedChild.bubbledContent.trim()) {
            return;
        }

        const trailingNodeblockParseResult = parseTrailingScopeContentAsNodeblocks(
            finalizedChild.bubbledContent,
            branchKey,
            nextNodeblockIndex
        );

        trailingNodeblockParseResult.nodeblocks.forEach((nodeblock) => {
            nodeblocks.push(nodeblock);
            childOrder.push({
                kind: 'nodeblock',
                key: nodeblock.key,
            });
        });
        nextNodeblockIndex = trailingNodeblockParseResult.nextNodeblockIndex;
    });

    const body = ownContentParseResult.body;
    const sourceRange = branch.sourceRange
        ? {
            ...branch.sourceRange,
            subtreeEndOffset: splitScope.popOffset === null
                ? branch.sourceRange.subtreeEndOffset
                : branch.sourceRange.bodyStartOffset + splitScope.popOffset,
        }
        : undefined;

    return {
        branch: {
            key: branchKey,
            path,
            depth: Math.max(0, branch.headingLevel - baseHeadingLevel),
            headingLevel: branch.headingLevel,
            title: branch.title,
            rawTitle: branch.rawTitle,
            body,
            preview: getCollapsedPreview(body || nodeblocks[0]?.body || ''),
            nodeblocks,
            childOrder,
            children: finalizedChildren.map((finalizedChild) => finalizedChild.branch),
            sourceRange,
        },
        bubbledContent: splitScope.bubbledContent,
    };
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

export function getStudyNoteOutlineBranchNodeblocks(
    branch: Pick<StudyNoteOutlineBranch, 'nodeblocks'>
): StudyNoteOutlineNodeblock[] {
    return branch.nodeblocks ?? [];
}

export function getStudyNoteOutlineBranchChildOrder(
    branch: Pick<StudyNoteOutlineBranch, 'childOrder' | 'children' | 'nodeblocks'>
): StudyNoteOutlineChildOrderEntry[] {
    if (branch.childOrder?.length) {
        return branch.childOrder;
    }

    return [
        ...(branch.nodeblocks ?? []).map((nodeblock) => ({
            kind: 'nodeblock' as const,
            key: nodeblock.key,
        })),
        ...branch.children.map((childBranch) => ({
            kind: 'branch' as const,
            key: childBranch.key,
        })),
    ];
}

function serializeNodeblockContent(nodeblock: StudyNoteOutlineNodeblock): string {
    return trimOuterBlankLines([
        nodeblock.body,
        ...nodeblock.children.map(serializeNodeblockContent),
    ].filter(Boolean).join('\n\n'));
}

export function getStudyNoteOutlineBranchContentMarkdown(
    branch: Pick<StudyNoteOutlineBranch, 'body' | 'nodeblocks'>
): string {
    return trimOuterBlankLines([
        branch.body,
        ...getStudyNoteOutlineBranchNodeblocks(branch).map(serializeNodeblockContent),
    ].filter(Boolean).join('\n\n'));
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
        .filter((branch) => Boolean(branch.body.trim()) || branch.children.length > 0 || getStudyNoteOutlineBranchNodeblocks(branch).length > 0)
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
        nodeblocks: getStudyNoteOutlineBranchNodeblocks(branch).map((nodeblock) =>
            JSON.parse(getStudyNoteOutlineNodeblockSignature(nodeblock))
        ),
        children: branch.children.map((childBranch) =>
            JSON.parse(
                getStudyNoteOutlineBranchSignature(childBranch, {
                    includeHeadingLevel,
                })
            )
        ),
    });
}

function getStudyNoteOutlineNodeblockSignature(nodeblock: StudyNoteOutlineNodeblock): string {
    return JSON.stringify({
        body: nodeblock.body.trim(),
        children: nodeblock.children.map((childNodeblock) =>
            JSON.parse(getStudyNoteOutlineNodeblockSignature(childNodeblock))
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
