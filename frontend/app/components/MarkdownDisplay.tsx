'use client';

import React, { memo, useCallback, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { MarkdownScriptureLink, rehypeScriptureLinks, SCRIPTURE_LINK_TAG, ScriptureText, useScriptureLinks } from '@/components/bible/ScriptureLinks';
import { useMarkdownHtmlPlugins } from '@/hooks/useMarkdownHtmlPlugins';
import { textLanguage } from '@/utils/appLocale';
import { prepareStructuredBlocks, STRUCTURED_BLOCK_TYPES } from '@/utils/markdownStructuredBlocks';
import HighlightedText from '@components/HighlightedText';

// Preserve the existing schema export for consumers while the common reader owns it.
export { markdownSanitizeSchema } from '@/utils/markdownHtml';

interface MarkdownDisplayProps {
    content: string;
    className?: string;
    compact?: boolean;
    /**
     * A comment's small grey hand under a verse (case 2026-10-12-block-diagram, 3.2): one size, no book spacing —
     * a heading is a bold line, lists and a quote sit tight. The caller gives the size and the grey.
     */
    pencil?: boolean;
    /** Optional search query to highlight within the content */
    searchQuery?: string;
}

/** The same typed block owns both its prose body and the removal of the code-only wrapper. */
const structuredBlockType = (className: unknown): string | null => {
    const classes = Array.isArray(className) ? className.join(' ') : className;
    const match = typeof classes === 'string' && /(?:^|\s)language-(\w+)(?:\s|$)/.exec(classes);
    return match && STRUCTURED_BLOCK_TYPES.some((type) => type === match[1]) ? match[1] : null;
};

const MarkdownDisplay = ({ content, className = '', compact = false, pencil = false, searchQuery = '' }: MarkdownDisplayProps) => {
    const processedContent = useMemo(() => prepareStructuredBlocks(content).markdown, [content]);
    const htmlPlugins = useMarkdownHtmlPlugins();
    // References become links where the screen gives them somewhere to open; elsewhere the text is as written.
    const scriptureLinks = useScriptureLinks();
    const linkLocale = scriptureLinks?.locale;
    // The language its references were written in: the document's, else this text's.
    const written = useMemo(() => (scriptureLinks ? scriptureLinks.written ?? textLanguage(content) : null), [content, scriptureLinks]);
    const rehypePlugins = useMemo(
        () => [...htmlPlugins, ...(linkLocale ? [[rehypeScriptureLinks, linkLocale, written]] : [])] as NonNullable<React.ComponentProps<typeof ReactMarkdown>['rehypePlugins']>,
        [htmlPlugins, linkLocale, written]
    );

    const renderHighlighted = useCallback(
        (node: React.ReactNode) =>
            typeof node === 'string' && searchQuery.trim()
                ? <HighlightedText text={node} searchQuery={searchQuery} />
                : node,
        [searchQuery]
    );

    return (
        <div className={pencil ? `max-w-none break-words ${className}` : `prose dark:prose-invert max-w-none break-words ${compact ? 'prose-sm' : ''} ${className}`}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                // The shared HTML pass preserves authored formatting and safe fragment targets.
                rehypePlugins={rehypePlugins}
                components={{
                    // A reference stays lit by the search too: opened from "24:26", the match is the link itself.
                    [SCRIPTURE_LINK_TAG]: ({ children, ...props }: React.ComponentProps<typeof MarkdownScriptureLink>) => (
                        <MarkdownScriptureLink {...props}>{React.Children.map(children, renderHighlighted)}</MarkdownScriptureLink>
                    ),
                    // Outside links open separately; a footnote stays beside its text.
                    a: ({ ...props }) => (
                        <a {...props} target={props.href?.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline" />
                    ),
                    // A table sizes its columns by their longest word, so a pasted link in a cell would widen the
                    // whole page; the table scrolls inside its own box instead.
                    table: ({ ...props }) => (
                        <div className="max-w-full overflow-x-auto"><table {...props} /></div>
                    ),
                    // Ensure lists are properly spaced
                    ul: ({ ...props }) => <ul {...props} className={`${pencil ? 'my-0.5' : 'my-2'} list-disc pl-4`} />,
                    ol: ({ ...props }) => <ol {...props} className={`${pencil ? 'my-0.5' : 'my-2'} list-decimal pl-4`} />,
                    ...(pencil ? {
                        blockquote: ({ children, ...props }: React.ComponentProps<'blockquote'>) => (
                            <blockquote {...props} className="my-0.5 border-l-2 border-gray-300 pl-2 italic dark:border-gray-600">{children}</blockquote>
                        ),
                    } : {}),
                    // Tweak headings (h1, h2, h3 are defined below with highlighting)
                    // Text node highlighting when search is active
                    p: ({ children, ...props }) => (
                        <p {...props} className={pencil ? 'my-0' : undefined}>
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
                    h1: ({ children, ...props }) => (pencil
                        ? <p {...props} className="my-0 font-semibold">{React.Children.map(children, renderHighlighted)}</p>
                        : <h3 {...props} className="text-lg font-bold mt-4 mb-2">
                            {React.Children.map(children, renderHighlighted)}
                        </h3>
                    ),
                    h2: ({ children, ...props }) => (pencil
                        ? <p {...props} className="my-0 font-semibold">{React.Children.map(children, renderHighlighted)}</p>
                        : <h4 {...props} className="text-base font-bold mt-3 mb-2">
                            {React.Children.map(children, renderHighlighted)}
                        </h4>
                    ),
                    h3: ({ children, ...props }) => (pencil
                        ? <p {...props} className="my-0 font-semibold">{React.Children.map(children, renderHighlighted)}</p>
                        : <h5 {...props} className="text-sm font-bold mt-2 mb-1">
                            {React.Children.map(children, renderHighlighted)}
                        </h5>
                    ),
                    h4: ({ children, ...props }) => (pencil
                        ? <p {...props} className="my-0 font-semibold">{React.Children.map(children, renderHighlighted)}</p>
                        : <h6 {...props} className="text-xs font-bold mt-2 mb-1">
                            {React.Children.map(children, renderHighlighted)}
                        </h6>
                    ),
                    // Structured prose has no code ancestor: a pre would prevent wrapping and widen a card.
                    pre: ({ children, node, ...props }) => {
                        const code = node?.children.length === 1 ? node.children[0] : null;
                        const type = code?.type === 'element' && code.tagName === 'code'
                            ? structuredBlockType(code.properties.className)
                            : null;
                        return type ? <>{children}</> : <pre {...props}>{children}</pre>;
                    },
                    // Custom renderer for code blocks to handle our structured types
                    code: ({ inline, className, children, ...props }: { inline?: boolean; className?: string; children?: React.ReactNode }) => {
                        const type = structuredBlockType(className);

                        if (!inline && type) {
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
                                <div className={`markdown-callout whitespace-pre-wrap [overflow-wrap:anywhere] my-3 p-3 rounded-md border-l-4 ${bgClass} ${borderClass} text-sm`}>
                                    <div className="font-bold mb-1 flex items-center gap-2 opacity-80">
                                        <span>{icon}</span>
                                        <span>{title}</span>
                                    </div>
                                    <div className="text-gray-800 dark:text-gray-200">
                                        {/* A quote often names its passage: it opens like any other reference, searched or not. */}
                                        <ScriptureText text={String(children).replace(/\n$/, '')} searchQuery={searchQuery} wrapSearchMatches />
                                    </div>
                                </div>
                            );
                        }

                        return <code className={className} {...props}>{children}</code>;
                    }
                } as Components}
            >
                {processedContent}
            </ReactMarkdown>
        </div>
    );
};

export default memo(MarkdownDisplay);
