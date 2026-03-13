export interface StudyNoteBranchLinkMeta {
    branchId: string;
    relationLabel: string | null;
}

export interface StudyNoteBranchMarkdownReference extends StudyNoteBranchLinkMeta {
    label: string;
}

const STUDY_NOTE_BRANCH_MARKDOWN_REFERENCE_PATTERN = /\[((?:\\.|[^\]])+)\]\((#branch=[^\s)]+)(?:\s+"((?:\\"|[^"])*)")?\)/g;

function decodeBranchId(branchId: string): string | null {
    const trimmedBranchId = branchId.trim();
    return trimmedBranchId ? decodeURIComponent(trimmedBranchId) : null;
}

function unescapeMarkdownLinkLabel(value: string): string {
    return value
        .replace(/\\([\[\]\\])/g, '$1')
        .trim();
}

function unescapeMarkdownLinkTitle(value: string): string {
    return value
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .trim();
}

export function getStudyNoteBranchHash(branchId: string): string {
    return `#branch=${encodeURIComponent(branchId)}`;
}

export function parseStudyNoteBranchIdFromHash(hashValue: string): string | null {
    if (!hashValue.startsWith('#branch=')) {
        return null;
    }

    return decodeBranchId(hashValue.slice('#branch='.length));
}

export function parseStudyNoteBranchLinkMeta(href?: string, title?: string): StudyNoteBranchLinkMeta | null {
    if (!href) {
        return null;
    }

    const relationLabel = title?.trim() ? title.trim() : null;

    if (href.startsWith('#branch=')) {
        const branchId = decodeBranchId(href.slice('#branch='.length));
        return branchId ? { branchId, relationLabel } : null;
    }

    if (typeof window === 'undefined') {
        return null;
    }

    try {
        const resolvedUrl = new URL(href, window.location.href);
        const branchId = parseStudyNoteBranchIdFromHash(resolvedUrl.hash);

        return branchId ? { branchId, relationLabel } : null;
    } catch {
        return null;
    }
}

function escapeMarkdownLinkLabel(text: string): string {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]');
}

function escapeMarkdownLinkTitle(text: string): string {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
}

export function buildStudyNoteBranchMarkdownReference(
    title: string,
    branchId: string,
    relationLabel?: string | null
): string {
    const escapedLabel = escapeMarkdownLinkLabel(title);
    const branchHash = getStudyNoteBranchHash(branchId);
    const trimmedRelationLabel = relationLabel?.trim() ?? '';

    if (!trimmedRelationLabel) {
        return `[${escapedLabel}](${branchHash})`;
    }

    return `[${escapedLabel}](${branchHash} "${escapeMarkdownLinkTitle(trimmedRelationLabel)}")`;
}

export function extractStudyNoteBranchMarkdownReferences(markdown: string): StudyNoteBranchMarkdownReference[] {
    const references: StudyNoteBranchMarkdownReference[] = [];

    for (const match of markdown.matchAll(STUDY_NOTE_BRANCH_MARKDOWN_REFERENCE_PATTERN)) {
        const branchId = parseStudyNoteBranchIdFromHash(match[2]);

        if (!branchId) {
            continue;
        }

        references.push({
            label: unescapeMarkdownLinkLabel(match[1]),
            branchId,
            relationLabel: match[3] ? unescapeMarkdownLinkTitle(match[3]) : null,
        });
    }

    return references;
}
