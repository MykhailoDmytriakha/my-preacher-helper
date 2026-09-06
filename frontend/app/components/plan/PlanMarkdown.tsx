import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { planBodyIndent, planHeadingIndent, preparePlanMarkdown } from '@/utils/planHierarchy';

import styles from './PlanMarkdown.module.css';

import type { Element, Root } from 'hast';

/** Group rendered blocks after Markdown has resolved document-wide links and footnotes. */
function groupPlanSections() {
  return (tree: Root) => {
    const children: Root['children'] = [];
    let body: Element | undefined;
    const group = (kind: 'heading' | 'body', level: number): Element => ({
      type: 'element',
      tagName: 'div',
      properties: {
        [`data-plan-${kind}-level`]: level,
        style: `padding-inline-start: ${(kind === 'heading' ? planHeadingIndent(level) : planBodyIndent(level)) * 1.5}rem`,
      },
      children: [],
    });
    for (const node of tree.children) {
      const heading = node.type === 'element' && /^h([1-6])$/.exec(node.tagName);
      if (heading) {
        const level = Number(heading[1]);
        const title = group('heading', level);
        title.children.push(node as Element);
        body = group('body', level);
        children.push(title, body);
      } else if (body && node.type !== 'doctype') {
        body.children.push(node);
      } else {
        children.push(node);
      }
    }
    tree.children = children;
  };
}

/** A complete section body owns its indentation in reading, preaching and PDF output. */
export default function PlanMarkdown({ markdown, className = '' }: { markdown: string; className?: string }) {
  return (
    <div className={`markdown-content ${styles.content} ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[groupPlanSections]}>
        {preparePlanMarkdown(markdown)}
      </ReactMarkdown>
    </div>
  );
}
