'use client';

import Link from 'next/link';
import React, { memo, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Link as MdastLink, Root, Text } from 'mdast';
import type { Node as UnistNode, Parent as UnistParent } from 'unist';
import type { PluggableList, Plugin } from 'unified';

import HighlightedText from '@components/HighlightedText';
import {
    STUDIES_LINK_PREFIX,
    WIKILINK_CHIP_CLASS,
    WIKILINK_CHIP_GLYPH,
    WIKILINK_DATA_ATTR,
    WIKILINK_ID_REGEX_SOURCE,
} from '@components/studies/node/wikilinkConstants';

interface MarkdownDisplayProps {
    content: string;
    className?: string;
    compact?: boolean;
    /** Optional search query to highlight within the content */
    searchQuery?: string;
    /**
     * When true, `[[noteId]]` substrings are rendered as inline chips linking
     * to `/studies/<noteId>` (in-app navigation). Off by default so legacy
     * callers keep their existing behaviour.
     */
    enableWikiLinks?: boolean;
    /**
     * Resolve a study note ID to its display title. When provided, wikilink
     * chips show the resolved title instead of the raw ID. Returning
     * `undefined`/empty falls back to the ID, so partially-loaded caches
     * still render something useful instead of breaking.
     */
    wikilinkResolver?: (id: string) => string | undefined;
}

const WIKI_LINK_PATTERN = new RegExp(`\\[\\[(${WIKILINK_ID_REGEX_SOURCE})\\]\\]`, 'g');
const SKIP_WIKILINK_CHILDREN = new Set(['code', 'inlineCode', 'link']);

interface RemarkWikilinksOptions {
    resolver?: (id: string) => string | undefined;
}

type WikilinkReplacementNode = MdastLink | Text;
type MutableUnistParent = UnistParent & { children: UnistNode[] };

// Helper to transform [Type: Content] into code blocks for custom rendering
const formatStructuredBlocks = (text: string) => {
    if (!text) return "";

    // Replace [Type: Content] with ```type\nContent\n```
    // We use a regex that captures the type and the content
    // Types: Illustration, Application, Question, Quote, Definition
    const blockRegex = /\[(Illustration|Application|Question|Quote|Definition):\s*([\s\S]*?)\]/g;

    return text.replace(blockRegex, (_match, type, content) => {
        return `\n\`\`\`${type.toLowerCase()}\n${content.trim()}\n\`\`\`\n`;
    });
};

const createWikilinkNode = (
    id: string,
    resolver?: (id: string) => string | undefined
): MdastLink => {
    const resolved = resolver?.(id)?.trim();
    const labelSource = resolved && resolved.length > 0 ? resolved : id;
    // The `#wiki` hash marker distinguishes a wikilink-generated link
    // from a hand-authored `[label](/studies/xxx)` markdown link. The
    // `a:` renderer below treats only the marked variant as a chip;
    // unmarked study links render as plain links.
    return {
        type: 'link',
        url: `${STUDIES_LINK_PREFIX}${id}#wiki`,
        children: [{ type: 'text', value: `${WIKILINK_CHIP_GLYPH} ${labelSource}` }],
    };
};

const splitWikilinkText = (
    value: string,
    resolver?: (id: string) => string | undefined
): WikilinkReplacementNode[] | null => {
    WIKI_LINK_PATTERN.lastIndex = 0;

    const replacement: WikilinkReplacementNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = WIKI_LINK_PATTERN.exec(value)) !== null) {
        const [rawMatch, id] = match;
        const matchIndex = match.index;

        if (matchIndex > lastIndex) {
            replacement.push({ type: 'text', value: value.slice(lastIndex, matchIndex) } satisfies Text);
        }

        replacement.push(createWikilinkNode(id, resolver));
        lastIndex = matchIndex + rawMatch.length;
    }

    WIKI_LINK_PATTERN.lastIndex = 0;

    if (replacement.length === 0) {
        return null;
    }

    if (lastIndex < value.length) {
        replacement.push({ type: 'text', value: value.slice(lastIndex) } satisfies Text);
    }

    return replacement;
};

const hasChildren = (node: UnistNode): node is MutableUnistParent =>
    Array.isArray((node as { children?: unknown }).children);

const transformWikilinkChildren = (
    node: MutableUnistParent,
    resolver?: (id: string) => string | undefined
) => {
    for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];

        if (SKIP_WIKILINK_CHILDREN.has(child.type)) {
            continue;
        }

        if (child.type === 'text') {
            const replacement = splitWikilinkText((child as Text).value, resolver);

            if (replacement) {
                node.children.splice(index, 1, ...replacement);
                index += replacement.length - 1;
            }

            continue;
        }

        if (hasChildren(child)) {
            transformWikilinkChildren(child, resolver);
        }
    }
};

export const remarkWikilinks: Plugin<[RemarkWikilinksOptions?], Root> = (options = {}) => {
    return (tree) => {
        transformWikilinkChildren(tree, options.resolver);
    };
};

