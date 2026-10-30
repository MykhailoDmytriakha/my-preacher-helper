import { splitMarkdownSections } from '@/utils/markdownSections';
import { splitNoteIntoSections } from '@/utils/noteSections';
import { readMarkdownHtml } from '@/utils/markdownHtml';

jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

describe('canonical root heading boundaries', () => {
  it.each([
    ['no indentation', '# Title\nBody', 'Title', 1],
    ['one space', ' # Title\nBody', 'Title', 1],
    ['two spaces', '  ## Title\nBody', 'Title', 2],
    ['three spaces', '   ### Deep title\nBody', 'Deep title', 3],
    ['tab after marker', '#\tTitle\nBody', 'Title', 1],
    ['multiple tabs after marker', '##\t\tTitle\nBody', 'Title', 2],
  ])('recognizes an ATX heading with %s', (_name, content, title, level) => {
    const outline = splitMarkdownSections(content, { preserveBodyWhitespace: true });
    const cut = splitNoteIntoSections(content);

    expect(outline.sections).toHaveLength(1);
    expect(outline.sections[0]).toMatchObject({
      level,
      headingText: title,
      body: 'Body',
    });
    expect(cut).toHaveLength(1);
    expect(cut[0].heading).toBe(title);
    expect(cut[0].text).toContain('Body');
  });

  it.each([
    ['single-line Setext', 'Title\n===\nBody', 1],
    ['multi-line Setext', 'First title line\nSecond title line\n---\nBody', 2],
    ['root HTML h1', '<h1>HTML title</h1>\nBody', 1],
    ['root HTML h2', '<h2>HTML title</h2>\nBody', 2],
  ])('uses %s as a section boundary', (_name, content, level) => {
    const outline = splitMarkdownSections(content, { preserveBodyWhitespace: true });
    const cut = splitNoteIntoSections(content);

    expect(outline.sections).toHaveLength(1);
    expect(outline.sections[0].level).toBe(level);
    expect(outline.sections[0].headingText.toLowerCase().replace(/\s+/g, ' ').trim()).toContain('title');
    expect(outline.sections[0].body).toBe('Body');
    expect(cut).toHaveLength(1);
    expect(cut[0].heading.toLowerCase()).toContain('title');
  });

  it.each([
    ['CRLF', '# First\r\nBody\r\n# Second\r\nTail'],
    ['bare CR', '# First\rBody\r# Second\rTail'],
  ])('retains section boundaries and body bytes with %s line endings', (_name, content) => {
    const outline = splitMarkdownSections(content, { preserveBodyWhitespace: true });
    const cut = splitNoteIntoSections(content);

    expect(outline.sections.map(section => section.headingText)).toEqual(['First', 'Second']);
    expect(outline.sections[0].body).toBe('Body');
    expect(outline.sections[1].body).toBe('Tail');
    expect(cut.map(section => section.heading)).toEqual(['First', 'Second']);
    expect(cut[0].text).toContain('Body');
    expect(cut[1].text).toContain('Tail');
  });

  it.each(['#', '## '])('keeps %s as a valid empty heading section', heading => {
    const content = `${heading}\nBody remains here`;
    const outline = splitMarkdownSections(content, { preserveBodyWhitespace: true });
    const cut = splitNoteIntoSections(content);

    expect(outline.sections).toHaveLength(1);
    expect(outline.sections[0].headingMarkdown).toBe(heading);
    expect(outline.sections[0].headingText).toBe('');
    expect(outline.sections[0].body).toBe('Body remains here');
    expect(cut).toHaveLength(1);
    expect(cut[0].text).toBe(content);
    expect(cut[0].heading).toBe('');
  });

  it('keeps raw heading markdown and meaningful body whitespace', () => {
    const content = '  ## **A title** ##\n\n  indented prose\n    const value = 1;\n\n# Next\n  tail  ';
    const outline = splitMarkdownSections(content, { preserveBodyWhitespace: true });

    expect(outline.sections[0].headingMarkdown).toBe('  ## **A title** ##');
    expect(outline.sections[0].body).toBe('\n  indented prose\n    const value = 1;\n');
    expect(outline.sections[1].headingMarkdown).toBe('# Next');
    expect(outline.sections[1].body).toBe('  tail  ');
  });

  it.each([
    ['list item', '- item\n  # nested list heading\n  body\n# Root\nroot body', 'nested list heading'],
    ['block quote', '> # quoted heading\n> quoted body\n# Root\nroot body', 'quoted heading'],
    ['list quote', '- > # nested quoted heading\n  > quoted body\n# Root\nroot body', 'nested quoted heading'],
  ])('keeps a heading inside a %s in the intro instead of making a section', (_name, content, nestedText) => {
    const outline = splitMarkdownSections(content, { preserveBodyWhitespace: true });
    const cut = splitNoteIntoSections(content);

    expect(outline.intro.toLowerCase()).toContain(nestedText);
    expect(outline.sections.map(section => section.headingText)).toEqual(['Root']);
    expect(outline.sections[0].body).toBe('root body');
    expect(cut.map(section => section.heading)).toEqual(['', 'Root']);
    expect(cut[0].text.toLowerCase()).toContain(nestedText);
  });

  it('does not promote fenced or four-space code headings', () => {
    const content = '````md\n# Fenced heading\n```\n# Still code\n````\n\n    # Indented code heading\n    const value = 1;\n\n# Real heading\nBody';
    const outline = splitMarkdownSections(content, { preserveBodyWhitespace: true });
    const cut = splitNoteIntoSections(content);

    expect(outline.sections.map(section => section.headingText)).toEqual(['Real heading']);
    expect(outline.intro).toContain('# Fenced heading');
    expect(outline.intro).toContain('    # Indented code heading');
    expect(cut.map(section => section.heading)).toEqual(['', 'Real heading']);
    expect(cut[0].text).toContain('# Fenced heading');
    expect(cut[0].text).toContain('    const value = 1;');
  });

  it('reads adjacent root HTML headings in source order without losing surrounding text', () => {
    const content = 'Before <span>prefix</span><h2>First</h2><h3>Second</h3> after';
    const tree = readMarkdownHtml(content);
    const headings = tree.children.filter(node => node.type === 'element' && /^h[1-6]$/.test(node.tagName));

    expect(headings.map(node => node.type === 'element' ? node.tagName : '')).toEqual(['h2', 'h3']);
    expect(headings.map(node => node.type === 'element' ? node.children.map(child => child.type === 'text' ? child.value : '').join('') : '')).toEqual(['First', 'Second']);
    expect(tree.children.some(node => node.type === 'element' && node.tagName === 'p' && node.children.some(child => child.type === 'text' && child.value.includes('Before')))).toBe(true);


    const outline = splitMarkdownSections(content, { preserveBodyWhitespace: true });
    const cut = splitNoteIntoSections(content);
    expect(outline.intro).toContain('Before <span>prefix</span>');
    expect(outline.sections[0].headingMarkdown).toBe('<h2>First</h2>');
    expect(outline.sections[0].children[0].headingMarkdown).toBe('<h3>Second</h3>');
    expect(outline.sections[0].children[0].body).toBe(' after');
    expect(cut.map(section => section.heading)).toEqual(['', 'First', 'Second']);
    expect(cut.map(section => section.text).join('')).toContain('Before <span>prefix</span>');
    expect(cut.map(section => section.text).join('')).toContain(' after');
  });
});
