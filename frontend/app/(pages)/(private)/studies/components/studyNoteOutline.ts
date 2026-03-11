export interface StudyNoteOutlineBranch {
    key: string;
    path: number[];
    depth: number;
    headingLevel: number;
    title: string;
    rawTitle: string;
    body: string;
    preview: string;
    children: StudyNoteOutlineBranch[];
}

export interface StudyNoteOutline {
    introduction: string;
    branches: StudyNoteOutlineBranch[];
    hasOutline: boolean;
    totalBranches: number;
    baseHeadingLevel: number | null;
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
}

const HEADING_PATTERN = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE_PATTERN = /^(```+|~~~+)/;
const COLLAPSED_PREVIEW_LIMIT = 140;

function normalizeMarkdown(markdown: string): string {
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
    let activeFenceMarker: '`' | '~' | null = null;

    lines.forEach((line) => {
        const trimmedLine = line.trim();
        const fenceMatch = trimmedLine.match(FENCE_PATTERN);

        if (fenceMatch) {
            const marker = fenceMatch[1][0] as '`' | '~';

            if (activeFenceMarker === null) {
                activeFenceMarker = marker;
            } else if (activeFenceMarker === marker) {
                activeFenceMarker = null;
            }
        }

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
        const nextHeadingStart = headings[index + 1]?.startOffset ?? markdown.length;
        const body = trimOuterBlankLines(markdown.slice(heading.bodyStartOffset, nextHeadingStart));

        const branch: MutableBranch = {
            headingLevel: heading.headingLevel,
            rawTitle: heading.rawTitle,
            title: heading.plainTitle,
            body,
            children: [],
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
        };
    });
}

export function parseStudyNoteOutline(markdown: string): StudyNoteOutline {
    const normalizedMarkdown = normalizeMarkdown(markdown);
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
    return branches.flatMap((branch) => [branch, ...flattenStudyNoteOutlineBranches(branch.children)]);
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
