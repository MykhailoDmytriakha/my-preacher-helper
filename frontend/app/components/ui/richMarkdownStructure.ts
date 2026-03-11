export const DEFAULT_OUTLINE_ROOT_HEADING_LEVEL = 2;
export const MIN_MARKDOWN_HEADING_LEVEL = 1;
export const MAX_MARKDOWN_HEADING_LEVEL = 6;
export const DEFAULT_OUTLINE_PREVIEW_WIDTH = 380;
export const MIN_OUTLINE_PREVIEW_WIDTH = 280;
export const MAX_OUTLINE_PREVIEW_WIDTH = 720;

export type MarkdownHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface HeadingContextSnapshot {
    currentHeadingLevel: number | null;
    previousHeadingLevel: number | null;
}

export function clampHeadingLevel(level: number): MarkdownHeadingLevel {
    return Math.max(MIN_MARKDOWN_HEADING_LEVEL, Math.min(MAX_MARKDOWN_HEADING_LEVEL, level)) as MarkdownHeadingLevel;
}

export function getContextBranchLevel(
    snapshot: HeadingContextSnapshot,
    fallbackLevel = DEFAULT_OUTLINE_ROOT_HEADING_LEVEL
): MarkdownHeadingLevel {
    return clampHeadingLevel(snapshot.currentHeadingLevel ?? snapshot.previousHeadingLevel ?? fallbackLevel);
}

export function getChildBranchLevel(
    snapshot: HeadingContextSnapshot,
    fallbackLevel = DEFAULT_OUTLINE_ROOT_HEADING_LEVEL
): MarkdownHeadingLevel {
    return clampHeadingLevel(getContextBranchLevel(snapshot, fallbackLevel) + 1);
}

export function getPromotedHeadingLevel(currentHeadingLevel: number | null): MarkdownHeadingLevel | null {
    if (currentHeadingLevel === null) {
        return null;
    }

    return clampHeadingLevel(currentHeadingLevel - 1);
}

export function getDemotedHeadingLevel(currentHeadingLevel: number | null): MarkdownHeadingLevel | null {
    if (currentHeadingLevel === null) {
        return null;
    }

    return clampHeadingLevel(currentHeadingLevel + 1);
}

export function clampOutlinePreviewWidth(
    requestedWidth: number,
    viewportWidth: number,
    minimumWidth = MIN_OUTLINE_PREVIEW_WIDTH,
    maximumWidth = MAX_OUTLINE_PREVIEW_WIDTH
): number {
    const viewportAwareMaximum = Math.max(
        minimumWidth,
        Math.min(maximumWidth, Math.floor(viewportWidth * 0.48))
    );

    return Math.min(Math.max(requestedWidth, minimumWidth), viewportAwareMaximum);
}
