import { FOLDING_TAGS, markdownFoldingPlugin } from '@/utils/markdownFolding';
import { readMarkdownHtml } from '@/utils/markdownHtml';
import { splitMarkdownSections } from '@/utils/markdownSections';

import type { Root, RootContent } from 'hast';

const descendants = (root: Root | RootContent): RootContent[] =>
  'children' in root ? root.children.flatMap(node => [node, ...descendants(node)]) : [];

it('groups resolved blocks without dropping or duplicating any original node', () => {
  const source = 'Intro[^note].\n\n# Main\n\nBody.\n\n## Nested\n\n```text\n# Literal\n```\n\n# Last\n\n[^note]: Shared note.';
  const tree = readMarkdownHtml(source);
  const original = descendants(tree);
  markdownFoldingPlugin(splitMarkdownSections(source).sections)()(tree);
  const result = descendants(tree);
  for (const node of original) expect(result.filter(value => value === node)).toHaveLength(1);
  expect(tree.children.filter(node => node.type === 'element' && node.tagName === FOLDING_TAGS.section)).toHaveLength(2);
  const footer = tree.children.find(node => node.type === 'element' && node.tagName === FOLDING_TAGS.content && descendants(node).some(child => child.type === 'element' && 'dataFootnotes' in child.properties));
  expect(footer).toBeDefined();
});

it('keeps the complete resolved document readable when an external outline does not match', () => {
  const tree = readMarkdownHtml('# First\nBody.\n# Second\nTail.');
  const original = descendants(tree);
  markdownFoldingPlugin(splitMarkdownSections('# Different\nOld body.').sections)()(tree);
  expect(tree.children).toHaveLength(1);
  expect(tree.children[0]).toMatchObject({ tagName: FOLDING_TAGS.content });
  const result = descendants(tree);
  for (const node of original) expect(result.filter(value => value === node)).toHaveLength(1);
  expect(result.filter(node => node.type === 'element' && node.tagName === FOLDING_TAGS.section)).toHaveLength(0);
});
