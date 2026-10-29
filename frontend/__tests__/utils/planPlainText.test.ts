jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');
jest.unmock('react-markdown');
jest.unmock('remark-gfm');

import { planMarkdownToPlainText } from '@/utils/planHierarchy';

describe('plan TXT plain-text conversion', () => {
  it('keeps ordinary HTML emphasis tags readable, including in headings', () => {
    const plain = planMarkdownToPlainText('## <u>Underlined</u> <strong>heading</strong>\n\n<u>underlined</u> and <strong>bold <mark>marked</mark></strong> words');

    expect(plain).toContain('Underlined heading');
    expect(plain).toContain('underlined and bold marked words');
  });

  it('preserves literal HTML-like text, Markdown markers, and operators in inline and fenced code', () => {
    const plain = planMarkdownToPlainText('Inline `<u>code sample</u> **literal stars** => ->`\n\n```text\n<u>code sample</u> **literal stars** => ->\n```');

    expect(plain).toContain('<u>code sample</u> **literal stars** => ->');
    expect(plain.match(/<u>code sample<\/u>/g)).toHaveLength(2);
  });

  it('renders HTML tables with readable row and cell boundaries', () => {
    const plain = planMarkdownToPlainText('<table><tr><th>Topic</th><th>Text</th></tr><tr><td>Grace</td><td>Given freely</td></tr></table>');

    expect(plain).toContain('Topic\tText');
    expect(plain).toContain('Grace\tGiven freely');
    expect(plain).toContain('\n');
  });

  it('preserves Markdown table cells and nested list structure', () => {
    const plain = planMarkdownToPlainText('| Topic | Text |\n| --- | --- |\n| Grace | Given freely |\n\n- Outer\n  - Nested');

    expect(plain).toContain('Topic\tText');
    expect(plain).toContain('Grace\tGiven freely');
    expect(plain).toContain('- Outer');
    expect(plain).toContain('- Nested');
  });

  it('keeps link URLs, decodes entity text once, and retains angle autolinks', () => {
    const plain = planMarkdownToPlainText('See [Tom &amp; Jerry](https://example.com/a?x=1&amp;y=2) and <https://example.org/path>.');

    expect(plain).toContain('Tom & Jerry');
    expect(plain).toContain('https://example.com/a?x=1&y=2');
    expect(plain).toContain('https://example.org/path');
    expect(plain).not.toContain('&amp;');
  });

  it('retains empty-input and ordinary heading hierarchy behavior', () => {
    expect(planMarkdownToPlainText('')).toBe('');

    const plain = planMarkdownToPlainText('## Parent\n\nParent text\n\n### Child\n\nChild text');
    expect(plain).toContain('Parent text');
    expect(plain).toContain('  Child');
    expect(plain).toContain('    Child text');
  });

  it('keeps escaped markup literal and decodes entities only once', () => {
    const plain = planMarkdownToPlainText('Show &lt;u&gt;literal&lt;/u&gt; and &amp;lt;once&amp;gt;.');
    expect(plain).toBe('Show <u>literal</u> and &lt;once&gt;.');
  });

  it('preserves every code example independently and normalizes only prose arrows', () => {
    const code = '<u>literal</u> ***** => -> &amp;';
    const plain = planMarkdownToPlainText('First -> Second\n\n`' + code + '`\n\n~~~text\n' + code + '\n~~~');
    expect(plain).toContain('First → Second');
    expect(plain.split(code)).toHaveLength(3);
    expect(plain).not.toContain('~~~');
  });

  it('resolves definitions across headings before producing plain text', () => {
    const plain = planMarkdownToPlainText('## [Heading][link]\n\nSee [verse][link] and note[^n].\n\n### Child\n\n[link]: https://example.org/reference\n[^n]: Shared footnote');
    expect(plain).toContain('Heading (https://example.org/reference)');
    expect(plain).toContain('verse (https://example.org/reference)');
    expect(plain).toContain('Shared footnote');
    expect(plain).not.toContain('user-content-');
  });

  it('retains literal pipes and styled words within HTML table cells', () => {
    const plain = planMarkdownToPlainText('<table><tr><th>Passage</th><th>Words</th></tr><tr><td>John 3:16</td><td><u>Grace | truth</u><br>Remain</td></tr></table>');
    expect(plain).toBe('Passage\tWords\nJohn 3:16\tGrace | truth Remain');
  });

  it('keeps ordered numbers, task states, quote words, and nested indentation', () => {
    const plain = planMarkdownToPlainText('### Child\n\n3. First\n4. Second\n\n- [x] Done\n- [ ] Later\n  - Nested\n\n> Quoted **words**');
    expect(plain).toContain('    3. First\n    4. Second');
    expect(plain).toContain('    - [x] Done');
    expect(plain).toContain('    - [ ] Later\n      - Nested');
    expect(plain).toContain('    Quoted words');
  });

  it('preserves safe HTML link destinations while excluding executable markup', () => {
    const plain = planMarkdownToPlainText('<a href="https://example.org/">Read <u>here</u></a> <script>secret()</script>');
    expect(plain).toBe('Read here (https://example.org/) ');
    expect(plain).not.toContain('secret');
  });


  it('retains autolink display URLs and explicit link labels without prose-arrow rewriting', () => {
    const plain = planMarkdownToPlainText('https://example.org/a->b and [First -> Second](https://example.org/path)');
    expect(plain).toContain('https://example.org/a->b');
    expect(plain).toContain('First -> Second (https://example.org/path)');
    expect(plain).not.toContain('→');
  });


it('preserves the space between inline marks inside an HTML flow container', () => {
  expect(planMarkdownToPlainText('<div><u>One</u> <strong>Two</strong></div>')).toBe('One Two');
});
it('separates paragraphs inside an HTML table cell', () => {
  expect(planMarkdownToPlainText('<table><tr><td><p>One</p><p>Two</p></td></tr></table>')).toBe('One Two');
});


  it('keeps authored footnotes without reader-only headings or return controls', () => {
    const plain = planMarkdownToPlainText('Read the note[^n].\n\n[^n]: Authored footnote');
    expect(plain).toContain('Read the note[1].');
    expect(plain).toContain('1. Authored footnote');
    expect(plain).not.toContain('Footnotes');
    expect(plain).not.toContain('↩');
  });

});
