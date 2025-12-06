'use client';

import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownDisplayProps {
    content: string;
    className?: string;
    compact?: boolean;
}

const MarkdownDisplay = ({ content, className = '', compact = false }: MarkdownDisplayProps) => {
    return (
        <div className={`prose dark:prose-invert max-w-none break-words ${compact ? 'prose-sm' : ''} ${className}`}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    // Override link behavior to open in new tab
                    a: ({ ...props }) => (
                        <a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline" />
                    ),
                    // Ensure lists are properly spaced
                    ul: ({ ...props }) => <ul {...props} className="my-2 list-disc pl-4" />,
                    ol: ({ ...props }) => <ol {...props} className="my-2 list-decimal pl-4" />,
                    // Tweak headings (adjust sizes if needed, but prose default is usually okay)
                    h1: ({ ...props }) => <h3 {...props} className="text-lg font-bold mt-4 mb-2" />,
                    h2: ({ ...props }) => <h4 {...props} className="text-base font-bold mt-3 mb-2" />,
                    h3: ({ ...props }) => <h5 {...props} className="text-sm font-bold mt-2 mb-1" />,
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
};

export default memo(MarkdownDisplay);
