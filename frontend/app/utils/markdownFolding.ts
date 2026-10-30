import { isMarkdownHeading } from './markdownHeadings';

import type { MarkdownSection } from './markdownSections';
import type { Element, Root, RootContent } from 'hast';

export const FOLDING_TAGS = {
  section: 'note-fold-section', heading: 'note-fold-heading', body: 'note-fold-body', content: 'note-fold-content',
} as const;

const wrapper = (tagName: string, children: Element['children'] = [], id?: string): Element => ({
  type: 'element', tagName, properties: id === undefined ? {} : { dataSectionId: id }, children,
});
const flatten = (sections: readonly MarkdownSection[]): MarkdownSection[] =>
  sections.flatMap(section => [section, ...flatten(section.children)]);

const isDocumentFootnotes = (node: RootContent): node is Element & { tagName: 'section' } =>
  node.type === 'element' && node.tagName === 'section' && !node.position && 'dataFootnotes' in node.properties;

/** Place a resolved ordinary block without manufacturing an empty opening wrapper. */
function appendBody(node: RootContent, stack: readonly { content: Element }[], roots: RootContent[], intro?: Element): Element | undefined {
  if (node.type === 'doctype') return intro;
  const body = stack[stack.length - 1]?.content;
  if (body) { body.children.push(node); return intro; }
  const opening = intro ?? wrapper(FOLDING_TAGS.content);
  if (!intro) roots.push(opening);
  opening.children.push(node);
  return opening;
}

/** Presentation follows resolution: definitions and fragment scope still belong to one document. */
export function markdownFoldingPlugin(sections: readonly MarkdownSection[]) {
  const ordered = flatten(sections);
  return () => (tree: Root): void => {
    const headings = tree.children.filter(isMarkdownHeading);
    if (headings.length !== ordered.length || headings.some((node, index) => Number(node.tagName[1]) !== ordered[index].level)) {
      // A stale external outline must never hide or misassign an authored block.
      tree.children = [wrapper(FOLDING_TAGS.content, tree.children.filter((node): node is Exclude<RootContent, { type: 'doctype' }> => node.type !== 'doctype'))];
      return;
    }
    const roots: RootContent[] = [];
    const stack: { section: MarkdownSection; body: Element; content: Element }[] = [];
    let intro: Element | undefined;
    let index = 0;
    for (const node of tree.children) {
      if (isMarkdownHeading(node)) {
        const section = ordered[index++];
        while (stack.length && stack[stack.length - 1].section.level >= section.level) stack.pop();
        const content = wrapper(FOLDING_TAGS.content);
        const body = wrapper(FOLDING_TAGS.body, [content], section.id);
        const grouped = wrapper(FOLDING_TAGS.section, [wrapper(FOLDING_TAGS.heading, [node], section.id), body], section.id);
        if (stack.length) stack[stack.length - 1].body.children.push(grouped);
        else roots.push(grouped);
        stack.push({ section, body, content });
      } else if (isDocumentFootnotes(node)) {
        roots.push(wrapper(FOLDING_TAGS.content, [node]));
      } else intro = appendBody(node, stack, roots, intro);
    }

    tree.children = roots;
    annotateSectionTargets(tree);
  };
}

/** Keep local fragment navigation in this reader, including targets temporarily hidden by a fold. */
function annotateSectionTargets(tree: Root): void {
    const targets = new Map<string, string | null>();
    const links: Element[] = [];
    const visit = (node: Root | RootContent, owner: string | null): void => {
      if (node.type === 'element') {
        if (node.tagName === FOLDING_TAGS.section) owner = String(node.properties.dataSectionId);
        if (typeof node.properties.id === 'string') {
          const id = node.properties.id;
          targets.set(id, targets.has(id) && targets.get(id) !== owner ? null : owner);
        }
        if (node.tagName === 'a') links.push(node);
      }
      if ('children' in node) node.children.forEach(child => visit(child, owner));
    };
    visit(tree, null);
    for (const link of links) {
      const href = link.properties.href;
      if (typeof href !== 'string' || !href.startsWith('#')) continue;
      try {
        const owner = targets.get(decodeURIComponent(href.slice(1)));
        if (owner !== undefined && owner !== null) link.properties.dataNoteRevealSection = owner;
      } catch { /* Malformed authored fragments retain their original behavior. */ }
    }
}
