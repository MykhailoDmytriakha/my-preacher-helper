'use client';

import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownDisplayProps {
    content: string;
    className?: string;
    compact?: boolean;
}

// Helper to transform [Type: Content] into code blocks for custom rendering
const formatStructuredBlocks = (text: string) => {
    if (!text) return "";

    // Replace [Type: Content] with ```type\nContent\n```
    // We use a regex that captures the type and the content
    // Types: Illustration, Application, Question, Quote, Definition
    const blockRegex = /\[(Illustration|Application|Question|Quote|Definition):\s*([\s\S]*?)\]/g;

    return text.replace(blockRegex, (match, type, content) => {
        return `\n\`\`\`${type.toLowerCase()}\n${content.trim()}\n\`\`\`\n`;
    });
};

const MarkdownDisplay = ({ content, className = '', compact = false }: MarkdownDisplayProps) => {
    const processedContent = React.useMemo(() => formatStructuredBlocks(content), [content]);

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
                    // Tweak headings
                    h1: ({ ...props }) => <h3 {...props} className="text-lg font-bold mt-4 mb-2" />,
                    h2: ({ ...props }) => <h4 {...props} className="text-base font-bold mt-3 mb-2" />,
                    h3: ({ ...props }) => <h5 {...props} className="text-sm font-bold mt-2 mb-1" />,
                    // Custom renderer for code blocks to handle our structured types
                    code: ({ node, inline, className, children, ...props }: any) => {
                        const match = /language-(\w+)/.exec(className || '');
                        const type = match ? match[1] : '';
                        const isStructuredBlock = ['illustration', 'application', 'question', 'quote', 'definition'].includes(type);

                        if (!inline && isStructuredBlock) {
                            let title = type.charAt(0).toUpperCase() + type.slice(1);
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
                                        {String(children).replace(/\n$/, '')}
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
