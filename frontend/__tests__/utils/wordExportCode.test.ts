import { Document, Paragraph, Table, Packer } from 'docx';
import JSZip from 'jszip';

import { parseInlineMarkdown, parseMarkdownToParagraphs } from '../../utils/wordExport';

async function docXml(children: (Paragraph | Table)[]): Promise<string> {
  const buffer = await Packer.toBuffer(new Document({ sections: [{ children }] }));
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml')!.async('string');
}

async function markdownXml(markdown: string): Promise<string> {
  return docXml(parseMarkdownToParagraphs(markdown) as (Paragraph | Table)[]);
}

function wordText(xml: string): string {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  return Array.from(document.getElementsByTagName('w:t')).map(node => node.textContent ?? '').join('');
}

function wordParagraphs(xml: string): string[] {
  const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const text = (node: Node): string => {
    if (node instanceof Element && node.namespaceURI === NS) {
      if (node.localName === 't') return node.textContent ?? '';
      if (node.localName === 'br' || node.localName === 'cr') return '\n';
      if (node.localName === 'tab') return '\t';
    }
    return Array.from(node.childNodes).map(text).join('');
  };
  return Array.from(document.getElementsByTagNameNS(NS, 'p')).map(text);
}

describe('Word literal Markdown code boundaries', () => {
  it('preserves ordinary inline code syntax as literal text and without formatting', async () => {
    const source = '`<u>under</u> **bold** ~~strike~~ &gt; &amp;gt;`';
    const xml = await docXml([new Paragraph({ children: parseInlineMarkdown(source) })]);
    const text = wordText(xml);

    expect(text).toContain('<u>under</u> **bold** ~~strike~~ &gt; &amp;gt;');
    expect(xml).not.toMatch(/<w:u(?:\s|\/?>)/);
    expect(xml).not.toMatch(/<w:b(?:\s|\/?>)/);
    expect(xml).not.toMatch(/<w:strike(?:\s|\/?>)/);
  });

  it('preserves multi-backtick inline spans containing a shorter backtick', async () => {
    const source = '``value `x` and **stars**``';
    const xml = await docXml([new Paragraph({ children: parseInlineMarkdown(source) })]);

    expect(wordText(xml)).toContain('value `x` and **stars**');
    expect(xml).not.toMatch(/<w:b(?:\s|\/?>)/);
  });

  it('normalizes multiline inline code with the real Markdown value', async () => {
    const source = '`first **line**\nsecond <u>line</u>`';
    const xml = await docXml([new Paragraph({ children: parseInlineMarkdown(source) })]);

    expect(wordText(xml)).toBe('first **line** second <u>line</u>');
    expect(wordText(xml)).not.toContain('`');
    expect(xml).not.toMatch(/<w:b(?:\s|\/?>)/);
    expect(xml).not.toMatch(/<w:u(?:\s|\/?>)/);
  });

  it('keeps shorter same-character and opposite-character fence-looking lines in code', async () => {
    const source = [
      '````text',
      'inside ```text and ~~~text remain literal',
      '<u>literal</u> **literal**',
      '````',
    ].join('\n');
    const xml = await markdownXml(source);

    expect(wordText(xml)).toContain('inside ```text and ~~~text remain literal');
    expect(wordText(xml)).toContain('<u>literal</u> **literal**');
    expect(xml).not.toMatch(/<w:u(?:\s|\/?>)/);
    expect(xml).not.toMatch(/<w:b(?:\s|\/?>)/);
  });

  it('preserves tilde-fenced code and a literal br tag', async () => {
    const source = '~~~text\n<u>literal</u> **stars** <br> &gt;\n~~~';
    const xml = await markdownXml(source);

    expect(wordText(xml)).toContain('<u>literal</u> **stars** <br> &gt;');
    expect(xml).not.toMatch(/<w:u(?:\s|\/?>)/);
    expect(xml).not.toMatch(/<w:b(?:\s|\/?>)/);
  });

  it('preserves blank lines within fenced code', async () => {
    const source = '```text\nfirst **line**\n\nsecond <u>line</u>\n```';
    const xml = await markdownXml(source);
    expect(wordParagraphs(xml).join('\n')).toBe('first **line**\n\nsecond <u>line</u>');
    expect(wordText(xml)).toContain('first **line**');
    expect(wordText(xml)).toContain('second <u>line</u>');
    expect(xml).not.toMatch(/<w:b(?:\s|\/?>)/);
    expect(xml).not.toMatch(/<w:u(?:\s|\/?>)/);
  });

  it('preserves indented code block content without interpreting inline formats', async () => {
    const xml = await markdownXml('Intro\n\n    <u>literal</u> **stars** ~~strike~~');

    expect(wordText(xml)).toContain('<u>literal</u> **stars** ~~strike~~');
    expect(xml).not.toMatch(/<w:u(?:\s|\/?>)/);
    expect(xml).not.toMatch(/<w:b(?:\s|\/?>)/);
    expect(xml).not.toMatch(/<w:strike(?:\s|\/?>)/);
  });

  it('preserves code blocks inside quote and list containers', async () => {
    const source = [
      '> ```text',
      '> <u>quoted code</u> **stars**',
      '> ```',
      '',
      '- item',
      '',
      '  ```text',
      '  <u>listed code</u> **stars**',
      '  ```',
    ].join('\n');
    const xml = await markdownXml(source);

    expect(wordText(xml)).toContain('<u>quoted code</u> **stars**');
    expect(wordText(xml)).toContain('<u>listed code</u> **stars**');
    expect(xml).not.toMatch(/<w:u(?:\s|\/?>)/);
    expect(xml).not.toMatch(/<w:b(?:\s|\/?>)/);
  });

  it('keeps prose formatting and one-pass entity decoding as positive controls', async () => {
    const xml = await markdownXml('**bold** <u>under</u>; Tom &amp; Jerry; &amp;gt;');
    const text = wordText(xml);

    expect(xml).toMatch(/<w:b(?:\s|\/?>)/);
    expect(xml).toMatch(/<w:u(?:\s|\/?>)/);
    expect(text).toContain('bold');
    expect(text).toContain('under');
    expect(text).toContain('Tom & Jerry; &gt;');
  });

  it('retains ordinary list and table output as structural controls', async () => {
    const xml = await markdownXml('- First item\n- Second item\n\n| A | B |\n| --- | --- |\n| One | Two |');
    const document = new DOMParser().parseFromString(xml, 'application/xml');

    expect(wordText(xml)).toContain('First item');
    expect(wordText(xml)).toContain('Second item');
    expect(wordText(xml)).toContain('One');
    expect(wordText(xml)).toContain('Two');
    expect(document.getElementsByTagName('w:tbl').length).toBe(1);
  });
  it('keeps outer prose emphasis while protecting inner code markers', async () => {
    const xml = await markdownXml('**before `x **inside**` after**');
    expect(wordText(xml)).toBe('before x **inside** after');
    expect(xml).toMatch(/<w:b(?:\s|\/?>)/);
    expect(xml).toContain('Courier New');
  });

  it('keeps literal br text inside multiline inline code', async () => {
    const xml = await markdownXml('Before `first <br>\nsecond **stars**` after.');
    expect(wordText(xml)).toBe('Before first <br> second **stars** after.');
    expect(xml).not.toMatch(/<w:b(?:\s|\/?>)/);
  });

  it('preserves code in headings without changing their heading style', async () => {
    const xml = await markdownXml('## Heading `**literal** <u>tag</u>`');
    expect(wordText(xml)).toBe('Heading **literal** <u>tag</u>');
    expect(xml).toContain('Courier New');
    expect(xml).toContain('Heading2');
  });

  it('preserves ordinary link labels in headings', async () => {
    const xml = await markdownXml('## [Section](https://example.test) `**literal**`');
    expect(wordText(xml)).toBe('Section **literal**');
    expect(wordText(xml)).not.toContain('https://');
  });

  it('preserves code formatting markers inside a valid GFM table cell', async () => {
    const xml = await markdownXml('| Code |\n| --- |\n| `<u>x</u> **stars**` |');
    expect(wordText(xml)).toBe('Code<u>x</u> **stars**');
    expect(xml).not.toMatch(/<w:u(?:\s|\/?>)/);
  });

  it('retains code whitespace before and inside heading sections', async () => {
    const xml = await markdownXml('    before  \n\n# Plan\n\n    after  ');
    expect(wordParagraphs(xml)).toEqual(['before  ', 'Plan', 'after  ']);
  });

  it('keeps empty code blocks empty instead of inserting a placeholder', async () => {
    const xml = await markdownXml('```text\n```');
    expect(wordText(xml)).toBe('');
    expect(xml).toContain('Courier New');
    expect(wordParagraphs(xml)).toHaveLength(1);
  });

  it('keeps list markers when an item starts with a code block', async () => {
    const xml = await markdownXml('- ```text\n  <u>literal</u>\n  ```\n\n3. ```text\n   value **stars**\n   ```');
    expect(wordText(xml)).toContain('• <u>literal</u>');
    expect(wordText(xml)).toContain('3. value **stars**');
    expect(xml).toContain('Courier New');
  });

  it.each([['CRLF', '\r\n'], ['bare CR', '\r']])('exports %s code lines as the same paragraphs as LF', async (_label, ending) => {
    const xml = await markdownXml(['```text', 'a', 'b', '```'].join(ending));
    expect(wordParagraphs(xml)).toEqual(['a', 'b']);
  });

});

