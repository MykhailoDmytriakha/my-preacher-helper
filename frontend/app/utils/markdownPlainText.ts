import { readMarkdownHtml } from './markdownHtml';

import type { Element, RootContent } from 'hast';

export interface MarkdownPlainTextBlock {
  text: string;
  headingLevel?: number;
  blankBefore: boolean;
}

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

function renderList(node: Element, render: NodeRenderer, omitBulletMarkers = false): string {
  const start = typeof node.properties.start === 'number' ? node.properties.start : 1;
  return node.children.filter(isElement).filter(child => child.tagName === 'li')
    .map((item, index) => {
      const marker = node.tagName === 'ol' ? `${start + index}. ` : omitBulletMarkers ? '' : '- ';
      const body = renderFlow(item.children, render, '\n');
      return body.split('\n').map((line, lineIndex) =>
        (lineIndex ? '  ' : marker) + line).join('\n');
    }).join('\n');
}

function renderLink(node: Element, render: NodeRenderer, includeTarget: boolean): string {
  if ('dataFootnoteBackref' in node.properties) return '';
  const label = node.children.map(render).join('');
  if ('dataFootnoteRef' in node.properties) return `[${label}]`;
  if (!includeTarget) return label;
  const href = node.properties.href;
  if (typeof href !== 'string' || href.startsWith('#') || href === label) return label;
  return label ? `${label} (${href})` : href;
}

interface RenderOptions {
  includeLinkTargets?: boolean;
  omitBulletMarkers?: boolean;
}

function renderElement(node: Element, render: NodeRenderer, renderLinkLabel: NodeRenderer, options: RenderOptions): string {
  // Screen-reader labels are navigation controls, not authored document words.
  const classes = node.properties.className;
  if (Array.isArray(classes) && classes.includes('sr-only')) return '';
  if (node.tagName === 'code') return literalText(node);
  if (node.tagName === 'pre') return literalText(node).replace(/\n$/, '');
  if (node.tagName === 'br') return '\n';
  if (node.tagName === 'hr') return '---';
  if (node.tagName === 'img') return String(node.properties.alt ?? '');
  if (node.tagName === 'input') return node.properties.checked ? '[x]' : '[ ]';
  if (node.tagName === 'a') return renderLink(node, renderLinkLabel, options.includeLinkTargets !== false);
  if (node.tagName === 'ol' || node.tagName === 'ul') return renderList(node, render, options.omitBulletMarkers);
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

function createRenderer(transformText: (text: string) => string, renderLinkLabel?: NodeRenderer, options: RenderOptions = {}): NodeRenderer {
  const render: NodeRenderer = node => {
    if (node.type === 'text') return transformText(node.value);
    return isElement(node) ? renderElement(node, render, renderLinkLabel ?? render, options) : '';
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
  const tree = readMarkdownHtml(content);
  const nodes = meaningful(tree.children);
  return nodes.map((node, index) => {
    const level = isElement(node) ? /^h([1-6])$/.exec(node.tagName) : null;
    const previous = nodes[index - 1];
    const blankBefore = !previous?.position || !node.position
      || node.position.start.line > previous.position.end.line + 1;
    return { text: render(node), blankBefore, ...(level ? { headingLevel: Number(level[1]) } : {}) };
  }).filter(block => block.text.length > 0);
}

/** Accessible heading label from the same safe reader, with link labels rather than URLs. */
export function markdownHeadingText(headingMarkdown: string | Element): string {
  const heading = typeof headingMarkdown === 'string'
    ? readMarkdownHtml(headingMarkdown).children.find(node => isElement(node) && /^h[1-6]$/.test(node.tagName))
    : headingMarkdown;
  return heading ? createRenderer(text => text, undefined, { includeLinkTargets: false })(heading).trim() : '';
}


/** A preview joins thoughts without exposing their Markdown/HTML source syntax. */
const joinPreview = (before: string, after: string): string =>
  before ? `${before}${/[.!?:;,…»"”)]$/.test(before) ? ' ' : ' · '}${after}` : after;

const previewRenderer = createRenderer(
  // Retain the former tolerance for an orphan emphasis mark in legacy excerpts; code is literal.
  text => text.replace(/\*+|__|`/g, ''), undefined,
  { includeLinkTargets: false, omitBulletMarkers: true },
);

const previewLine = (node: RootContent): string => previewRenderer(node).split('\n')
  .map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).reduce(joinPreview, '');

/** Keep only already-parsed nodes before the source anchor; never parse a severed container. */
function beforePreviewAnchor(node: RootContent, content: string, at: number, mention?: string): RootContent | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start !== undefined && start >= at) return null;
  if (end !== undefined && end <= at) return node;
  if (node.type === 'text' && start !== undefined) {
    const rawBefore = content.slice(start, at);
    const occurrence = mention ? rawBefore.split(mention).length - 1 : 0;
    let offset = -1;
    if (mention) {
      for (let index = 0; index <= occurrence; index += 1) offset = node.value.indexOf(mention, offset + 1);
    }
    return { ...node, value: node.value.slice(0, offset >= 0 ? offset : Math.max(0, at - start)) };
  }
  return isElement(node) ? { ...node, children: node.children.flatMap(child => {
    const prefix = beforePreviewAnchor(child, content, at, mention);
    return prefix && prefix.type !== 'doctype' ? [prefix] : [];
  }) } : node;
}

function buildPreviewDocument(content: string) {
  let text = '';
  const blocks = meaningful(readMarkdownHtml(content).children).map(node => {
    const words = previewLine(node);
    const joined = words ? joinPreview(text, words) : text;
    const start = joined.length - words.length;
    text = joined;
    return { text: words, start, node };
  });
  return { content, text, blocks };
}

// One bounded document serves consecutive references; no library or account data is accumulated.
let lastPreview: ReturnType<typeof buildPreviewDocument> | null = null;
function previewDocument(content: string) {
  if (lastPreview?.content === content) return lastPreview;
  const document = buildPreviewDocument(content);
  lastPreview = content.length <= 100_000 ? document : null;
  return document;
}

/** Whole-document safe-reader words; authored examples in code remain literal. */
export function markdownPreviewText(content: string): string {
  return typeof content === 'string' && content ? previewDocument(content).text : '';
}

/** Crop visible words, never raw source: a crop must not sever an HTML tag or a code container. */
export function markdownPreviewExcerpt(content: string, sourceAt = 0, mention?: string): string {
  if (!content) return '';
  const { text, blocks } = previewDocument(content);
  const block = blocks.find(({ node }) => node.position?.start.offset !== undefined && node.position.end.offset !== undefined
    && node.position.start.offset <= sourceAt && sourceAt < node.position.end.offset);
  const prefix = block ? beforePreviewAnchor(block.node, content, sourceAt, mention) : null;
  const beforeAnchor = prefix ? previewLine(prefix).length : 0;
  const label = mention?.replace(/\s+/g, ' ');
  const inBlock = label && block ? block.text.indexOf(label, beforeAnchor) : -1;
  const at = block ? block.start + (inBlock >= 0 ? inBlock : beforeAnchor) : 0;
  const near = Math.max(0, at - 60);
  const start = near && /\S/.test(text[near - 1] ?? '')
    ? Math.min(at, text.indexOf(' ', near) + 1 || near) : near;
  const end = Math.min(text.length, Math.max(at + 200, start + 260));
  return `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}
