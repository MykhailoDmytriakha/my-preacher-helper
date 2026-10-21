import React, { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { MarkdownScriptureLink, rehypeScriptureLinks, SCRIPTURE_LINK_TAG, useScriptureLinks } from '@/components/bible/ScriptureLinks';
import { textLanguage } from '@/utils/appLocale';
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

/** A reference in a plan is drawn as a link by the shared piece, only where the screen opens it. */
const LINK_COMPONENTS = { [SCRIPTURE_LINK_TAG]: MarkdownScriptureLink } as Components;

/** A complete section body owns its indentation in reading, preaching and PDF output. */
export default function PlanMarkdown({ markdown, className = '' }: { markdown: string; className?: string }) {
  // A reference opens over the plan, in preaching and on the plan page alike; a PDF has no links.
  const links = useScriptureLinks();
  const linkLocale = links?.locale;
  // The language its references were written in: the sermon's, else this section's.
  const written = useMemo(() => (links ? links.written ?? textLanguage(markdown) : null), [markdown, links]);
  const rehypePlugins = useMemo(
    () => [groupPlanSections, ...(linkLocale ? [[rehypeScriptureLinks, linkLocale, written]] : [])] as NonNullable<React.ComponentProps<typeof ReactMarkdown>['rehypePlugins']>,
    [linkLocale, written]
  );
  return (
    <div className={`markdown-content ${styles.content} ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={linkLocale ? LINK_COMPONENTS : undefined}>
        {preparePlanMarkdown(markdown)}
      </ReactMarkdown>
    </div>
  );
}
