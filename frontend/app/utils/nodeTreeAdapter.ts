import type { ContentNode, ContentNodeMedia, StudyNote } from '@/models/models';

/**
 * Why these helpers exist: study notes are mid-migration from a flat
 * `content: string` (markdown) to a tree of `ContentNode` (Lego primitive).
 * During the dual-rendering period both shapes coexist — consumers that
 * only need text (search, preview, copy, AI input, public share) should
 * go through `getStudyText` so they stay agnostic of the storage format.
 *
 * The server also relies on `nodeTreeToMarkdown` to keep `note.content`
 * in sync with `note.rootNode` on every write, so anything that reads
 * `content` directly (legacy callers we haven't reached yet, BigQuery
 * exports, external integrations) still sees a meaningful string.
 */

export function hasNodeTree(
  note: StudyNote
): note is StudyNote & { rootNode: ContentNode } {
  return note.rootNode != null;
}

function isNonEmpty(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function clampHeadingDepth(depth: number): number {
  if (depth < 0) return 1;
  if (depth > 5) return 6;
  return depth + 1;
}

function mediaToMarkdown(item: ContentNodeMedia): string {
  const caption = item.caption?.trim() || item.url;
  if (item.type === 'image') return `![${caption}](${item.url})`;
  return `[${caption}](${item.url})`;
}

function renderNode(node: ContentNode, depth: number): string[] {
  const blocks: string[] = [];

  if (isNonEmpty(node.header)) {
    blocks.push(`${'#'.repeat(clampHeadingDepth(depth))} ${node.header!.trim()}`);
  }

  if (isNonEmpty(node.text)) {
    blocks.push(node.text!.trim());
  }

  if (node.media?.length) {
    blocks.push(node.media.map(mediaToMarkdown).join('\n'));
  }

  if (node.children?.length) {
    for (const child of node.children) {
      blocks.push(...renderNode(child, depth + 1));
    }
  }

  return blocks;
}

/**
 * Render a node-tree to a markdown string. Headings nest by depth (clamped
 * to h6). Children render after the parent's own content.
 *
 * Output is stable across calls — callers can compare strings for change
 * detection without worrying about whitespace drift.
 */
export function nodeTreeToMarkdown(root: ContentNode): string {
  return renderNode(root, 0).join('\n\n').trim();
}

function collectPlainText(node: ContentNode, out: string[]): void {
  if (isNonEmpty(node.header)) out.push(node.header!.trim());
  if (isNonEmpty(node.text)) out.push(node.text!.trim());
  if (node.children?.length) {
    for (const child of node.children) collectPlainText(child, out);
  }
}

/**
 * Flatten a node-tree to a single space-joined plaintext string.
 * Drops markdown syntax — intended for search indexes and snippets.
 */
export function nodeTreeToPlainText(root: ContentNode): string {
  const parts: string[] = [];
  collectPlainText(root, parts);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Returns the canonical text content of a study note for read paths
 * (search, preview, copy, AI input, public share).
 *
 * When the note carries a `rootNode` it wins — `content` may be stale
 * if a writer forgot the sync invariant. When there's no tree we fall
 * back to legacy `content`.
 */
export function getStudyText(note: StudyNote): string {
  if (hasNodeTree(note)) return nodeTreeToMarkdown(note.rootNode);
  return note.content ?? '';
}
