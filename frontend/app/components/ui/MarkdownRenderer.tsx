"use client";

import React from "react";

interface MarkdownRendererProps {
  markdown: string;
  section?: "introduction" | "main" | "conclusion";
}

export const MarkdownRenderer = ({ markdown, section }: MarkdownRendererProps) => {
  // Simple markdown-to-HTML converter for basic formatting
  const convertMarkdownToHtml = (text: string): string => {
    if (!text) return "";
    
    return text
      // Bold text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic text
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Headers
      .replace(/^### (.*$)/gm, '<h3 class="text-lg font-semibold mb-2 mt-4">$1</h3>')
      .replace(/^## (.*$)/gm, '<h2 class="text-xl font-semibold mb-3 mt-4">$1</h2>')
      .replace(/^# (.*$)/gm, '<h1 class="text-2xl font-bold mb-4 mt-4">$1</h1>')
      // Line breaks
      .replace(/\n\n/g, '</p><p class="mb-3">')
      .replace(/\n/g, '<br />');
  };

  const getSectionStyles = () => {
    switch (section) {
      case "introduction":
        return "text-blue-800 dark:text-blue-200";
      case "main":
        return "text-purple-800 dark:text-purple-200";
      case "conclusion":
        return "text-green-800 dark:text-green-200";
      default:
        return "text-gray-800 dark:text-gray-200";
    }
  };

  const htmlContent = convertMarkdownToHtml(markdown);
  
  return (
    <div
      className={`prose prose-sm max-w-none ${getSectionStyles()}`}
      dangerouslySetInnerHTML={{
        __html: htmlContent ? `<p class="mb-3">${htmlContent}</p>` : markdown,
      }}
    />
  );
}; 