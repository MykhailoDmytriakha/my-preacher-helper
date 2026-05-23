import type { ContentNode, ContentNodeMedia, StudyNote } from '@/models/models';

/**
 * Why these helpers exist: study notes are mid-migration from a flat
 * `content: string` (markdown) to a tree of `ContentNode` (Lego primitive).
 * During the dual-rendering period both shapes coexist. Consumers that need
 * the full canonical document should use `getStudyText`; title-bearing UI
 * shells should use `getStudyBodyText` so the root title is not rendered
 * twice.
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

function mediaEquals(a: readonly ContentNodeMedia[] | undefined, b: readonly ContentNodeMedia[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

function nodeOwnContentEquals(a: ContentNode, b: ContentNode): boolean {
  return (a.header ?? '') === (b.header ?? '')
    && (a.text ?? '') === (b.text ?? '')
    && mediaEquals(a.media, b.media);
}

function normalizeTitle(value: string | undefined | null): string {
  return value?.replace(/\s+/g, ' ').trim().toLowerCase() ?? '';
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

function renderNodeBody(root: ContentNode, rootTitle?: string | null): string[] {
  const blocks: string[] = [];
  const firstChild = root.children?.[0];
  const rootMirrorsFirstChild = firstChild ? nodeOwnContentEquals(root, firstChild) : false;
  const rootHeaderIsShellTitle = normalizeTitle(root.header) !== ''
    && normalizeTitle(root.header) === normalizeTitle(rootTitle);

  if (!rootMirrorsFirstChild) {
    if (isNonEmpty(root.header) && !rootHeaderIsShellTitle) {
      blocks.push(`${'#'.repeat(clampHeadingDepth(0))} ${root.header!.trim()}`);
    }

    if (isNonEmpty(root.text)) {
      blocks.push(root.text!.trim());
    }

    if (root.media?.length) {
      blocks.push(root.media.map(mediaToMarkdown).join('\n'));
    }
  }

  if (root.children?.length) {
    for (const child of root.children) {
      blocks.push(...renderNode(child, 1));
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

/**
 * Render the content that lives under the study root. Use this in UI shells
 * that already render the study title separately: cards, focus mode, copy.
 *
 * The root node's `header` is intentionally omitted because it is the note
 * title in those shells. If the root header differs from the shell title, it
 * is preserved as legacy body content. Root text/media remain body content
 * unless the root is a legacy mirror of its first child; in that case the
 * mirrored root content is suppressed and the first child renders once.
 */
export function nodeTreeToBodyMarkdown(root: ContentNode, rootTitle?: string | null): string {
  return renderNodeBody(root, rootTitle).join('\n\n').trim();
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
 * Returns the full canonical text content of a study note.
 * Use this for sync, full-document search/indexing, AI input, and public
 * share paths. Title-bearing UI shells such as cards, focus mode, and copy
 * formatting should use `getStudyBodyText` so they do not render the root
 * title twice.
 *
 * When the note carries a `rootNode` it wins — `content` may be stale
 * if a writer forgot the sync invariant. When there's no tree we fall
 * back to legacy `content`.
 */
export function getStudyText(note: StudyNote): string {
  if (hasNodeTree(note)) return nodeTreeToMarkdown(note.rootNode);
  return note.content ?? '';
}

/**
 * Returns the study body for surfaces that already render `note.title`.
 * `getStudyText` stays the full canonical tree serialization; this helper is
 * the structural projection for title-bearing UI shells.
 */
export function getStudyBodyText(note: StudyNote): string {
  if (hasNodeTree(note)) return nodeTreeToBodyMarkdown(note.rootNode, note.title);
  return note.content ?? '';
}

/**
 * Backward-compatible name for compact note previews.
 */
export function getStudyPreviewText(note: StudyNote): string {
  return getStudyBodyText(note);
}
