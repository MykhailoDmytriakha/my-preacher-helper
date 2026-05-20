import { markdownToNodeTree } from '@/utils/nodeTreeMigration';

describe('markdownToNodeTree', () => {
  it('returns an empty single-root for empty input', () => {
    const root = markdownToNodeTree('');
    expect(root.header).toBeUndefined();
    expect(root.text).toBeUndefined();
    expect(root.children).toBeUndefined();
  });

  it('returns an empty single-root for whitespace-only input', () => {
    const root = markdownToNodeTree('   \n\n   \t  \n');
    expect(root.text).toBeUndefined();
    expect(root.children).toBeUndefined();
  });

  it('wraps a no-heading blob in root.text', () => {
    const root = markdownToNodeTree('Just a single paragraph.\nWith a second line.');
    expect(root.header).toBeUndefined();
    expect(root.text).toBe('Just a single paragraph.\nWith a second line.');
    expect(root.children).toBeUndefined();
  });

  it('opens a child branch on a top-level heading', () => {
    const root = markdownToNodeTree('# First\n\nBody of first.');
    expect(root.children).toHaveLength(1);
    expect(root.children![0].header).toBe('First');
    expect(root.children![0].text).toBe('Body of first.');
  });

  it('captures prose before the first heading on root.text', () => {
    const root = markdownToNodeTree('Intro paragraph.\n\n# First\n\nBody.');
    expect(root.text).toBe('Intro paragraph.');
    expect(root.children![0].header).toBe('First');
    expect(root.children![0].text).toBe('Body.');
  });

  it('nests h2 inside h1', () => {
    const md = '# A\n\ntext A\n\n## B\n\ntext B';
    const root = markdownToNodeTree(md);
    const a = root.children![0];
    expect(a.header).toBe('A');
    expect(a.text).toBe('text A');
    expect(a.children).toHaveLength(1);
    expect(a.children![0].header).toBe('B');
    expect(a.children![0].text).toBe('text B');
  });

  it('keeps siblings at the same level', () => {
    const md = '# A\n\ntext A\n\n# B\n\ntext B';
    const root = markdownToNodeTree(md);
    expect(root.children).toHaveLength(2);
    expect(root.children![0].header).toBe('A');
    expect(root.children![1].header).toBe('B');
  });

  it('attaches deeper headings under the closest ancestor when levels skip', () => {
    const md = '# A\n\n### Deep';
    const root = markdownToNodeTree(md);
    const a = root.children![0];
    expect(a.header).toBe('A');
    expect(a.children).toHaveLength(1);
    expect(a.children![0].header).toBe('Deep');
  });

  it('respects fenced code blocks (# inside fence is literal)', () => {
    const md = '# Real heading\n\n```\n# not a heading\nstill code\n```\n\nafter code';
    const root = markdownToNodeTree(md);
    const a = root.children![0];
    expect(a.header).toBe('Real heading');
    expect(a.text).toContain('```');
    expect(a.text).toContain('# not a heading');
    expect(a.text).toContain('still code');
    expect(a.text).toContain('after code');
    expect(a.children).toBeUndefined();
  });

  it('handles closing fences on the last line', () => {
    const md = '# Heading\n\n```\nincomplete';
    const root = markdownToNodeTree(md);
    expect(root.children![0].text).toContain('```');
    expect(root.children![0].text).toContain('incomplete');
  });

  it('preserves multiple paragraphs under a heading', () => {
    const md = '# A\n\nFirst para.\n\nSecond para.';
    const root = markdownToNodeTree(md);
    expect(root.children![0].text).toBe('First para.\n\nSecond para.');
  });

  it('handles markdown with only a heading and no body', () => {
    const root = markdownToNodeTree('# Just a heading');
    const a = root.children![0];
    expect(a.header).toBe('Just a heading');
    expect(a.text).toBeUndefined();
  });

  it('mints distinct ids for every produced node', () => {
    const md = '# A\n## B\n## C\n# D';
    const root = markdownToNodeTree(md);
    const ids = new Set<string>();
    const collect = (n: { id: string; children?: { id: string; children?: any }[] }) => {
      ids.add(n.id);
      n.children?.forEach(collect);
    };
    collect(root);
    expect(ids.size).toBe(5);
  });

  it('strips trailing whitespace from text blocks', () => {
    const root = markdownToNodeTree('# A\n\nBody   \n\n\n\n');
    expect(root.children![0].text).toBe('Body');
  });

  it('handles CRLF line endings', () => {
    const root = markdownToNodeTree('# A\r\n\r\nBody\r\n');
    expect(root.children![0].header).toBe('A');
    expect(root.children![0].text).toBe('Body');
  });
});
