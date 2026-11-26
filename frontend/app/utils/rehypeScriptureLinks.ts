import { referencesInText, type ReferenceInText } from '@/utils/bibleLink';

import type { AppLocale } from '@/utils/appLocale';
import type { Element, ElementContent, Root, RootContent, Text } from 'hast';

export const SCRIPTURE_LINK_TAG = 'scripture-link';

const EXCLUDED = new Set(['a', 'code', 'pre', 'button', SCRIPTURE_LINK_TAG]);
const FORMATTING = new Set(['b', 'del', 'em', 'i', 'mark', 's', 'span', 'strong', 'u']);

function joinsInlineText(node: Element): boolean {
  // Keep authored fragment targets and attributed HTML elements at their original tree position.
  return FORMATTING.has(node.tagName) && Object.keys(node.properties).length === 0;
}

type InlineNode = Text | Element;
type InlinePart = { node: InlineNode; reference: ReferenceInText | null };
type InlineGroup = { nodes: RootContent[]; reference: ReferenceInText | null };

/** Parse the reading order once, then project each range back onto its original text nodes. */
function markRun(run: InlineNode[], locale: AppLocale, written: AppLocale | null, marked: Map<InlineNode, InlinePart[]>): void {
  // Treat CR as a line break without changing any offsets into the original nodes.
  const text = run.map(node => node.type === 'text' ? node.value : '').join('').replace(/\r/g, '\n');
  // Keep the surrounding prose for the parser's count checks, but reject a list whose opening
  // place was assembled across a soft line break. The parser already keeps continuations on one line.
  const found = referencesInText(text, locale, written).filter(({ raw, listHead }) =>
    !raw.includes('\n') && !listHead?.raw.includes('\n'),
  );
  let offset = 0;
  let index = 0;
  for (const node of run) {
    if (index >= found.length) break;
    if (node.type === 'element' || node.value.length === 0) {
      // Empty formatting inside a place belongs to that same link but contributes no characters.
      const reference = found[index];
      if (reference.start < offset && offset < reference.end) marked.set(node, [{ node, reference }]);
      continue;
    }
    const end = offset + node.value.length;
    const parts: InlinePart[] = [];
    let cursor = offset;
    const append = (until: number, reference: ReferenceInText | null) => {
      if (until <= cursor) return;
      parts.push({ node: { type: 'text', value: node.value.slice(cursor - offset, until - offset) }, reference });
      cursor = until;
    };
    while (index < found.length && found[index].start < end) {
      const reference = found[index];
      append(reference.start, null);
      append(Math.min(reference.end, end), reference);
      if (reference.end > end) break;
      index += 1;
    }
    if (parts.length) {
      append(end, null);
      marked.set(node, parts);
    }
    offset = end;
  }
}

function groupInline(children: RootContent[], marked: ReadonlyMap<InlineNode, InlinePart[]>): InlineGroup[] {
  const groups: InlineGroup[] = [];
  const append = (node: RootContent, reference: ReferenceInText | null) => {
    const previous = groups.at(-1);
    if (previous?.reference === reference) previous.nodes.push(node);
    else groups.push({ nodes: [node], reference });
  };

  for (const child of children) {
    const parts = child.type === 'text' || child.type === 'element' ? marked.get(child) : undefined;
    if (parts) {
      for (const part of parts) append(part.node, part.reference);
    } else if (child.type === 'element' && child.children.length > 0 && joinsInlineText(child)) {
      const inner = groupInline(child.children, marked);
      if (inner.length === 1 && !inner[0].reference) append(child, null);
      else {
        // One place may span multiple styles. Keep each style attached to its slice inside one link.
        for (const { nodes, reference } of inner) append({ ...child, children: nodes as ElementContent[] }, reference);
      }
    } else append(child, null);
  }
  return groups;
}

function linkChildren(parent: Root | Element, locale: AppLocale, written: AppLocale | null): void {
  const marked = new Map<InlineNode, InlinePart[]>();
  let run: InlineNode[] = [];
  const flush = () => {
    if (run.length) markRun(run, locale, written, marked);
    run = [];
  };
  const collect = (children: RootContent[]) => {
    for (const child of children) {
      if (child.type === 'text') run.push(child);
      else if (child.type === 'element' && joinsInlineText(child)) {
        if (child.children.length > 0) collect(child.children);
        else run.push(child);
      } else {
        flush();
        if (child.type === 'element' && !EXCLUDED.has(child.tagName)) linkChildren(child, locale, written);
      }
    }
  };
  collect(parent.children);
  flush();
  if (marked.size === 0) return;

  parent.children = groupInline(parent.children, marked).flatMap(({ nodes, reference }): RootContent[] => {
    if (!reference) return nodes;
    return [linkGroup(nodes as ElementContent[], reference)];
  }) as typeof parent.children;
}

function linkGroup(children: ElementContent[], found: ReferenceInText): Element {
  const first = children[0];
  // Keep a place entirely inside one style in that style's existing rendering context.
  if (children.length === 1 && first.type === 'element' && joinsInlineText(first)) {
    return { ...first, children: [linkGroup(first.children, found)] };
  }
  const { raw, reference, writtenIn } = found;
  return {
    type: 'element',
    tagName: SCRIPTURE_LINK_TAG,
    properties: { dataReference: JSON.stringify({ raw, reference, writtenIn }) },
    children,
  };
}

/** Runs after sanitizing. Only the app creates the interactive reference elements. */
export function rehypeScriptureLinks(locale: AppLocale, written: AppLocale | null = null) {
  return (tree: Root) => linkChildren(tree, locale, written);
}
