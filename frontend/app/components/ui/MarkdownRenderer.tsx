"use client";

import React from "react";
import ReactMarkdown from "react-markdown";

import { sanitizeMarkdown } from "@/utils/markdownUtils";
import { SERMON_SECTION_COLORS } from "@/utils/themeColors";

interface MarkdownRendererProps {
  markdown: string;
  section?: "introduction" | "main" | "conclusion";
}

export const MarkdownRenderer = ({ markdown, section }: MarkdownRendererProps) => {
  const sectionTextClass = section === "introduction"
    ? `${SERMON_SECTION_COLORS.introduction.text}`
    : section === "main"
      ? `${SERMON_SECTION_COLORS.mainPart.text}`
      : section === "conclusion"
        ? `${SERMON_SECTION_COLORS.conclusion.text}`
        : "text-gray-700";

  const sectionDarkTextClass = section === "introduction"
    ? `dark:${SERMON_SECTION_COLORS.introduction.darkText}`
    : section === "main"
      ? `dark:${SERMON_SECTION_COLORS.mainPart.darkText}`
      : section === "conclusion"
        ? `dark:${SERMON_SECTION_COLORS.conclusion.darkText}`
        : "dark:text-gray-300";

  if (!markdown) return null;

  // Sanitize the markdown content
  const sanitizedMarkdown = sanitizeMarkdown(markdown);

  return (
    <div className={`prose prose-sm max-w-none ${sectionTextClass} ${sectionDarkTextClass}`}>
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
        {sanitizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}; 