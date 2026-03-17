export interface StudyNoteBranchLinkMeta {
    branchId: string;
    relationLabel: string | null;
    relationKey: string | null;
}

export interface StudyNoteBranchMarkdownReference extends StudyNoteBranchLinkMeta {
    label: string;
}

export const STUDY_NOTE_BRANCH_RELATION_KEYS = ['supports', 'contrasts', 'expands', 'applies'] as const;

export type StudyNoteBranchRelationKey = (typeof STUDY_NOTE_BRANCH_RELATION_KEYS)[number];

const STUDY_NOTE_BRANCH_RELATION_KEY_SET = new Set<string>(STUDY_NOTE_BRANCH_RELATION_KEYS);
const STUDY_NOTE_BRANCH_RELATION_TRANSLATION_PREFIX =
    'studiesWorkspace.outlinePilot.branchRelations.';
const STUDY_NOTE_BRANCH_RELATION_ALIASES: Record<StudyNoteBranchRelationKey, string[]> = {
    supports: [
        'supports',
        'поддерживает',
        'підтримує',
        `${STUDY_NOTE_BRANCH_RELATION_TRANSLATION_PREFIX}supports`,
    ],
    contrasts: [
        'contrasts',
        'контрастирует',
        'контрастує',
        `${STUDY_NOTE_BRANCH_RELATION_TRANSLATION_PREFIX}contrasts`,
    ],
    expands: [
        'expands',
        'раскрывает',
        'розкриває',
        `${STUDY_NOTE_BRANCH_RELATION_TRANSLATION_PREFIX}expands`,
    ],
    applies: [
        'applies',
        'применяет',
        'застосовує',
        `${STUDY_NOTE_BRANCH_RELATION_TRANSLATION_PREFIX}applies`,
    ],
};
const STUDY_NOTE_BRANCH_RELATION_ALIAS_TO_KEY = new Map<string, StudyNoteBranchRelationKey>();

function normalizeRelationText(value?: string | null): string {
    return value?.replace(/\s+/g, ' ').trim().toLowerCase() ?? '';
}

Object.entries(STUDY_NOTE_BRANCH_RELATION_ALIASES).forEach(([relationKey, aliases]) => {
    aliases.forEach((alias) => {
        const normalizedAlias = normalizeRelationText(alias);
        if (normalizedAlias) {
            STUDY_NOTE_BRANCH_RELATION_ALIAS_TO_KEY.set(normalizedAlias, relationKey as StudyNoteBranchRelationKey);
        }
    });
});

export function normalizeStudyNoteBranchRelationKey(value?: string | null): string | null {
    const normalizedValue = normalizeRelationText(value);

    if (!normalizedValue) {
        return null;
    }

    return STUDY_NOTE_BRANCH_RELATION_ALIAS_TO_KEY.get(normalizedValue) ?? normalizedValue;
}

export function getStudyNoteBranchRelationTranslationKey(value?: string | null): string | null {
    const normalizedRelationKey = normalizeStudyNoteBranchRelationKey(value);

    if (!normalizedRelationKey || !STUDY_NOTE_BRANCH_RELATION_KEY_SET.has(normalizedRelationKey)) {
        return null;
    }

    return `${STUDY_NOTE_BRANCH_RELATION_TRANSLATION_PREFIX}${normalizedRelationKey}`;
}

export function buildStudyNoteBranchRelationSearchTerms(value?: string | null): string[] {
    const normalizedRelationKey = normalizeStudyNoteBranchRelationKey(value);
    const trimmedValue = value?.replace(/\s+/g, ' ').trim() ?? '';

    if (!normalizedRelationKey) {
        return [];
    }

    if (STUDY_NOTE_BRANCH_RELATION_KEY_SET.has(normalizedRelationKey)) {
        const aliases = STUDY_NOTE_BRANCH_RELATION_ALIASES[
            normalizedRelationKey as StudyNoteBranchRelationKey
        ];

        return Array.from(
            new Set(
                [normalizedRelationKey, ...aliases]
                    .map((term) => normalizeRelationText(term))
                    .filter(Boolean)
            )
        );
    }

    return Array.from(
        new Set([trimmedValue, normalizedRelationKey].map((term) => normalizeRelationText(term)).filter(Boolean))
    );
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
    const relationKey = normalizeStudyNoteBranchRelationKey(relationLabel);

    if (href.startsWith('#branch=')) {
        const branchId = decodeBranchId(href.slice('#branch='.length));
        return branchId ? { branchId, relationLabel, relationKey } : null;
    }

    if (typeof window === 'undefined') {
        return null;
    }

    try {
        const resolvedUrl = new URL(href, window.location.href);
        const branchId = parseStudyNoteBranchIdFromHash(resolvedUrl.hash);

        return branchId ? { branchId, relationLabel, relationKey } : null;
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
            relationKey: normalizeStudyNoteBranchRelationKey(match[3] ? unescapeMarkdownLinkTitle(match[3]) : null),
        });
    }

    return references;
}