function paragraphIndent(xml: string, words: string): number | null {
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const paragraph = Array.from(document.getElementsByTagNameNS(ns, 'p')).find(node => node.textContent === words);
  const left = paragraph?.getElementsByTagNameNS(ns, 'ind')[0]?.getAttributeNS(ns, 'left');
  return left ? Number(left) : null;
}

describe('Word thematic breaks and code-first list items', () => {
  it.each(['- - -', '* * * *', '_ _ _', '_\t_  _'])('draws the thematic break %s as a rule', async marker => {
    const xml = await markdownXml(['1. Step', '', marker, '', 'After the break'].join('\n'));
    expect(wordParagraphs(xml)).toEqual(['1. Step', expect.stringMatching(/^━+$/), 'After the break']);
  });

  it('keeps a quote under the numbered step that opened with code', async () => {
    const xml = await markdownXml([
      '1. ```text', '   step sample', '   ```', '', '   > Quote in step', '', '> Independent quote',
    ].join('\n'));
    expect(wordParagraphs(xml)).toEqual(['1. step sample', 'Quote in step', 'Independent quote']);
    expect(paragraphIndent(xml, '1. step sample')).toBe(720);
    expect(paragraphIndent(xml, 'Quote in step')).toBe(1080);
    expect(paragraphIndent(xml, 'Independent quote')).toBe(720);
  });

  it.each([[9, 10], [100, 9]])('keeps the code-first step %i → %i at the same depth', async (before, step) => {
    const marker = `${step}.`;
    const padding = ' '.repeat(marker.length + 1);
    const xml = await markdownXml([
      `${before}. Previous step`, marker + ' ```text', padding + 'second sample',
      padding + '```', '', padding + '> Quote in the current step',
    ].join('\n'));
    expect(wordParagraphs(xml)).toEqual([`${before}. Previous step`, marker + ' second sample', 'Quote in the current step']);
    expect(paragraphIndent(xml, 'Quote in the current step')).toBe(1080);
  });

  it('keeps the paragraph after literal HTML dashes outside a list', async () => {
    const xml = await markdownXml(['<div>', '- - -', '   ordinary', '</div>', '', 'Outside'].join('\n'));
    expect(wordParagraphs(xml)).not.toContainEqual(expect.stringMatching(/^━+$/));
    expect(paragraphIndent(xml, 'ordinary')).toBeNull();
  });

  it('preserves a legacy footnote label on the same line as a rule', async () => {
    const xml = await markdownXml(['Intro[^note]', '', '[^note]: * * *', '    Appendix', '', 'Outside'].join('\n'));
    const paragraphs = wordParagraphs(xml);
    expect(paragraphs).toContainEqual(expect.stringMatching(/^\[\^note\]:/));
    expect(paragraphs).not.toContainEqual(expect.stringMatching(/^━+$/));
  });

  it('keeps the first code block and its quote under a nested step', async () => {
    const xml = await markdownXml([
      '1. Parent', '   - ```text', '     nested sample', '     ```', '', '     > Quote in substep',
    ].join('\n'));
    expect(wordParagraphs(xml)).toEqual(['1. Parent', '• nested sample', 'Quote in substep']);
    expect(paragraphIndent(xml, '• nested sample')).toBe(1080);
    expect(paragraphIndent(xml, 'Quote in substep')).toBe(1440);
  });
});

