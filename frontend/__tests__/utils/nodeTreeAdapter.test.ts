import type { ContentNode, StudyNote } from '@/models/models';
import {
  getStudyText,
  hasNodeTree,
  nodeTreeToMarkdown,
  nodeTreeToPlainText,
} from '@/utils/nodeTreeAdapter';

const baseNote: StudyNote = {
  id: 'note-1',
  userId: 'user-1',
  content: 'hello world',
  title: '',
  scriptureRefs: [],
  tags: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  isDraft: false,
};

const makeNode = (overrides: Partial<ContentNode> = {}): ContentNode => ({
  id: 'n-root',
  ...overrides,
});

describe('hasNodeTree', () => {
  it('returns false for notes without rootNode', () => {
    expect(hasNodeTree(baseNote)).toBe(false);
  });

  it('returns true when rootNode is set', () => {
    const note = { ...baseNote, rootNode: makeNode({ text: 'tree' }) };
    expect(hasNodeTree(note)).toBe(true);
  });

  it('narrows the type so rootNode is non-null', () => {
    const note = { ...baseNote, rootNode: makeNode({ text: 'tree' }) };
    if (hasNodeTree(note)) {
      // Compile-time assertion: rootNode is non-optional here.
      expect(note.rootNode.id).toBe('n-root');
    }
  });
});

describe('nodeTreeToMarkdown', () => {
  it('returns empty string for an empty node', () => {
    expect(nodeTreeToMarkdown(makeNode())).toBe('');
  });

  it('renders header as h1 at root depth', () => {
    expect(nodeTreeToMarkdown(makeNode({ header: 'Title' }))).toBe('# Title');
  });

  it('renders text only when header missing', () => {
    expect(nodeTreeToMarkdown(makeNode({ text: 'Body paragraph.' }))).toBe('Body paragraph.');
  });

  it('joins header, text, media with blank lines', () => {
    const out = nodeTreeToMarkdown(
      makeNode({
        header: 'Idea',
        text: 'Some thought.',
        media: [{ id: 'm1', type: 'url', url: 'https://example.com', caption: 'Source' }],
      })
    );
    expect(out).toBe('# Idea\n\nSome thought.\n\n[Source](https://example.com)');
  });

  it('renders image media as markdown image syntax', () => {
    const out = nodeTreeToMarkdown(
      makeNode({ media: [{ id: 'm1', type: 'image', url: 'https://img/x.png' }] })
    );
    expect(out).toBe('![https://img/x.png](https://img/x.png)');
  });

  it('nests children with deeper heading levels', () => {
    const out = nodeTreeToMarkdown(
      makeNode({
        header: 'Root',
        children: [
          makeNode({ id: 'c1', header: 'Sub' }),
          makeNode({ id: 'c2', text: 'Plain child text' }),
        ],
      })
    );
    expect(out).toBe('# Root\n\n## Sub\n\nPlain child text');
  });

  it('clamps heading depth to h6', () => {
    let node: ContentNode = makeNode({ id: 'deep', header: 'Bottom' });
    for (let i = 0; i < 10; i++) {
      node = makeNode({ id: `n-${i}`, header: `Level ${i}`, children: [node] });
    }
    const md = nodeTreeToMarkdown(node);
    expect(md).toContain('###### Bottom');
    expect(md).not.toMatch(/^#{7,}/m);
  });

  it('skips empty header/text on a parent while still rendering children', () => {
    expect(
      nodeTreeToMarkdown(makeNode({ header: '   ', text: '', children: [makeNode({ id: 'c', text: 'kept' })] }))
    ).toBe('kept');
  });

  it('treats blank text as empty (does not emit blank paragraph)', () => {
    expect(nodeTreeToMarkdown(makeNode({ text: '\n\n' }))).toBe('');
  });

  it('produces stable output across calls (no whitespace drift)', () => {
    const node = makeNode({
      header: 'Idea',
      text: 'Body',
      children: [makeNode({ id: 'c', text: 'child' })],
    });
    expect(nodeTreeToMarkdown(node)).toBe(nodeTreeToMarkdown(node));
  });
});

describe('nodeTreeToPlainText', () => {
  it('strips media and joins text with spaces', () => {
    const out = nodeTreeToPlainText(
      makeNode({
        header: 'Idea',
        text: 'Some thought.',
        media: [{ id: 'm1', type: 'image', url: 'https://x' }],
        children: [makeNode({ id: 'c', text: 'child text' })],
      })
    );
    expect(out).toBe('Idea Some thought. child text');
  });

  it('returns empty string for an empty tree', () => {
    expect(nodeTreeToPlainText(makeNode())).toBe('');
  });

  it('collapses internal whitespace', () => {
    expect(nodeTreeToPlainText(makeNode({ text: 'a\n\n\tb   c' }))).toBe('a b c');
  });
});

describe('getStudyText', () => {
  it('returns legacy content when no rootNode', () => {
    expect(getStudyText(baseNote)).toBe('hello world');
    expect(getStudyText({ ...baseNote, content: undefined as unknown as string })).toBe('');
  });

  it('prefers rootNode markdown over content when both present', () => {
    const note = {
      ...baseNote,
      content: 'stale text',
      rootNode: makeNode({ header: 'Fresh', text: 'live' }),
    };
    expect(getStudyText(note)).toBe('# Fresh\n\nlive');
  });

  it('returns empty string for empty rootNode', () => {
    const note = { ...baseNote, content: 'ignored', rootNode: makeNode() };
    expect(getStudyText(note)).toBe('');
  });
});
