/**
 * Splits a markdown document into the section tree its headings already describe.
 *
 * Why this exists: a note is stored as one flat markdown string, and `MarkdownDisplay`
 * renders it as a flat stream — so the nesting the author wrote with `#`/`##`/`###`
 * is invisible on screen. Nothing is added to the stored text; this only recovers the
 * hierarchy that is already in it, so the reader can indent and fold it.
 *
 * Heading detection follows the same fence-aware line walk as
 * `normalizePlanPointHeadings` in `markdownUtils.ts` — a `#` inside a fenced code
 * block is code, not a heading.
 */

export interface MarkdownSection {
    /** Stable within one parse of one document: the index path from the root, e.g. "0.2.1". */
    id: string;
    /** Heading level, 1-6, exactly as written. */
    level: number;
    /** The full heading line, e.g. "## Context" — kept raw so it can be rendered as markdown. */
    headingMarkdown: string;
    /** Heading text without the leading hashes. Used for plain-text needs (aria labels). */
    headingText: string;
    /** Markdown between this heading and its first child (or the end of the section). */
    body: string;
    children: MarkdownSection[];
}

export interface MarkdownOutline {
    /** Markdown before the first heading. Empty when the document opens with a heading. */
    intro: string;
    sections: MarkdownSection[];
}

const HEADING = /^(#{1,6})\s+(.*)$/;
/**
 * Inline markdown a heading may carry. `headingText` is used where only plain text can
 * render — the side panel's outline rows, aria labels — and a heading written as
 * `## **Bold**` must not show its asterisks there. `headingMarkdown` keeps the raw line.
 */
const stripInlineMarkdown = (text: string): string =>
    text
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/(\*\*\*|___)(.*?)\1/g, '$2')
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(\*|_)(.*?)\1/g, '$2')
        .replace(/~~(.*?)~~/g, '$1')
        .trim();
const FENCE = /^\s*(```|~~~)/;

type Draft = Omit<MarkdownSection, 'body' | 'children'> & { bodyLines: string[]; children: Draft[] };

const joinBody = (lines: string[]): string => lines.join('\n').replace(/^\n+|\s+$/g, '');

const finalize = (draft: Draft): MarkdownSection => ({
    id: draft.id,
    level: draft.level,
    headingMarkdown: draft.headingMarkdown,
    headingText: draft.headingText,
    body: joinBody(draft.bodyLines),
    children: draft.children.map(finalize),
});

/**
 * Builds the outline. Heading levels may skip (`#` straight to `###`) — a section is
 * nested under the nearest preceding section of a lower level, whatever that level is.
 */
export const splitMarkdownSections = (content: string): MarkdownOutline => {
    if (!content || typeof content !== 'string') {
        return { intro: '', sections: [] };
    }

    const introLines: string[] = [];
    const roots: Draft[] = [];
    /** Open ancestors, outermost first. The last entry owns the lines being read. */
    const stack: Draft[] = [];
    let inFence = false;

    for (const line of content.split('\n')) {
        if (FENCE.test(line)) {
            inFence = !inFence;
        }

        const match = inFence ? null : line.match(HEADING);
        if (!match) {
            (stack.length ? stack[stack.length - 1].bodyLines : introLines).push(line);
            continue;
        }

        const level = match[1].length;
        while (stack.length && stack[stack.length - 1].level >= level) {
            stack.pop();
        }

        const parent = stack[stack.length - 1];
        const siblings = parent ? parent.children : roots;
        const draft: Draft = {
            id: parent ? `${parent.id}.${siblings.length}` : String(siblings.length),
            level,
            headingMarkdown: line.trim(),
            headingText: stripInlineMarkdown(match[2]),
            bodyLines: [],
            children: [],
        };
        siblings.push(draft);
        stack.push(draft);
    }

    return { intro: joinBody(introLines), sections: roots.map(finalize) };
};

/** True when the document has no headings at all — the caller can then render it flat. */
export const hasSections = (outline: MarkdownOutline): boolean => outline.sections.length > 0;

/** Every section id in the tree, used for "collapse all". */
export const collectSectionIds = (sections: MarkdownSection[]): string[] =>
    sections.flatMap((section) => [section.id, ...collectSectionIds(section.children)]);

/** Ids of the sections whose heading or body contains the query, plus their ancestors. */
export const findSectionIdsMatching = (sections: MarkdownSection[], query: string): string[] => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    const hits: string[] = [];
    const walk = (nodes: MarkdownSection[], ancestors: string[]): void => {
        for (const node of nodes) {
            const chain = [...ancestors, node.id];
            const own = `${node.headingText}\n${node.body}`.toLowerCase();
            if (own.includes(needle)) {
                hits.push(...chain);
            }
            walk(node.children, chain);
        }
    };
    walk(sections, []);
    return Array.from(new Set(hits));
};