const MarkdownDisplay = ({ content, className = '', compact = false, searchQuery = '', enableWikiLinks = false, wikilinkResolver }: MarkdownDisplayProps) => {
    const processedContent = useMemo(() => {
        return formatStructuredBlocks(content);
    }, [content]);

    const remarkPlugins = useMemo<PluggableList>(() => {
        if (!enableWikiLinks) {
            return [remarkGfm];
        }

        return [remarkGfm, [remarkWikilinks, { resolver: wikilinkResolver }]];
    }, [enableWikiLinks, wikilinkResolver]);

    const renderHighlighted = useCallback(
        (node: React.ReactNode) =>
            typeof node === 'string' && searchQuery.trim()
                ? <HighlightedText text={node} searchQuery={searchQuery} />
                : node,
        [searchQuery]
    );

    return (
        <div className={`prose dark:prose-invert max-w-none break-words ${compact ? 'prose-sm' : ''} ${className}`}>
            <ReactMarkdown
                remarkPlugins={remarkPlugins}
                components={{
                    // Override link behavior — wiki-links to study notes stay in-app,
                    // everything else opens in a new tab.
                    a: ({ href, children, ...props }) => {
                        // Only marked wikilinks (`/studies/<id>#wiki`) get
                        // chip treatment + click interception. Bare
                        // `/studies/<id>` links the user typed by hand
                        // route through the default in-app `<Link>` below.
                        const isWikilinkChip =
                            typeof href === 'string'
                            && href.startsWith(STUDIES_LINK_PREFIX)
                            && href.endsWith('#wiki');
                        if (isWikilinkChip) {
                            const wikilinkId = href.slice(
                                STUDIES_LINK_PREFIX.length,
                                href.length - '#wiki'.length
                            );
                            return (
                                <Link
                                    href={`${STUDIES_LINK_PREFIX}${wikilinkId}`}
                                    {...{ [WIKILINK_DATA_ATTR]: wikilinkId }}
                                    className={WIKILINK_CHIP_CLASS}
                                >
                                    {children}
                                </Link>
                            );
                        }
                        return (
                            <a {...props} href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
                                {children}
                            </a>
                        );
                    },
                    // Ensure lists are properly spaced
                    ul: ({ ...props }) => <ul {...props} className="my-2 list-disc pl-4" />,
                    ol: ({ ...props }) => <ol {...props} className="my-2 list-decimal pl-4" />,
                    // Tweak headings (h1, h2, h3 are defined below with highlighting)
                    // Text node highlighting when search is active
                    p: ({ children, ...props }) => (
                        <p {...props}>
                            {React.Children.map(children, renderHighlighted)}
                        </p>
                    ),
                    li: ({ children, ...props }) => (
                        <li {...props}>
                            {React.Children.map(children, renderHighlighted)}
                        </li>
                    ),
                    strong: ({ children, ...props }) => (
                        <strong {...props}>
                            {React.Children.map(children, renderHighlighted)}
                        </strong>
                    ),
                    em: ({ children, ...props }) => (
                        <em {...props}>
                            {React.Children.map(children, renderHighlighted)}
                        </em>
                    ),
                    // Add highlighting for headings
                    h1: ({ children, ...props }) => (
                        <h3 {...props} className="text-lg font-bold mt-4 mb-2">
                            {React.Children.map(children, renderHighlighted)}
                        </h3>
                    ),
                    h2: ({ children, ...props }) => (
                        <h4 {...props} className="text-base font-bold mt-3 mb-2">
                            {React.Children.map(children, renderHighlighted)}
                        </h4>
                    ),
                    h3: ({ children, ...props }) => (
                        <h5 {...props} className="text-sm font-bold mt-2 mb-1">
                            {React.Children.map(children, renderHighlighted)}
                        </h5>
                    ),
                    h4: ({ children, ...props }) => (
                        <h6 {...props} className="text-xs font-bold mt-2 mb-1">
                            {React.Children.map(children, renderHighlighted)}
                        </h6>
                    ),
                    // Custom renderer for code blocks to handle our structured types
                    code: ({ inline, className, children, ...props }: { inline?: boolean; className?: string; children?: React.ReactNode }) => {
                        const match = /language-(\w+)/.exec(className || '');
                        const type = match ? match[1] : '';
                        const isStructuredBlock = ['illustration', 'application', 'question', 'quote', 'definition'].includes(type);

                        if (!inline && isStructuredBlock) {
                            const title = type.charAt(0).toUpperCase() + type.slice(1);
                            let bgClass = 'bg-gray-100 dark:bg-gray-800';
                            let borderClass = 'border-gray-300 dark:border-gray-600';
                            let icon = '📝';

                            switch (type) {
                                case 'illustration':
                                    bgClass = 'bg-amber-50 dark:bg-amber-900/20';
                                    borderClass = 'border-amber-200 dark:border-amber-800';
                                    icon = '💡';
                                    break;
                                case 'application':
                                    bgClass = 'bg-green-50 dark:bg-green-900/20';
                                    borderClass = 'border-green-200 dark:border-green-800';
                                    icon = '🚀';
                                    break;
                                case 'question':
                                    bgClass = 'bg-blue-50 dark:bg-blue-900/20';
                                    borderClass = 'border-blue-200 dark:border-blue-800';
                                    icon = '❓';
                                    break;
                                case 'quote':
                                    bgClass = 'bg-purple-50 dark:bg-purple-900/20';
                                    borderClass = 'border-purple-200 dark:border-purple-800';
                                    icon = '💬';
                                    break;
                                case 'definition':
                                    bgClass = 'bg-slate-50 dark:bg-slate-800';
                                    borderClass = 'border-slate-200 dark:border-slate-700';
                                    icon = '📖';
                                    break;
                            }

                            return (
                                <div className={`my-3 p-3 rounded-md border-l-4 ${bgClass} ${borderClass} text-sm`}>
                                    <div className="font-bold mb-1 flex items-center gap-2 opacity-80">
                                        <span>{icon}</span>
                                        <span>{title}</span>
                                    </div>
                                    <div className="text-gray-800 dark:text-gray-200">
                                        {searchQuery ? (
                                            <HighlightedText text={String(children).replace(/\n$/, '')} searchQuery={searchQuery} />
                                        ) : (
                                            String(children).replace(/\n$/, '')
                                        )}
                                    </div>
                                </div>
                            );
                        }

                        return <code className={className} {...props}>{children}</code>;
                    }
                }}
            >
                {processedContent}
            </ReactMarkdown>
        </div>
    );
};

export default memo(MarkdownDisplay);
