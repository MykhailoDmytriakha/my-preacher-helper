import type { ContentNode } from '@/models/models';

/**
 * Why this exists: legacy study notes are flat `content: string` markdown.
 * When we backfill them into the node-tree model we want the result to be
 * a *workable* tree — headings become nested nodes, paragraph blocks become
 * the text on the closest enclosing node. A single-root tree with the whole
 * markdown blob in `root.text` would technically work but defeat the
 * purpose: the user would have to immediately re-split everything by hand.
 *
 * This parser is intentionally minimal: ATX headings (`#`..`######`) drive
 * nesting, fenced code blocks are preserved as plain text inside the
 * current node (not interpreted as headings — `# inside ```...``` ` stays
 * literal), and everything else collects under the most recently opened
 * heading. No list parsing, no front-matter, no MDX — we keep the tree
 * shallow and let users restructure further from the visual editor.
 */

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const FENCE_RE = /^```/;

let idCounter = 0;
const makeId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  idCounter += 1;
  return `mn-${Date.now()}-${idCounter}`;
};

const emptyNode = (header?: string): ContentNode => ({
  id: makeId(),
  ...(header ? { header } : {}),
  children: [],
});

interface Frame {
  level: number;
  node: ContentNode;
  textBuffer: string[];
}

function flushBuffer(frame: Frame): void {
  const text = frame.textBuffer.join('\n').trim();
  if (text) {
    frame.node.text = frame.node.text ? `${frame.node.text}\n\n${text}` : text;
  }
  frame.textBuffer = [];
}

/**
 * Convert a markdown string to a single-root ContentNode tree.
 *
 * Behaviour:
 * - Empty / whitespace-only input → root with no header and no text.
 * - Content with no headings → single root with the whole text.
 * - Content starting with headings → root captures any pre-heading prose
 *   as `root.text`; each heading opens a new branch at its level.
 * - Skipped heading levels (e.g. `# A` then `### B`) attach to the
 *   closest open ancestor — no synthetic intermediate nodes.
 */
export function markdownToNodeTree(content: string): ContentNode {
  const root = emptyNode();
  const stack: Frame[] = [{ level: 0, node: root, textBuffer: [] }];

  const lines = (content ?? '').split(/\r?\n/);
  let inFence = false;

  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      stack[stack.length - 1].textBuffer.push(line);
      continue;
    }

    if (!inFence) {
      const m = line.match(HEADING_RE);
      if (m) {
        const level = m[1].length;
        flushBuffer(stack[stack.length - 1]);

        while (stack.length > 1 && stack[stack.length - 1].level >= level) {
          stack.pop();
        }

        const newNode = emptyNode(m[2].trim());
        stack[stack.length - 1].node.children!.push(newNode);
        stack.push({ level, node: newNode, textBuffer: [] });
        continue;
      }
    }

    stack[stack.length - 1].textBuffer.push(line);
  }

  // Flush trailing buffer on each open frame (root → leaves).
  for (const frame of stack) {
    flushBuffer(frame);
  }

  // Drop empty children arrays so equality checks with hand-written
  // fixtures stay stable.
  pruneEmptyChildren(root);
  return root;
}

function pruneEmptyChildren(node: ContentNode): void {
  if (node.children) {
    if (node.children.length === 0) {
      delete node.children;
    } else {
      for (const child of node.children) pruneEmptyChildren(child);
    }
  }
}
