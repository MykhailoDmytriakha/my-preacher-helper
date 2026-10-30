import { uniqueHeadingLookup } from '@/utils/headingLookup';
import { markdownBeforeHeading, markdownHeadingRanges } from '@/utils/markdownHeadings';

/**
 * Splits a markdown document into the section tree its headings already describe.
 *
 * Why this exists: a note is stored as one flat markdown string, and `MarkdownDisplay`
 * renders it as a flat stream — so the nesting the author wrote with `#`/`##`/`###`
 * is invisible on screen. Nothing is added to the stored text; this only recovers the
 * hierarchy that is already in it, so the reader can indent and fold it.
 *
 * Heading boundaries come from the same whole-document safe parser as the reader.
 * Nested list/quote headings and literal code stay inside their original container.
 */

export interface MarkdownSection {
    /** Stable within one parse of one document: the index path from the root, e.g. "0.2.1". */
    id: string;
    /** Heading level, 1-6, exactly as written. */
    level: number;
    /** The full heading block, e.g. "## Context" — kept raw so it can be rendered as markdown. */
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
/** Exact former outline spelling, retained only to locate already-saved source headings. */
const legacyOutlineHeading = (text: string): string =>
    text
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/(\*\*\*|___)(.*?)\1/g, '$2')
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(\*|_)(.*?)\1/g, '$2')
        .replace(/~~(.*?)~~/g, '$1')
        .trim();

type Draft = Omit<MarkdownSection, 'children'> & { children: Draft[] };

const finishBody = (content: string, preserveWhitespace: boolean): string =>
    preserveWhitespace ? content : content.replace(/^(?:\r\n|\r|\n)+|\s+$/g, '');

const finalize = (draft: Draft, preserveWhitespace: boolean): MarkdownSection => ({
    ...draft,
    body: finishBody(draft.body, preserveWhitespace),
    children: draft.children.map(child => finalize(child, preserveWhitespace)),
});

/**
 * Builds the outline. Heading levels may skip (`#` straight to `###`) — a section is
 * nested under the nearest preceding section of a lower level, whatever that level is.
 */
export const splitMarkdownSections = (
    content: string,
    options: { preserveBodyWhitespace?: boolean } = {}
): MarkdownOutline => {
    if (!content || typeof content !== 'string') {
        return { intro: '', sections: [] };
    }

    let intro = '';
    let cursor = 0;
    const roots: Draft[] = [];
    const stack: Draft[] = [];
    const append = (body: string): void => {
        if (stack.length) stack[stack.length - 1].body += body;
        else intro += body;
    };

    for (const heading of markdownHeadingRanges(content)) {
        append(markdownBeforeHeading(content, cursor, heading.start));
        while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
        const parent = stack[stack.length - 1];
        const siblings = parent ? parent.children : roots;
        const draft: Draft = {
            id: parent ? `${parent.id}.${siblings.length}` : String(siblings.length),
            level: heading.level,
            headingMarkdown: heading.source,
            headingText: heading.text,
            body: '', children: [],
        };
        siblings.push(draft);
        stack.push(draft);
        cursor = heading.bodyStart;
    }
    append(content.slice(cursor));
    const preserveWhitespace = options.preserveBodyWhitespace ?? false;
    return {
        intro: finishBody(intro, preserveWhitespace),
        sections: roots.map(root => finalize(root, preserveWhitespace)),
    };
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

/** The section with this id, at any depth — used to name the section being read. */
export const findSectionById = (
    sections: MarkdownSection[],
    id: string | null | undefined
): MarkdownSection | null => {
    if (!id) return null;
    for (const section of sections) {
        if (section.id === id) return section;
        const found = findSectionById(section.children, id);
        if (found) return found;
    }
    return null;
};

interface SectionHeading {
    id: string;
    headingText: string;
    headingMarkdown?: string;
    children: readonly SectionHeading[];
}

/** Historical aliases are lookup-only: they never replace the reader label or stored Markdown. */
export const sectionHeadingLookup = (sections: readonly SectionHeading[]): Map<string, string> => {
    const entries: { id: string; labels: string[] }[] = [];
    const walk = (nodes: readonly SectionHeading[]): void => {
        for (const section of nodes) {
            const labels = [section.headingText];
            const raw = section.headingMarkdown;
            const outline = raw?.match(HEADING);
            const cutter = raw?.trim().match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
            if (outline) labels.push(legacyOutlineHeading(outline[2]));
            // The former cutter removed all these characters even inside literal code.
            if (cutter) labels.push(cutter[1].replace(/[*_`]/g, '').trim());
            entries.push({ id: section.id, labels });
            walk(section.children);
        }
    };
    walk(sections);
    return uniqueHeadingLookup(entries);
};

/** Resolve only one real section, including an unambiguous historical source spelling. */
export const findSectionByHeading = (sections: readonly SectionHeading[], heading: string): string | null =>
    sectionHeadingLookup(sections).get(heading.trim()) ?? null;

/** Display-only caption: an unnamed authored section still exists and keeps its body. */
export const sectionDisplayLabel = (section: Pick<MarkdownSection, 'headingText'>, fallback: string): string =>
    section.headingText.trim() ? section.headingText : fallback;
