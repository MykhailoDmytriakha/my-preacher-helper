"use client";

import React from "react";
import ReactMarkdown from "react-markdown";

interface MarkdownRendererProps {
  markdown: string;
  section?: "introduction" | "main" | "conclusion";
}

export const MarkdownRenderer = ({ markdown, section }: MarkdownRendererProps) => {
  const getSectionStyles = () => {
    switch (section) {
      case "introduction":
        return "text-green-700 dark:text-green-300";
      case "main":
        return "text-blue-700 dark:text-blue-300";
      case "conclusion":
        return "text-purple-700 dark:text-purple-300";
      default:
        return "text-gray-700 dark:text-gray-300";
    }
  };

  if (!markdown) return null;

  return (
    <div className={`prose prose-sm max-w-none ${getSectionStyles()}`}>
      <ReactMarkdown
        components={{
          // Customize how different elements are rendered
          p: ({ children }) => (
            <p className="mb-3 leading-relaxed">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-current">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-current">{children}</em>
          ),
          h1: ({ children }) => (
            <h1 className="text-xl font-bold mb-3 mt-4 text-current">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold mb-2 mt-3 text-current">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-medium mb-2 mt-3 text-current">{children}</h3>
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-inside mb-3 space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside mb-3 space-y-1">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-current">{children}</li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-current pl-4 italic my-3 opacity-80">
              {children}
            </blockquote>
          ),
          code: ({ children, className }) => {
            const isInline = !className;
            return isInline ? (
              <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-sm font-mono">
                {children}
              </code>
            ) : (
              <code className="block bg-gray-100 dark:bg-gray-800 p-3 rounded text-sm font-mono overflow-x-auto">
                {children}
              </code>
            );
          },
          a: ({ children, href }) => (
            <a 
              href={href} 
              className="underline text-current hover:opacity-80 transition-opacity"
              target={href?.startsWith('http') ? '_blank' : undefined}
              rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
            >
              {children}
            </a>
          )
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}; 