describe('Word lists inside blockquotes', () => {
  it('keeps a code-first step and its nested quote inside the outer quote', async () => {
    const xml = await markdownXml([
      '> 1. ```txt', '>    code sample', '>    ```', '>', '>    > **Nested quote**',
      '>', '> Outside the step', '', 'Outside the quote',
    ].join('\n'));
    expect(wordParagraphs(xml)).toEqual(['1. code sample', 'Nested quote', 'Outside the step', 'Outside the quote']);
    expect(paragraphIndent(xml, '1. code sample')).toBe(720);
    expect(paragraphIndent(xml, 'Nested quote')).toBe(1080);
    expect(paragraphIndent(xml, 'Outside the step')).toBe(720);
    expect(paragraphIndent(xml, 'Outside the quote')).toBeNull();
  });

  it('keeps the next quoted step and its continuation at their proper levels', async () => {
    const xml = await markdownXml([
      '> 9. ```txt', '>    >literal', '>    ```', '>',
      '> 10. Next step', '>', '>     continuation',
    ].join('\n'));
    expect(wordParagraphs(xml)).toEqual(['9. >literal', '10. Next step', 'continuation']);
    expect(paragraphIndent(xml, '10. Next step')).toBe(720);
    expect(paragraphIndent(xml, 'continuation')).toBe(1080);
  });

  it('keeps the parser value of multiline inline code inside a quote', async () => {
    const xml = await markdownXml('> **`alpha\n>   beta`**');
    expect(wordParagraphs(xml)).toEqual(['alpha   beta']);
    expect(xml).toContain('Courier New');
    expect(xml).toMatch(/<w:b(?:\s|\/?>)/);
  });

  it('keeps an escaped chevron literal in a nested quote', async () => {
    const xml = await markdownXml(['> Simple', '> > \\> Literal', '', 'Outside'].join('\n'));
    expect(wordParagraphs(xml)).toEqual(['Simple', '> Literal', 'Outside']);
    expect(paragraphIndent(xml, 'Simple')).toBe(720);
    expect(paragraphIndent(xml, '> Literal')).toBe(1080);
  });
});
