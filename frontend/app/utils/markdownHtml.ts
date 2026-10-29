import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

import type { Element, Root, RootContent } from 'hast';
import type { PluggableList } from 'unified';

/** The editor's inline HTML extends the existing safe Markdown allow-list. */
export const markdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'mark'],
};

const CONTENT_PREFIX = defaultSchema.clobberPrefix || 'user-content-';

/** Keep the sanitizer's namespace once, including for already-prefixed Markdown footnotes. */
const namespaced = (value: string): string => {
  let suffix = value;
  while (suffix.startsWith(CONTENT_PREFIX)) suffix = suffix.slice(CONTENT_PREFIX.length);
  return CONTENT_PREFIX + suffix;
};

/** Resolve only targets present in this card; unmatched and outside links remain as authored. */
function reconnectReferences(node: Element, targets: ReadonlyMap<string, string>): void {
  const href = node.properties.href;
  if (typeof href === 'string' && href.startsWith('#')) {
    try {
      const target = targets.get(namespaced(decodeURIComponent(href.slice(1))));
      if (target) node.properties.href = '#' + target;
    } catch { /* An invalid encoded fragment stays as authored. */ }
  }
  for (const key of ['ariaDescribedBy', 'ariaLabelledBy'] as const) {
    const value = node.properties[key];
    if (!value) continue;
    const references = Array.isArray(value) ? value : String(value).split(/\s+/);
    node.properties[key] = references.map(reference => {
      return targets.get(namespaced(String(reference))) ?? reference;
    });
  }
}

/** Each reading card owns its safe targets, including when another card uses the same label. */
function rehypeSanitizedAnchors(scope: string) {
  const scopeToken = scope.replace(/[^a-zA-Z0-9_-]/g, '_');
  return (tree: Root) => {
    const elements: Element[] = [];
    const collect = (node: Root | RootContent): void => {
      if (node.type === 'element') elements.push(node);
      if ('children' in node) node.children.forEach(collect);
    };
    collect(tree);
    const targets = new Map<string, string>();
    for (const node of elements) {
      for (const key of ['id', 'name'] as const) {
        const value = node.properties[key];
        if (typeof value !== 'string') continue;
        const canonical = namespaced(value);
        const scoped = CONTENT_PREFIX + scopeToken + '-' + canonical.slice(CONTENT_PREFIX.length);
        node.properties[key] = scoped;
        targets.set(canonical, scoped);
      }
    }
    elements.forEach(node => reconnectReferences(node, targets));
  };
}

/** Parse author HTML, sanitize it, then preserve safe local navigation before feature plugins. */
export const createMarkdownHtmlPlugins = (scope: string): PluggableList => [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
  [rehypeSanitizedAnchors, scope],
];
