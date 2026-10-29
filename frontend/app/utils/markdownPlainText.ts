import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import { createMarkdownHtmlPlugins } from './markdownHtml';

import type { Element, Root, RootContent } from 'hast';

export interface MarkdownPlainTextBlock {
  text: string;
  headingLevel?: number;
  blankBefore: boolean;
}

// Resolve the whole document before projection: definitions can follow another heading.
const reader = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(createMarkdownHtmlPlugins('plain-text'))
  .freeze();

const FLOW_CONTAINERS = new Set(['blockquote', 'div', 'section', 'dd', 'dl', 'dt', 'details', 'td', 'th']);
const isElement = (node: RootContent): node is Element => node.type === 'element';
const meaningful = (nodes: RootContent[]): RootContent[] => nodes.filter(node =>
  node.type !== 'text' || node.value.trim().length > 0);

const literalText = (node: RootContent): string => {
  if (node.type === 'text') return node.value;
  return 'children' in node ? node.children.map(literalText).join('') : '';
};

type NodeRenderer = (node: RootContent) => string;

const BLOCK_TAGS = new Set([...FLOW_CONTAINERS, 'p', 'pre', 'ol', 'ul', 'table', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function renderFlow(nodes: RootContent[], render: NodeRenderer, separator: string): string {
  const blocks: string[] = [];
  let inline = '';
  for (const node of nodes) {
    if (isElement(node) && BLOCK_TAGS.has(node.tagName)) {
      if (inline.trim()) blocks.push(inline.replace(/\n+$/, ''));
      inline = '';
      blocks.push(render(node));
    } else inline += render(node);
  }
  if (inline.trim()) blocks.push(inline);
  return blocks.filter(Boolean).join(separator);
}

function renderList(node: Element, render: NodeRenderer): string {
  const start = typeof node.properties.start === 'number' ? node.properties.start : 1;
  return node.children.filter(isElement).filter(child => child.tagName === 'li')
    .map((item, index) => {
      const marker = node.tagName === 'ol' ? `${start + index}. ` : '- ';
      const body = renderFlow(item.children, render, '\n');
      return body.split('\n').map((line, lineIndex) =>
        (lineIndex ? '  ' : marker) + line).join('\n');
    }).join('\n');
}

function renderLink(node: Element, render: NodeRenderer): string {
  if ('dataFootnoteBackref' in node.properties) return '';
  const label = node.children.map(render).join('');
  if ('dataFootnoteRef' in node.properties) return `[${label}]`;
  const href = node.properties.href;
  if (typeof href !== 'string' || href.startsWith('#') || href === label) return label;
  return label ? `${label} (${href})` : href;
}

function renderElement(node: Element, render: NodeRenderer, renderLinkLabel: NodeRenderer): string {
  // Screen-reader labels are navigation controls, not authored document words.
  const classes = node.properties.className;
  if (Array.isArray(classes) && classes.includes('sr-only')) return '';
  if (node.tagName === 'code') return literalText(node);
  if (node.tagName === 'pre') return literalText(node).replace(/\n$/, '');
  if (node.tagName === 'br') return '\n';
  if (node.tagName === 'hr') return '---';
  if (node.tagName === 'img') return String(node.properties.alt ?? '');
  if (node.tagName === 'input') return node.properties.checked ? '[x]' : '[ ]';
  if (node.tagName === 'a') return renderLink(node, renderLinkLabel);
  if (node.tagName === 'ol' || node.tagName === 'ul') return renderList(node, render);
  if (node.tagName === 'tr') {
    return node.children.filter(isElement)
      .filter(child => child.tagName === 'td' || child.tagName === 'th')
      .map(cell => render(cell).trim().replace(/\n+/g, ' ')).join('\t');
  }
  if (['table', 'thead', 'tbody', 'tfoot'].includes(node.tagName)) {
    return meaningful(node.children).map(render).filter(Boolean).join('\n');
  }
  return FLOW_CONTAINERS.has(node.tagName)
    ? renderFlow(node.children, render, '\n\n')
    : node.children.map(render).join('');
}

function createRenderer(transformText: (text: string) => string, renderLinkLabel?: NodeRenderer): NodeRenderer {
  const render: NodeRenderer = node => {
    if (node.type === 'text') return transformText(node.value);
    return isElement(node) ? renderElement(node, render, renderLinkLabel ?? render) : '';
  };
  return render;
}

const literalRenderer = createRenderer(text => text);

/** Readable blocks; prose transforms never rewrite literal code or link display text. */
export function markdownToPlainTextBlocks(
  content: string,
  transformProse: (text: string) => string = text => text,
): MarkdownPlainTextBlock[] {
  if (!content) return [];
  const render = createRenderer(transformProse, literalRenderer);
  const tree = reader.runSync(reader.parse(content)) as Root;
  const nodes = meaningful(tree.children);
  return nodes.map((node, index) => {
    const level = isElement(node) ? /^h([1-6])$/.exec(node.tagName) : null;
    const previous = nodes[index - 1];
    const blankBefore = !previous?.position || !node.position
      || node.position.start.line > previous.position.end.line + 1;
    return { text: render(node), blankBefore, ...(level ? { headingLevel: Number(level[1]) } : {}) };
  }).filter(block => block.text.length > 0);
}
